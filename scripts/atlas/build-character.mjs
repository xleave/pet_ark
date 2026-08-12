import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { ACTIVE_FRAME_COUNT, ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT, CELL_WIDTH, COLUMNS, ROWS, STATES, DEFINITION_USAGE } from '../config.mjs';
import { ROOT } from '../registry/load.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const execFileAsync = promisify(execFile);

async function mapBounded(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export function serializableDefinition(definition) {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => key !== 'renderFrame'));
}

export async function buildCharacter(definition, { frameConcurrency = 4 } = {}) {
  const outputDir = path.join(ROOT, 'dist', definition.id);
  const framesDir = path.join(outputDir, 'frames');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });
  const jobs = STATES.flatMap((state, row) => Array.from({ length: state.frames }, (_, frame) => ({ state, row, frame })));
  const rendered = await mapBounded(jobs, frameConcurrency, async ({ state, row, frame }) => {
    const svg = definition.renderFrame(state.id, frame);
    const filename = `${String(row).padStart(2, '0')}-${state.id}-${String(frame).padStart(2, '0')}.png`;
    const framePath = path.join(framesDir, filename);
    const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    await fs.writeFile(framePath, buffer);
    return { input: buffer, left: frame * CELL_WIDTH, top: row * CELL_HEIGHT };
  });

  const raw = await sharp({
    create: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(rendered).ensureAlpha().raw().toBuffer();
  for (let index = 0; index < raw.length; index += 4) {
    if (raw[index + 3] === 0) raw[index] = raw[index + 1] = raw[index + 2] = 0;
  }
  const temporaryPng = path.join(outputDir, '.spritesheet.png');
  const sheetPath = path.join(outputDir, 'spritesheet.webp');
  await sharp(raw, { raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 } }).png({ compressionLevel: 9 }).toFile(temporaryPng);
  const webpMethod = definition.id === 'priestess-chibi' ? '6' : '0';
  await execFileAsync('python3', [path.join(ROOT, 'scripts', 'encode-webp-exact.py'), temporaryPng, sheetPath, webpMethod]);
  await fs.unlink(temporaryPng);

  const displayName = definition.id === 'priestess-chibi' ? '普瑞赛斯·Q版' : `${definition.localized_name}·Q版`;
  const pet = {
    id: definition.id,
    displayName,
    description: definition.id === 'priestess-chibi'
      ? '以《明日方舟》普瑞赛斯为灵感设计的 Q 版 Codex 桌宠，按 Codex 官方行帧数制作。'
      : `以《明日方舟》${definition.localized_name}为设计依据的代码绘制 Q 版 Codex Pet。`,
    spritesheetPath: 'spritesheet.webp',
  };
  const manifest = {
    character: serializableDefinition(definition),
    atlas: { columns: COLUMNS, rows: ROWS, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT, width: ATLAS_WIDTH, height: ATLAS_HEIGHT },
    states: STATES.map((state, row) => ({ id: state.id, row, frames: state.frames })),
    activeFrameCount: ACTIVE_FRAME_COUNT,
    rendererUses: DEFINITION_USAGE,
    style: 'source-analyzed, code-drawn chibi vector rendered to lossless WebP',
  };
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'pet.json'), `${JSON.stringify(pet, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  return { id: definition.id, outputDir, activeFrames: jobs.length };
}
