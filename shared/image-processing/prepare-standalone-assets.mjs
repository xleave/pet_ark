#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_COLUMNS = 8;
const ROSTER_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-roster.json');
const LEGACY_REGISTRY_PATH = path.join(REPO_ROOT, 'standalone/characters/registry.json');
const GENERATED_MANIFEST_PATH = path.join(REPO_ROOT, 'standalone/assets/generated/manifest.json');

function argument(name, fallback = null) {
  const match = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (match) return match.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function frameOrder(frameCount, definition) {
  let result;
  if (definition.range) {
    const [start, rawEnd] = definition.range;
    const end = Math.max(0, Math.min(frameCount - 1, rawEnd));
    const step = start <= end ? 1 : -1;
    result = [];
    for (let frame = Math.max(0, Math.min(frameCount - 1, start)); frame !== end + step; frame += step) result.push(frame);
  } else {
    result = Array.from({ length: frameCount }, (_, frame) => frame);
  }
  return definition.reverse ? result.reverse() : result;
}

async function readJson(file, required = true) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null;
    throw new Error(`${path.relative(REPO_ROOT, file)}: ${error.message}`);
  }
}

function variantId(variant) {
  return variant.variant_id || variant.id || variant.skin_id || 'default';
}

function selectVariant(character, selector) {
  return character.variants.find((variant) => variantId(variant) === selector || variant.skin_id === selector);
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function hasSourceDirectories(directory) {
  if (!await directoryExists(directory)) return false;
  return (await fs.readdir(directory, { withFileTypes: true })).some((entry) => entry.isDirectory());
}

function sourceName(available, ...preferred) {
  for (const candidate of preferred) {
    const match = available.find((entry) => entry.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

function derivedAnimations(available) {
  const idle = sourceName(available, 'relax', 'default');
  const move = sourceName(available, 'move', 'walk', 'run');
  const interact = sourceName(available, 'interact', 'special', 'default', 'relax');
  const sit = sourceName(available, 'sit', 'relax', 'default');
  const sleep = sourceName(available, 'sleep', 'sit', 'relax', 'default');
  if (!idle || !move || !interact || !sit || !sleep) {
    throw new Error(`source animations cannot satisfy desktop states (available: ${available.join(', ')})`);
  }
  return {
    idle: { source: idle, fps: 12, loop: true },
    'walk-left': { source: move, fps: 12, loop: true, mirror: true },
    'walk-right': { source: move, fps: 12, loop: true },
    'run-left': { source: move, fps: 18, loop: true, mirror: true },
    'run-right': { source: move, fps: 18, loop: true },
    clicked: { source: interact, fps: 12, loop: false, next: 'idle' },
    'picked-up': { source: sit, fps: 12, loop: false, range: [0, 5], next: 'dragging' },
    dragging: { source: sit, fps: 6, loop: true, range: [5, 10] },
    dropped: { source: sit, fps: 12, loop: false, range: [5, 0], next: 'idle' },
    rest: { source: sit, fps: 8, loop: false, holdLast: true, next: 'sleep' },
    sleep: { source: sleep, fps: 10, loop: true },
    wake: { source: sleep, fps: 12, loop: false, reverse: true, next: 'idle' },
    special: { source: interact, fps: 12, loop: false, next: 'idle' },
  };
}

async function inspectFrame(file, frameWidth, frameHeight) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== frameWidth || info.height !== frameHeight || info.channels !== 4) {
    throw new Error(`${file}: expected ${frameWidth}x${frameHeight} RGBA`);
  }
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let dirty = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3];
      if (alpha) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      } else if (data[offset] || data[offset + 1] || data[offset + 2]) {
        dirty++;
      }
    }
  }
  if (dirty) throw new Error(`${file}: ${dirty} transparent pixels contain hidden RGB`);
  if (right < left || bottom < top) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function acceptedInsertions(manifest, character, variant, source, sourceFrames) {
  const insertions = [];
  for (const sequence of manifest?.sequences || []) {
    if (!sequence.accepted || sequence.character !== character) continue;
    const sequenceVariant = sequence.variant || sequence.skin || 'default';
    if (sequenceVariant !== variant) continue;
    const usages = (sequence.runtime_usage || []).filter((usage) => {
      const sourceName = usage.source_name || sequence.source_name || sequence.source_animation || sequence.animation;
      return sourceName === source;
    });
    if (!usages.length) continue;
    const rawAfter = usages[0].insert_after ?? sequence.insert_after;
    const after = Number.isInteger(rawAfter)
      ? rawAfter
      : sourceFrames.findIndex((file) => path.basename(file) === path.basename(String(rawAfter)));
    if (!Number.isInteger(after) || after < 0) throw new Error(`${character}:${variant}:${source}: accepted generated insertion requires insert_after`);
    if (usages.some((usage) => (usage.insert_after ?? sequence.insert_after) !== rawAfter)) {
      throw new Error(`${character}:${variant}:${source}: accepted runtime usages disagree on insert_after`);
    }
    const states = [...new Set(usages.map((usage) => usage.state))];
    for (const file of sequence.generated_frames) {
      insertions.push({ after, file: path.resolve(REPO_ROOT, file), sequence: sequence.animation, states });
    }
  }
  return insertions.sort((a, b) => a.after - b.after);
}

