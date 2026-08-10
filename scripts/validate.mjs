import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'dist', 'priestess-chibi');
const sheet = path.join(DIR, 'spritesheet.webp');
const petFile = path.join(DIR, 'pet.json');

const meta = await sharp(sheet).metadata();
if (meta.width !== 1536 || meta.height !== 1872) throw new Error(`Expected 1536x1872, got ${meta.width}x${meta.height}`);
if (meta.channels !== 4 || !meta.hasAlpha) throw new Error('Spritesheet must contain alpha transparency');

const pet = JSON.parse(await fs.readFile(petFile, 'utf8'));
for (const key of ['id', 'displayName', 'description', 'spritesheetPath']) {
  if (!pet[key]) throw new Error(`pet.json missing ${key}`);
}
if (pet.spritesheetPath !== 'spritesheet.webp') throw new Error('spritesheetPath must point to spritesheet.webp');

const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let transparent = 0;
let visible = 0;
let dirtyTransparentRgb = 0;
for (let i = 3; i < data.length; i += info.channels) {
  if (data[i] === 0) {
    transparent++;
    if (data[i - 3] || data[i - 2] || data[i - 1]) dirtyTransparentRgb++;
  }
  if (data[i] > 8) visible++;
}
if (!transparent || !visible) throw new Error('Expected both transparent and visible pixels');
if (dirtyTransparentRgb) throw new Error(`Found ${dirtyTransparentRgb} transparent pixels with non-zero hidden RGB`);
console.log(`OK: ${meta.width}x${meta.height}, alpha=yes, transparent=${transparent}, visible=${visible}, hidden-rgb=clean`);
