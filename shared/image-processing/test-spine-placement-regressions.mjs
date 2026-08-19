#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const variant = path.join(root, 'standalone/assets/cleaned/mon3tr/skin-boc-11');
const manifest = JSON.parse(await fs.readFile(path.join(variant, 'manifest.json'), 'utf8'));

assert.ok(manifest.render_revision >= 3, 'Mon3tr sharp skin must use the core-placement renderer');
assert.ok(
  ['core-character-envelope', 'pixel-density-corrected-envelope'].includes(manifest.placement.bounds_policy),
  `unexpected placement policy: ${manifest.placement.bounds_policy}`,
);
assert.deepEqual(
  manifest.placement.source_bounds,
  manifest.placement.core_source_bounds,
  'remote setup attachments must not determine the character envelope',
);
assert.ok(manifest.placement.scale >= 0.25, `unexpectedly small placement scale: ${manifest.placement.scale}`);

async function visibleMetrics(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

const mon3trVisible = await visibleMetrics(path.join(variant, 'relax/000.png'));
assert.ok(mon3trVisible.width >= 100, `representative frame is too narrow: ${mon3trVisible.width}px`);
assert.ok(mon3trVisible.height >= 138, `representative frame is too short: ${mon3trVisible.height}px`);
assert.ok(mon3trVisible.pixels >= 5000, `representative frame has too few visible pixels: ${mon3trVisible.pixels}`);

const densityVariant = path.join(root, 'standalone/assets/cleaned/lunacub/skin-yun-1');
const densityManifest = JSON.parse(await fs.readFile(path.join(densityVariant, 'manifest.json'), 'utf8'));
assert.equal(densityManifest.placement_revision, 3, 'small-body skins must use pixel-density placement');
assert.equal(densityManifest.placement.bounds_policy, 'pixel-density-corrected-envelope');
const densityVisible = await visibleMetrics(path.join(densityVariant, 'relax/000.png'));
assert.ok(densityVisible.width >= 70, `density-corrected frame is too narrow: ${densityVisible.width}px`);
assert.ok(densityVisible.height >= 130, `density-corrected frame is too short: ${densityVisible.height}px`);

const angelinaVariant = path.join(root, 'standalone/assets/cleaned/angelina-the-mellow-wish/default');
const angelinaManifest = JSON.parse(await fs.readFile(path.join(angelinaVariant, 'manifest.json'), 'utf8'));
assert.ok(angelinaManifest.render_revision >= 4, 'Angelina closed-eye frames require Spine tint and clipping');
const angelinaClosed = await sharp(path.join(angelinaVariant, 'interact/007.png'))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const eyeProbe = (83 * angelinaClosed.info.width + 72) * angelinaClosed.info.channels;
const [eyeRed, eyeGreen, eyeBlue, eyeAlpha] = angelinaClosed.data.subarray(eyeProbe, eyeProbe + 4);
assert.ok(eyeAlpha > 200, 'Angelina closed-eye probe must remain visible');
assert.ok(
  Math.max(eyeRed, eyeGreen, eyeBlue) - Math.min(eyeRed, eyeGreen, eyeBlue) < 16,
  `Angelina closed-eye mask leaked the open red iris: ${eyeRed},${eyeGreen},${eyeBlue}`,
);

console.log(
  `OK: Spine placement regression (Mon3tr sharp scale=${manifest.placement.scale}, `
  + `visible=${mon3trVisible.width}x${mon3trVisible.height}, pixels=${mon3trVisible.pixels}; `
  + `Lunacub=${densityVisible.width}x${densityVisible.height}; Angelina eye=${eyeRed},${eyeGreen},${eyeBlue})`,
);