const roster = await readJson(ROSTER_PATH, false);
const legacyRegistry = await readJson(LEGACY_REGISTRY_PATH, false);
const generatedManifest = await readJson(GENERATED_MANIFEST_PATH, false);
const characterId = argument('--character', 'amiya');
const variantSelector = argument('--variant', argument('--skin', 'default'));
const character = roster?.characters.find((entry) => entry.character_id === characterId);
const legacyCharacter = legacyRegistry?.characters?.find((entry) => (entry.character_id || entry.id) === characterId);
if (!character) throw new Error(`Unknown standalone character: ${characterId}`);
const variant = selectVariant(character, variantSelector);
if (!variant) throw new Error(`${characterId}: unknown variant/skin ${variantSelector}`);
const idVariant = variantId(variant);
const nestedCleanedDir = path.join(REPO_ROOT, 'standalone/assets/cleaned', characterId, idVariant);
const legacyCleanedDir = path.join(REPO_ROOT, 'standalone/assets/cleaned', characterId);
const acceptedForVariant = (generatedManifest?.sequences || []).filter((sequence) =>
  sequence.accepted && sequence.character === characterId && (sequence.variant || sequence.skin || 'default') === idVariant
);
const acceptedUsesLegacy = acceptedForVariant.some((sequence) =>
  [sequence.source_frame_a, sequence.source_frame_b].some((file) => path.resolve(REPO_ROOT, file).startsWith(`${legacyCleanedDir}${path.sep}`) &&
    !path.resolve(REPO_ROOT, file).startsWith(`${nestedCleanedDir}${path.sep}`))
);
const cleanedDir = !acceptedUsesLegacy && await hasSourceDirectories(nestedCleanedDir)
  ? nestedCleanedDir
  : idVariant === 'default' ? legacyCleanedDir : nestedCleanedDir;
const animationDir = path.join(REPO_ROOT, 'standalone/assets/animations', characterId, idVariant);
const runtimeDir = path.join(REPO_ROOT, 'standalone/assets/runtime', characterId, idVariant);
await Promise.all([
  fs.mkdir(animationDir, { recursive: true }),
  fs.mkdir(runtimeDir, { recursive: true }),
]);

const entries = await fs.readdir(cleanedDir, { withFileTypes: true });
const availableSources = entries
  .filter((entry) => entry.isDirectory() && !entry.name.includes('.partial-'))
  .map((entry) => entry.name)
  .sort();
const sampleSource = availableSources[0];
const sampleFrameName = sampleSource
  ? (await fs.readdir(path.join(cleanedDir, sampleSource))).filter((file) => file.endsWith('.png')).sort()[0]
  : null;
