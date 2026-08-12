#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'standalone/assets/generated/manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.schema_version !== 1 || !Array.isArray(manifest.sequences)) throw new Error('Invalid generated asset manifest');
for (const sequence of manifest.sequences) {
  for (const field of ['character', 'animation', 'source_frame_a', 'source_frame_b', 'generated_frames', 'accepted']) {
    if (!(field in sequence)) throw new Error(`Generated sequence is missing ${field}`);
  }
  if (!Array.isArray(sequence.generated_frames) || typeof sequence.accepted !== 'boolean') throw new Error('Invalid generated sequence fields');
  await Promise.all([sequence.source_frame_a, sequence.source_frame_b, ...sequence.generated_frames].map((file) => fs.access(path.join(root, file))));
}
console.log(`OK: ${manifest.sequences.length} traceable image2 sequence(s)`);
