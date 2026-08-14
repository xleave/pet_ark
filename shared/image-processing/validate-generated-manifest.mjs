#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'standalone/assets/generated/manifest.json');
const runtimeRoot = path.join(root, 'standalone/assets/runtime');
const rosterPath = path.join(root, 'shared/character-data/standalone-roster.json');

function option(name, fallback = null) {
  const args = process.argv.slice(2);
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(root, file)}: ${error.message}`);
  }
}

function required(sequence, field, index) {
  if (!(field in sequence)) throw new Error(`Generated sequence ${index} is missing ${field}`);
}

async function inspectPng(file, sequenceLabel, requireCleanHiddenRgb) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`${sequenceLabel}: generated frame leaves repository: ${file}`);
  const image = sharp(absolute).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.width < 1 || info.height < 1 || info.channels !== 4) {
    throw new Error(`${sequenceLabel}: ${file} is not a non-empty RGBA image`);
  }
  let visible = 0;
  let hiddenRgb = 0;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3]) {
      visible++;
      const pixel = offset / 4;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    else if (data[offset] || data[offset + 1] || data[offset + 2]) hiddenRgb++;
  }
  if (!visible) throw new Error(`${sequenceLabel}: ${file} is fully transparent`);
  if (requireCleanHiddenRgb && hiddenRgb) throw new Error(`${sequenceLabel}: ${file} has ${hiddenRgb} transparent pixels with hidden RGB`);
  return { width: info.width, height: info.height, bbox: { left, top, right, bottom }, pixels: data };
}

function runtimeManifestState(runtime, state) {
  return runtime.animations?.[state] || runtime.states?.[state] || null;
}

function relative(value) {
  return path.relative(root, path.resolve(root, value)).replaceAll('\\', '/');
}

function repositoryAsset(value, label) {
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label}: asset leaves repository: ${value}`);
  }
  return absolute;
}

async function variantAsset(runtimePath, value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(`${label}: runtime source sheet must be a relative path`);
  }
  const variantRoot = path.dirname(runtimePath);
  const absolute = path.resolve(variantRoot, value);
  if (!absolute.startsWith(`${variantRoot}${path.sep}`)) {
    throw new Error(`${label}: runtime source sheet leaves its character variant`);
  }
  const [canonicalRoot, canonicalAsset] = await Promise.all([
    fs.realpath(variantRoot),
    fs.realpath(absolute),
  ]);
  if (!canonicalAsset.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`${label}: runtime source sheet resolves outside its character variant`);
  }
  return absolute;
}

async function runtimeAtlasFrame(runtimePath, runtime, sourceId, frame, label) {
  const source = runtime.sources?.[sourceId];
  if (!source) throw new Error(`${label}: runtime provenance references missing source ${sourceId}`);
  const frameWidth = runtime.frameSize?.width || runtime.frame_size?.width;
  const frameHeight = runtime.frameSize?.height || runtime.frame_size?.height;
  if (![frameWidth, frameHeight, source.columns, source.rows, source.frames].every(Number.isInteger) ||
      frameWidth < 1 || frameHeight < 1 || source.columns < 1 || source.rows < 1 || source.frames < 1) {
    throw new Error(`${label}: runtime source grid is invalid`);
  }
  if (!Number.isInteger(frame) || frame < 0 || frame >= source.frames) {
    throw new Error(`${label}: runtime provenance frame ${frame} is outside source ${sourceId}`);
  }
  const sheet = await variantAsset(runtimePath, source.sheet, label);
  const metadata = await sharp(sheet).metadata();
  if (metadata.width !== source.columns * frameWidth || metadata.height !== source.rows * frameHeight) {
    throw new Error(`${label}: runtime source atlas dimensions do not match its grid`);
  }
  const column = frame % source.columns;
  const row = Math.floor(frame / source.columns);
  return sharp(sheet)
    .ensureAlpha()
    .extract({
      left: column * frameWidth,
      top: row * frameHeight,
      width: frameWidth,
      height: frameHeight,
    })
    .raw()
    .toBuffer();
}

function sameRuntimePixels(atlas, generated) {
  if (atlas.length !== generated.length) return false;
  for (let offset = 0; offset < atlas.length; offset += 4) {
    if (atlas[offset + 3] !== generated[offset + 3]) return false;
    for (let channel = 0; channel < 3; channel++) {
      // libvips composites through premultiplied alpha and can round a decoded
      // RGB channel by one while preserving the exact alpha and visible image.
      if (Math.abs(atlas[offset + channel] - generated[offset + channel]) > 1) return false;
    }
  }
  return true;
}