if (!sampleFrameName) throw new Error(`${characterId}:${idVariant} has no cleaned PNG frames`);
const cleanedManifest = await readJson(path.join(cleanedDir, 'manifest.json'), false);
if (cleanedManifest) {
  const manifestCharacter = cleanedManifest.character || cleanedManifest.character_id;
  const manifestVariant = cleanedManifest.variant || cleanedManifest.variant_id || 'default';
  if (manifestCharacter !== characterId || manifestVariant !== idVariant) {
    throw new Error(`${characterId}:${idVariant}: cleaned manifest identity mismatch`);
  }
  const declaredStates = cleanedManifest.processed_states || cleanedManifest.animations || {};
  for (const source of Object.keys(declaredStates)) {
    if (!availableSources.includes(source)) throw new Error(`${characterId}:${idVariant}: cleaned manifest source ${source} has no frame directory`);
  }
  for (const source of availableSources) {
    if (!declaredStates[source]) throw new Error(`${characterId}:${idVariant}: cleaned source ${source} is absent from manifest`);
    const actualCount = (await fs.readdir(path.join(cleanedDir, source))).filter((file) => file.endsWith('.png')).length;
    if (declaredStates[source].frames !== actualCount) {
      throw new Error(`${characterId}:${idVariant}:${source}: cleaned manifest declares ${declaredStates[source].frames} frames but found ${actualCount}`);
    }
  }
}
const sampleMetadata = await sharp(path.join(cleanedDir, sampleSource, sampleFrameName)).metadata();
const frameWidth = sampleMetadata.width;
const frameHeight = sampleMetadata.height;
if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth < 1 || frameHeight < 1) {
  throw new Error(`${characterId}:${idVariant} has invalid frame dimensions`);
}
if (cleanedManifest?.canvas && (cleanedManifest.canvas.width !== frameWidth || cleanedManifest.canvas.height !== frameHeight)) {
  throw new Error(`${characterId}:${idVariant}: cleaned frame dimensions do not match manifest canvas`);
}
const legacyVariant = legacyCharacter?.variants?.find((entry) => (entry.id || entry.variant_id) === idVariant);
const legacyAnimations = legacyVariant?.animations || (
  idVariant === 'default' && legacyCharacter && !Array.isArray(legacyCharacter.variants)
    ? legacyCharacter.animations
    : null
);
const animationDefinitions = variant.animations || legacyAnimations || derivedAnimations(availableSources);

