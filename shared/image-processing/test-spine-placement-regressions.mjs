#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const variant = path.join(root, 'standalone/assets/cleaned/mon3tr/skin-boc-11');
const manifest = JSON.parse(await fs.readFile(path.join(variant, 'manifest.json'), 'utf8'));

assert.equal(manifest.render_revision, 3, 'Mon3tr sharp skin must use the current Spine renderer');
assert.equal(
  manifest.placement.bounds_policy,
  'core-character-envelope',
  'remote setup attachments must not determine the character scale',
);
assert.ok(manifest.placement.scale >= 0.25, `unexpectedly small placement scale: ${manifest.placement.scale}`);

const { data, info } = await sharp(path.join(variant, 'relax/000.png'))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let minX = info.width;
let minY = info.height;
let maxX = -1;
let maxY = -1;
let visiblePixels = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
    visiblePixels++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
}
const visibleWidth = maxX - minX + 1;
const visibleHeight = maxY - minY + 1;
assert.ok(visibleWidth >= 100, `representative frame is too narrow: ${visibleWidth}px`);
assert.ok(visibleHeight >= 140, `representative frame is too short: ${visibleHeight}px`);
assert.ok(visiblePixels >= 5000, `representative frame has too few visible pixels: ${visiblePixels}`);

console.log(
  `OK: Spine placement regression (Mon3tr sharp scale=${manifest.placement.scale}, `
  + `visible=${visibleWidth}x${visibleHeight}, pixels=${visiblePixels})`,
);
