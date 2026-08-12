#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 448;
const MAX_COLUMNS = 8;

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

async function inspectFrame(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== FRAME_WIDTH || info.height !== FRAME_HEIGHT || info.channels !== 4) {
    throw new Error(`${file}: expected ${FRAME_WIDTH}x${FRAME_HEIGHT} RGBA`);
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

const registry = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'standalone/characters/registry.json'), 'utf8'));
const characterId = argument('--character', 'amiya');
const character = registry.characters.find((entry) => entry.id === characterId);
if (!character) throw new Error(`Unknown standalone character: ${characterId}`);
const cleanedDir = path.join(REPO_ROOT, 'standalone/assets/cleaned', character.id);
const animationDir = path.join(REPO_ROOT, 'standalone/assets/animations', character.id);
const runtimeDir = path.join(REPO_ROOT, 'standalone/assets/runtime', character.id);
await Promise.all([
  fs.mkdir(animationDir, { recursive: true }),
  fs.mkdir(runtimeDir, { recursive: true }),
]);

const sources = {};
for (const source of new Set(Object.values(character.animations).map((animation) => animation.source))) {
  const sourceDir = path.join(cleanedDir, source);
  const frames = (await fs.readdir(sourceDir)).filter((file) => file.endsWith('.png')).sort();
  if (!frames.length) throw new Error(`${character.id}:${source} has no cleaned frames`);
  const columns = Math.min(MAX_COLUMNS, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const hitboxes = [];
  const composites = [];
  for (let index = 0; index < frames.length; index++) {
    const file = path.join(sourceDir, frames[index]);
    hitboxes.push(await inspectFrame(file));
    composites.push({ input: file, left: (index % columns) * FRAME_WIDTH, top: Math.floor(index / columns) * FRAME_HEIGHT });
  }
  const outputName = `${source}.png`;
  await sharp({
    create: {
      width: columns * FRAME_WIDTH,
      height: rows * FRAME_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(runtimeDir, outputName));
  sources[source] = { sheet: outputName, frames: frames.length, columns, rows, hitboxes };
}

const animations = {};
for (const [state, definition] of Object.entries(character.animations)) {
  const source = sources[definition.source];
  animations[state] = {
    source: definition.source,
    sheet: source.sheet,
    frameOrder: frameOrder(source.frames, definition),
    fps: definition.fps,
    loop: definition.loop,
    mirror: Boolean(definition.mirror),
    holdLast: Boolean(definition.holdLast),
    next: definition.next || null,
  };
}

const animationManifest = {
  character: character.id,
  frameSize: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
  states: Object.fromEntries(Object.entries(animations).map(([state, animation]) => [state, {
    origin: 'processed-prts-spine',
    source_animation: animation.source,
    frame_order: animation.frameOrder,
    mirror: animation.mirror,
  }])),
};
const runtimeManifest = {
  schemaVersion: 1,
  character: {
    id: character.id,
    name: character.name,
    localizedName: character.localized_name,
    defaultScale: character.defaultScale,
    movement: character.movement,
    mirrorRules: character.mirrorRules,
  },
  frameSize: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
  sources,
  animations,
};
await Promise.all([
  fs.writeFile(path.join(animationDir, 'manifest.json'), `${JSON.stringify(animationManifest, null, 2)}\n`),
  fs.writeFile(path.join(runtimeDir, 'manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`),
]);
console.log(`prepared ${character.id}: ${Object.keys(animations).length} states, ${Object.keys(sources).length} source atlases`);
