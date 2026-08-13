#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'standalone/assets/generated/manifest.json');

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
  return { width: info.width, height: info.height, bbox: { left, top, right, bottom } };
}

function runtimeManifestState(runtime, state) {
  return runtime.animations?.[state] || runtime.states?.[state] || null;
}

function relative(value) {
  return path.relative(root, path.resolve(root, value)).replaceAll('\\', '/');
}

const manifest = await readJson(manifestPath);
if (![1, 2].includes(manifest.schema_version) || !Array.isArray(manifest.sequences)) {
  throw new Error('Invalid generated asset manifest');
}

let acceptedSequences = 0;
let acceptedFrames = 0;
for (const [index, sequence] of manifest.sequences.entries()) {
  const label = `${sequence.character || 'unknown'}:${sequence.variant || sequence.skin || 'default'}:${sequence.animation || index}`;
  for (const field of ['character', 'animation', 'source_frame_a', 'source_frame_b', 'generated_frames', 'accepted']) {
    required(sequence, field, index);
  }
  if (!Array.isArray(sequence.generated_frames) || sequence.generated_frames.length === 0 || typeof sequence.accepted !== 'boolean') {
    throw new Error(`${label}: invalid generated sequence fields`);
  }
  if ('variant' in sequence && typeof sequence.variant !== 'string') throw new Error(`${label}: variant must be a string`);
  if ('skin' in sequence && sequence.skin !== null && typeof sequence.skin !== 'string') throw new Error(`${label}: skin must be null or a string`);
  await Promise.all([sequence.source_frame_a, sequence.source_frame_b, ...sequence.generated_frames].map(async (file) => {
    if (typeof file !== 'string' || !file) throw new Error(`${label}: asset paths must be non-empty strings`);
    await fs.access(path.resolve(root, file));
  }));

  if (!sequence.accepted) {
    if (!(sequence.reason || sequence.review)) throw new Error(`${label}: rejected sequence must record a reason or review`);
    continue;
  }

  acceptedSequences++;
  acceptedFrames += sequence.generated_frames.length;
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
    const runtime = await readJson(runtimePath);
    const animation = runtimeManifestState(runtime, usage.state);
    if (!animation) {
      throw new Error(`${label}: runtime state ${usage.state} is absent from ${usage.manifest}`);
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
      if (usage.source && /[\\/]|\.png$/i.test(usage.source) && relative(usage.source) !== relative(generated)) {
        throw new Error(`${label}: runtime_usage source does not reference accepted frame ${generated}`);
      }
      const usedFrames = animation.generatedFrames || animation.generated_frames || [];
      if (!usedFrames.includes(match.frame) || !animation.frameOrder?.includes(match.frame)) {
        throw new Error(`${label}: generated runtime frame ${match.frame} is not used by state ${usage.state}`);
      }
    }
  }
}

console.log(`OK: ${manifest.sequences.length} traceable image2 sequence(s), ${acceptedSequences} accepted sequence(s), ${acceptedFrames} accepted frame(s)`);
