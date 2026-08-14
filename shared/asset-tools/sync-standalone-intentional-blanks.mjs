#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DECLARATIONS = path.join(ROOT, 'shared/character-data/standalone-intentional-blanks.json');
const CLEANED = path.join(ROOT, 'standalone/assets/cleaned');

function assertReason(identity, state, entry) {
  if (!Number.isInteger(entry.frame) || entry.frame < 0) {
    throw new Error(`${identity}:${state}: intentional blank frame must be a non-negative integer`);
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
    throw new Error(`${identity}:${state}:${entry.frame}: intentional blank requires a concrete reason`);
  }
}

async function isTransparent(file) {
  const pixels = await sharp(file).ensureAlpha().raw().toBuffer();
  for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) return false;
  return true;
}

const declarations = JSON.parse(await fs.readFile(DECLARATIONS, 'utf8'));
const touched = new Set();
let declaredFrames = 0;
for (const declaration of declarations.declarations || []) {
  const identity = `${declaration.character}/${declaration.variant}`;
  const manifestFile = path.join(CLEANED, identity, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.character !== declaration.character || manifest.variant !== declaration.variant) {
    throw new Error(`${identity}: cleaned manifest identity mismatch`);
  }
  const state = manifest.processed_states?.[declaration.state];
  if (!state) throw new Error(`${identity}: cleaned state '${declaration.state}' is missing`);
  const seen = new Set();
  for (const entry of declaration.frames || []) {
    assertReason(identity, declaration.state, entry);
    if (entry.frame >= state.frames) throw new Error(`${identity}:${declaration.state}:${entry.frame}: frame is outside source range`);
    if (seen.has(entry.frame)) throw new Error(`${identity}:${declaration.state}:${entry.frame}: duplicate declaration`);
    seen.add(entry.frame);
    const frameFile = path.join(CLEANED, identity, declaration.state, `${String(entry.frame).padStart(3, '0')}.png`);
    if (!await isTransparent(frameFile)) {
      throw new Error(`${identity}:${declaration.state}:${entry.frame}: declared frame contains visible pixels`);
    }
  }
  state.intentional_blank_frames = declaration.frames.map((entry) => ({ frame: entry.frame, reason: entry.reason.trim() }));
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  touched.add(identity);
  declaredFrames += declaration.frames.length;
}

console.log(`synchronized ${declaredFrames} intentional blank frame declaration(s) across ${touched.size} cleaned variant manifest(s)`);