const sources = {};
const generatedProvenance = [];
const sourceFrameMaps = {};
for (const source of new Set(Object.values(animationDefinitions).map((animation) => animation.source))) {
  const sourceDir = path.join(cleanedDir, source);
  const originalFrames = (await fs.readdir(sourceDir)).filter((file) => file.endsWith('.png')).sort()
    .map((file) => path.join(sourceDir, file));
  const insertions = acceptedInsertions(generatedManifest, characterId, idVariant, source, originalFrames);
  const frames = [];
  const sourceFrameMap = [];
  for (let index = 0; index < originalFrames.length; index++) {
    frames.push({ file: originalFrames[index], origin: 'source', sourceIndex: index });
    sourceFrameMap[index] = frames.length - 1;
    for (const insertion of insertions.filter((entry) => entry.after === index)) {
      frames.push({ file: insertion.file, origin: 'generated', sourceIndex: index, sequence: insertion.sequence });
      generatedProvenance.push({
        source,
        frame: frames.length - 1,
        file: path.relative(REPO_ROOT, insertion.file),
        inserted_after_source_frame: index,
        sequence: insertion.sequence,
        states: insertion.states,
      });
    }
  }
  if (!frames.length) throw new Error(`${characterId}:${idVariant}:${source} has no cleaned frames`);
  const columns = Math.min(MAX_COLUMNS, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const hitboxes = [];
  const composites = [];
  for (let index = 0; index < frames.length; index++) {
    const file = frames[index].file;
    hitboxes.push(await inspectFrame(file, frameWidth, frameHeight));
    composites.push({ input: file, left: (index % columns) * frameWidth, top: Math.floor(index / columns) * frameHeight });
  }
  const outputName = `${source}.png`;
  await sharp({
    create: {
      width: columns * frameWidth,
      height: rows * frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(runtimeDir, outputName));
  sources[source] = {
    sheet: outputName,
    frames: frames.length,
    sourceFrames: originalFrames.length,
    generatedFrames: frames.length - originalFrames.length,
    columns,
    rows,
    hitboxes,
  };
  sourceFrameMaps[source] = sourceFrameMap;
}

const animations = {};
for (const [state, definition] of Object.entries(animationDefinitions)) {
  const source = sources[definition.source];
  const relevantGenerated = generatedProvenance.filter((entry) => entry.source === definition.source && entry.states.includes(state));
  const originalOrder = frameOrder(source.sourceFrames, definition);
  const descending = originalOrder.length > 1 && originalOrder[1] < originalOrder[0];
  const sourceOrder = [];
  for (const originalFrame of originalOrder) {
    const generatedAfter = relevantGenerated.filter((entry) => entry.inserted_after_source_frame === originalFrame).map((entry) => entry.frame);
    if (descending) sourceOrder.push(...generatedAfter.slice().reverse());
    sourceOrder.push(sourceFrameMaps[definition.source][originalFrame]);
    if (!descending) sourceOrder.push(...generatedAfter);
  }
  animations[state] = {
    source: definition.source,
    sheet: source.sheet,
    frameOrder: sourceOrder,
    fps: definition.fps,
    loop: definition.loop,
    mirror: Boolean(definition.mirror),
    holdLast: Boolean(definition.holdLast),
    next: definition.next || null,
    generatedFrames: relevantGenerated.map((entry) => entry.frame).filter((frame) => sourceOrder.includes(frame)),
  };
}

const animationManifest = {
  schema_version: 2,
  character: characterId,
  variant: idVariant,
  skin: variant.skin_id || null,
  frameSize: { width: frameWidth, height: frameHeight },
  states: Object.fromEntries(Object.entries(animations).map(([state, animation]) => [state, {
    origin: 'processed-prts-spine',
    source_animation: animation.source,
    frame_order: animation.frameOrder,
    mirror: animation.mirror,
  }])),
};
const runtimeManifest = {
  schemaVersion: 2,
  character: {
    id: characterId,
    name: character.character_name,
    localizedName: character.localized_name,
    movement: character.movement || legacyCharacter?.movement || {
      walkPixelsPerSecond: 68,
      runPixelsPerSecond: 116,
      idleMinSeconds: 4,
      idleMaxSeconds: 11,
      restAfterSeconds: 75,
    },
  },
  variant: {
    id: idVariant,
    type: variant.variant_type,
    skinId: variant.skin_id || null,
    name: variant.name || variant.skin_name || 'Default',
    localizedName: variant.skin_name || variant.name || '默认',
    defaultScale: variant.defaultScale || legacyCharacter?.defaultScale || 1,
    mirrorRules: variant.mirrorRules || legacyCharacter?.mirrorRules || { strategy: 'safe-mirror', independentDirections: false },
    fallbackVariantId: variant.runtime?.fallback_variant_id || variant.fallbackVariant || null,
    stateFallbacks: variant.stateFallbacks || variant.runtime?.state_fallbacks || {},
  },
  frameSize: { width: frameWidth, height: frameHeight },
  sources,
  animations,
  provenance: {
    generatedFrames: generatedProvenance,
  },
};
await Promise.all([
  fs.writeFile(path.join(animationDir, 'manifest.json'), `${JSON.stringify(animationManifest, null, 2)}\n`),
  fs.writeFile(path.join(runtimeDir, 'manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`),
]);
console.log(`prepared ${characterId}:${idVariant}: ${Object.keys(animations).length} states, ${Object.keys(sources).length} source atlases`);
