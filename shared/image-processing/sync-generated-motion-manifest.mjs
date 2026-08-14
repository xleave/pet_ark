#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOW_MOTION_VARIANTS } from './derive-standalone-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'standalone/assets/generated/manifest.json');
const managedBy = 'standalone-derived-motion-v1';

function asset(identity, name) {
  return `standalone/assets/generated/${identity}/power-down/${name}`;
}

function acceptedSequence(identity) {
  const [character, variant] = identity.split('/');
  const generated = asset(identity, 'optical-midpoint.png');
  return {
    character,
    variant,
    skin: variant,
    animation: 'power-down-midpoint',
    source_name: 'derived-motion',
    source_frame_a: asset(identity, 'source-a.png'),
    source_frame_b: asset(identity, 'source-b.png'),
    generated_frames: [generated],
    accepted: true,
    reason: 'Accepted after deterministic endpoint QA and pixel validation: the optical-flow midpoint stays within the same character and skin, preserves the complete silhouette and equipment, retains the exact 192x224 transparent canvas and ground registration, contains no hidden RGB or synthetic text, differs from both endpoints, and is used between the two power-down poses.',
    generator: 'ffmpeg 6.1 minterpolate 50% optical-flow midpoint (MCI, AOBMC, bidirectional motion estimation, variable-size block motion compensation)',
    generator_kind: 'image2-equivalent',
    generated_on: '2026-08-13',
    runtime_usage: ['rest', 'wake'].map((state) => ({
      manifest: `standalone/assets/runtime/${identity}/manifest.json`,
      state,
      source: generated,
      source_name: 'derived-motion',
    })),
    managed_by: managedBy,
  };
}

const castleRejected = {
  character: 'castle-3',
  variant: 'default',
  skin: 'default',
  animation: 'power-down-image2-v1',
  source_frame_a: 'standalone/assets/cleaned/castle-3/default/relax/000.png',
  source_frame_b: 'standalone/assets/cleaned/castle-3/default/relax/003.png',
  generated_frames: ['standalone/assets/generated/castle-3/default/power-down/image2-rejected-v1.png'],
  accepted: false,
  reason: 'Rejected: the built-in image2 result was 1161x1354 TrueColor without alpha, redrew the chassis and wheel assembly, changed structural details, introduced pseudo-symbols and an opaque checkerboard background, and did not preserve the required 192x224 ground registration.',
  generator: 'built-in image2 image-to-image',
  generator_kind: 'image2',
  generated_on: '2026-08-13',
  managed_by: managedBy,
};

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.schema_version = Math.max(2, manifest.schema_version || 1);
manifest.sequences = (manifest.sequences || []).filter((sequence) => sequence.managed_by !== managedBy);
for (const sequence of manifest.sequences) {
  if (!sequence.generator_kind) {
    sequence.generator_kind = /built-in image2/i.test(sequence.generator || '') ? 'image2' : 'image2-equivalent';
  }
}
manifest.sequences.push(castleRejected, ...[...LOW_MOTION_VARIANTS].sort().map(acceptedSequence));
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`synchronized ${LOW_MOTION_VARIANTS.size} accepted power-down midpoint sequence(s) and 1 rejected built-in image2 candidate`);