const manifest = await readJson(manifestPath);
if (![1, 2].includes(manifest.schema_version) || !Array.isArray(manifest.sequences)) {
  throw new Error('Invalid generated asset manifest');
}
const selectedCharacter = option('--character');
const requestedVariant = option('--variant', option('--skin'));
if (requestedVariant && !selectedCharacter) throw new Error('--variant/--skin requires --character');
let selectedVariant = requestedVariant;
if (selectedCharacter) {
  const roster = await readJson(rosterPath);
  const character = roster.characters?.find((entry) => entry.character_id === selectedCharacter);
  if (!character) throw new Error(`unknown standalone character ${selectedCharacter}`);
  if (requestedVariant) {
    const variant = character.variants?.find((entry) =>
      entry.variant_id === requestedVariant || entry.skin_id === requestedVariant || entry.skin_name === requestedVariant);
    if (!variant) throw new Error(`${selectedCharacter}: unknown variant/skin ${requestedVariant}`);
    selectedVariant = variant.variant_id;
  }
}
const sequences = manifest.sequences.filter((sequence) =>
  (!selectedCharacter || sequence.character === selectedCharacter) &&
  (!selectedVariant || (sequence.variant || sequence.skin || 'default') === selectedVariant));

let acceptedSequences = 0;
let acceptedFrames = 0;
const acceptedKinds = {};
const rejectedKinds = {};
for (const [index, sequence] of sequences.entries()) {
  const label = `${sequence.character || 'unknown'}:${sequence.variant || sequence.skin || 'default'}:${sequence.animation || index}`;
  for (const field of ['character', 'animation', 'source_frame_a', 'source_frame_b', 'generated_frames', 'accepted']) {
    required(sequence, field, index);
  }
  if (!Array.isArray(sequence.generated_frames) || sequence.generated_frames.length === 0 || typeof sequence.accepted !== 'boolean') {
    throw new Error(`${label}: invalid generated sequence fields`);
  }
  if (typeof sequence.character !== 'string' || !sequence.character) throw new Error(`${label}: character must be a non-empty string`);
  if ('variant' in sequence && (typeof sequence.variant !== 'string' || !sequence.variant)) {
    throw new Error(`${label}: variant must be a non-empty string`);
  }
  if ('skin' in sequence && sequence.skin !== null && (typeof sequence.skin !== 'string' || !sequence.skin)) {
    throw new Error(`${label}: skin must be null or a non-empty string`);
  }
  if (sequence.variant && sequence.skin && sequence.variant !== sequence.skin) {
    throw new Error(`${label}: variant and skin identities differ`);
  }
  await Promise.all([sequence.source_frame_a, sequence.source_frame_b, ...sequence.generated_frames].map(async (file) => {
    if (typeof file !== 'string' || !file) throw new Error(`${label}: asset paths must be non-empty strings`);
    await fs.access(repositoryAsset(file, label));
  }));

  if (!sequence.accepted) {
    if (!(sequence.reason || sequence.review)) throw new Error(`${label}: rejected sequence must record a reason or review`);
    const kind = sequence.generator_kind || 'unspecified';
    rejectedKinds[kind] = (rejectedKinds[kind] || 0) + 1;
    continue;
  }

  acceptedSequences++;
  acceptedFrames += sequence.generated_frames.length;
  const kind = sequence.generator_kind || 'unspecified';
  acceptedKinds[kind] = (acceptedKinds[kind] || 0) + 1;
  if (!(sequence.reason || sequence.review)) throw new Error(`${label}: accepted sequence must record its review reason`);
  if (!sequence.generator || !sequence.generated_on) throw new Error(`${label}: accepted sequence requires generator and generated_on`);
  if (!Array.isArray(sequence.runtime_usage) || sequence.runtime_usage.length === 0) {
    throw new Error(`${label}: accepted sequence must declare non-empty runtime_usage`);
  }
  const [sourceA, sourceB] = await Promise.all([
    inspectPng(sequence.source_frame_a, label, false),
    inspectPng(sequence.source_frame_b, label, false),
  ]);
  if (sourceA.width !== sourceB.width || sourceA.height !== sourceB.height) {
    throw new Error(`${label}: source frame dimensions do not match`);
  }
  const generatedInfo = await Promise.all(sequence.generated_frames.map((file) => inspectPng(file, label, true)));
  const marginX = Math.max(4, Math.ceil(sourceA.width * 0.02));
  const marginY = Math.max(4, Math.ceil(sourceA.height * 0.02));
  const union = {
    left: Math.min(sourceA.bbox.left, sourceB.bbox.left) - marginX,
    top: Math.min(sourceA.bbox.top, sourceB.bbox.top) - marginY,
    right: Math.max(sourceA.bbox.right, sourceB.bbox.right) + marginX,
    bottom: Math.max(sourceA.bbox.bottom, sourceB.bbox.bottom) + marginY,
  };
  for (const info of generatedInfo) {
    if (info.width !== sourceA.width || info.height !== sourceA.height) {
      throw new Error(`${label}: accepted frame dimensions differ from source frames`);
    }
    if (info.bbox.left < union.left || info.bbox.top < union.top || info.bbox.right > union.right || info.bbox.bottom > union.bottom) {
      throw new Error(`${label}: accepted frame alpha bounds escape the source-frame union`);
    }
  }
  for (const usage of sequence.runtime_usage) {
    if (!usage || typeof usage.manifest !== 'string' || typeof usage.state !== 'string') {
      throw new Error(`${label}: runtime_usage entries require manifest and state`);
    }
    const runtimePath = path.resolve(root, usage.manifest);
    const sequenceVariant = sequence.variant || sequence.skin || 'default';
    const expectedRuntimePath = path.join(runtimeRoot, sequence.character, sequenceVariant, 'manifest.json');
    const expectedRuntimeManifest = relative(expectedRuntimePath);
    if (!expectedRuntimePath.startsWith(`${runtimeRoot}${path.sep}`) ||
        path.isAbsolute(usage.manifest) || usage.manifest !== expectedRuntimeManifest || runtimePath !== expectedRuntimePath) {
      throw new Error(`${label}: runtime_usage manifest must be the canonical runtime manifest for ${sequence.character}/${sequenceVariant}`);
    }
    const canonicalRuntimePath = await fs.realpath(runtimePath);
    if (canonicalRuntimePath !== runtimePath) {
      throw new Error(`${label}: runtime_usage manifest must not resolve through a symlink`);
    }
    const runtime = await readJson(runtimePath);
    const runtimeCharacter = runtime.character?.id || runtime.character_id;
    const runtimeVariant = runtime.variant?.id || runtime.variant_id || 'default';
    if (runtimeCharacter !== sequence.character || runtimeVariant !== sequenceVariant) {
      throw new Error(`${label}: runtime manifest identity does not match generated sequence`);
    }
    const animation = runtimeManifestState(runtime, usage.state);
    if (!animation) {
      throw new Error(`${label}: runtime state ${usage.state} is absent from ${usage.manifest}`);
    }
    if (!['source', 'derived', 'generated'].includes(animation.origin)) {
      throw new Error(`${label}: runtime state ${usage.state} must declare source/derived/generated origin`);
    }
    if (!animation.provenanceId) {
      throw new Error(`${label}: runtime state ${usage.state} is missing provenanceId`);
    }
    const provenance = runtime.provenance?.generatedFrames || runtime.provenance?.generated_frames || [];
    for (const generated of sequence.generated_frames) {
      const match = provenance.find((entry) => relative(entry.file) === relative(generated));
      if (!match) throw new Error(`${label}: ${generated} is not recorded in runtime provenance`);
      if (!Array.isArray(match.states) || !match.states.includes(usage.state)) {
        throw new Error(`${label}: runtime provenance does not authorize state ${usage.state}`);
      }
      const expectedSource = usage.source_name || sequence.source_name || sequence.source_animation;
      if (expectedSource && match.source !== expectedSource) {
        throw new Error(`${label}: ${generated} runtime provenance source does not match ${expectedSource}`);
      }
      if (animation.source !== match.source) {
        throw new Error(`${label}: runtime state ${usage.state} uses ${animation.source}, but generated provenance uses ${match.source}`);
      }
      if (usage.source && /[\\/]|\.png$/i.test(usage.source) && relative(usage.source) !== relative(generated)) {
        throw new Error(`${label}: runtime_usage source does not reference accepted frame ${generated}`);
      }
      const usedFrames = animation.generatedFrames || animation.generated_frames || [];
      if (!usedFrames.includes(match.frame) || !animation.frameOrder?.includes(match.frame)) {
        throw new Error(`${label}: generated runtime frame ${match.frame} is not used by state ${usage.state}`);
      }
      const generatedPixels = generatedInfo[sequence.generated_frames.indexOf(generated)]?.pixels;
      const atlasPixels = await runtimeAtlasFrame(runtimePath, runtime, match.source, match.frame, label);
      if (!generatedPixels || !sameRuntimePixels(atlasPixels, generatedPixels)) {
        throw new Error(`${label}: runtime atlas frame ${match.source}:${match.frame} does not equal accepted generated PNG ${generated}`);
      }
    }
  }
}

console.log(`OK: ${sequences.length} traceable generated sequence(s), ${acceptedSequences} accepted sequence(s), ${acceptedFrames} accepted frame(s); accepted kinds=${JSON.stringify(acceptedKinds)}, rejected kinds=${JSON.stringify(rejectedKinds)}`);
