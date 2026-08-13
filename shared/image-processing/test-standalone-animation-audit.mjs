#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  animationOrigin,
  auditVariant,
  bridgeDoubleExposure,
  classifyTransition,
  compareAnimationSequences,
  compareTransitionFrames,
  semanticFallback,
  uniqueFrameCount,
} from './standalone-animation-audit.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

function pixels(...values) {
  return Buffer.from(values);
}

function sequence(state, frames, options = {}) {
  return {
    state,
    source: options.source || state,
    frames: frames.map((frame, index) => ({ index, pixels: frame })),
    fps: options.fps || 12,
    mirror: Boolean(options.mirror),
  };
}

const a = pixels(1, 2, 3, 255);
const b = pixels(4, 5, 6, 255);
const c = pixels(7, 8, 9, 255);

assert.equal(uniqueFrameCount(sequence('idle', [a, a, b]).frames), 2);
assert.equal(semanticFallback('special', 'interact').used, true);
assert.equal(semanticFallback('sleep', 'relax').used, true);
assert.equal(semanticFallback('special', 'derived-motion', false, { state: 'special', intent: 'special' }).used, false);
assert.equal(semanticFallback('dragging', 'derived-motion', false, { state: 'dragging', intent: 'dragging' }).used, false);

assert.equal(animationOrigin({
  state: 'special',
  animation: { origin: 'derived', frameOrder: [0, 1, 2], provenanceId: 'special-special' },
  source: { origin: 'derived' },
  derivedProvenance: [{ id: 'special-special', state: 'special' }],
  generatedProvenance: [],
}), 'derived');
assert.equal(animationOrigin({
  state: 'sleep',
  animation: { origin: 'source', frameOrder: [0, 1, 2], generatedFrames: [1] },
  source: { origin: 'source', generatedFrames: 1 },
  derivedProvenance: [],
  generatedProvenance: [],
}), 'generated');

const duplicates = compareAnimationSequences([
  sequence('walk-left', [a, b, c], { source: 'move', mirror: true }),
  sequence('walk-right', [a, b, c], { source: 'move' }),
  sequence('run-right', [a, b, c], { source: 'move', fps: 18 }),
  sequence('sleep', [a, b, c], { source: 'sleep' }),
  sequence('wake', [c, b, a], { source: 'sleep' }),
  sequence('clicked', [a, b, c], { source: 'interact' }),
  sequence('special', [a, b, c], { source: 'interact' }),
]);

function pair(left, right) {
  return duplicates.find((duplicate) => duplicate.states.includes(left) && duplicate.states.includes(right));
}

assert.equal(pair('walk-left', 'walk-right').classification, 'directional-mirror');
assert.equal(pair('walk-right', 'run-right').classification, 'timing-variation');
assert.equal(pair('sleep', 'wake').classification, 'sleep-wake-transition');
assert.equal(pair('clicked', 'special').classification, 'semantic-duplicate');
assert.equal(pair('clicked', 'special').intentional, false);

const restWake = compareAnimationSequences([
  sequence('rest', [a, b, c], { source: 'power-down' }),
  sequence('wake', [c, b, a], { source: 'power-down' }),
])[0];
assert.equal(restWake.classification, 'rest-wake-transition');
assert.equal(restWake.intentional, true);

const staticReuse = compareAnimationSequences([
  sequence('idle', [a, a], { source: 'idle' }),
  sequence('rest', [a, a], { source: 'rest' }),
])[0];
assert.ok(staticReuse.signals.includes('exact_duplicate_animation'));
assert.ok(staticReuse.signals.includes('static_reused_state'));

const identicalTransition = compareTransitionFrames(
  Buffer.from([
    0, 0, 0, 0, 20, 30, 40, 255,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  Buffer.from([
    0, 0, 0, 0, 20, 30, 40, 255,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  2,
  2,
);
assert.equal(identicalTransition.ground_anchor_delta_px, 0);
assert.equal(identicalTransition.alpha_iou, 1);
assert.equal(identicalTransition.mean_abs_rgba, 0);
assert.equal(classifyTransition(identicalTransition).level, 'pass');

const blankTransition = compareTransitionFrames(
  Buffer.alloc(2 * 2 * 4),
  Buffer.from([
    20, 30, 40, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  2,
  2,
);
assert.equal(blankTransition.blank_endpoint, true);
assert.equal(classifyTransition(blankTransition).level, 'severe');

const leftPose = Buffer.alloc(4 * 2 * 4);
const rightPose = Buffer.alloc(4 * 2 * 4);
for (const [buffer, x] of [[leftPose, 0], [rightPose, 3]]) {
  const offset = x * 4;
  buffer[offset] = 90;
  buffer[offset + 1] = 100;
  buffer[offset + 2] = 110;
  buffer[offset + 3] = 255;
}
const overlappedPoses = Buffer.from(leftPose);
rightPose.copy(overlappedPoses, 0, 0, rightPose.length);
// Re-add the left silhouette after the copy so the bridge frame visibly holds
// two disjoint poses at once.
leftPose.copy(overlappedPoses, 0, 0, 4);
assert.equal(bridgeDoubleExposure(overlappedPoses, leftPose, rightPose, 4, 2).candidate, true);
assert.equal(bridgeDoubleExposure(leftPose, leftPose, rightPose, 4, 2).candidate, false);

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-ark-animation-audit-'));
try {
  const manifestFile = path.join(fixture, 'runtime', 'fixture', 'default', 'manifest.json');
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await assert.rejects(
    auditVariant({
      manifestFile,
      manifest: {
        character: { id: 'fixture' },
        variant: { id: 'default' },
        frameSize: { width: 1, height: 1 },
        sources: { idle: { sheet: '../other-variant/idle.png', columns: 1, rows: 1, frames: 1 } },
        animations: {},
      },
    }),
    /source sheet leaves the variant runtime directory/,
  );
  await assert.rejects(
    auditVariant({
      manifestFile,
      manifest: {
        character: { id: 'wrong-character' },
        variant: { id: 'default' },
        frameSize: { width: 1, height: 1 },
        sources: {},
        animations: {},
      },
    }),
    /runtime path identity does not match/,
  );

  const runtimeDir = path.dirname(manifestFile);
  const derivedPixels = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 96,
    255, 255, 255, 255,
    255, 0, 255, 255,
  ]);
  await Promise.all([
    sharp(derivedPixels, { raw: { width: 5, height: 1, channels: 4 } }).png().toFile(path.join(runtimeDir, 'derived.png')),
    sharp(Buffer.from([255, 255, 255, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toFile(path.join(runtimeDir, 'idle.png')),
    sharp(Buffer.alloc(4), { raw: { width: 1, height: 1, channels: 4 } }).png().toFile(path.join(runtimeDir, 'blank.png')),
  ]);
  const bridgeFixture = {
    character: { id: 'fixture' },
    variant: { id: 'default' },
    frameSize: { width: 1, height: 1 },
    sources: {
      'derived-motion': { sheet: 'derived.png', columns: 5, rows: 1, frames: 5, origin: 'derived' },
      idle: { sheet: 'idle.png', columns: 1, rows: 1, frames: 1, origin: 'source' },
      blank: { sheet: 'blank.png', columns: 1, rows: 1, frames: 1, origin: 'source' },
    },
    animations: {
      dropped: {
        source: 'derived-motion', frameOrder: [0, 1, 2, 3], fps: 12, loop: false, next: 'idle',
        provenanceId: 'dropped-settle', transitionFromProvenanceId: 'dropped-core', transitionBridge: 'dropped-settle',
      },
      idle: { source: 'idle', frameOrder: [0], fps: 8, loop: true, next: null, provenanceId: 'source-idle' },
    },
    provenance: {
      derivedAnimations: [
        { id: 'dropped-core', state: 'dropped-motion', intent: 'landing', atlas_frames: [0, 1] },
        { id: 'dropped-settle', state: 'dropped-settle', intent: 'dropped', atlas_frames: [2, 3] },
        { id: 'orphan-derived', state: 'special', intent: 'special', atlas_frames: [4] },
      ],
    },
  };
  const bridgeAudit = await auditVariant({ manifestFile, manifest: bridgeFixture, cleanedManifest: { processed_states: {} } });
  assert.equal(bridgeAudit.states.dropped.core_frame_count, 2);
  assert.equal(bridgeAudit.states.dropped.displayed_frame_count, 4);
  assert.equal(bridgeAudit.states.dropped.transition_bridge_frame_count, 2);
  assert.equal(bridgeAudit.states.dropped.unique_frame_count, 2);
  assert.ok(bridgeAudit.states.dropped.issues.some((issue) => issue.includes('at least 4 core frames')));
  assert.equal(bridgeAudit.transition_bridges.invalid_structure, 0);
  assert.equal(bridgeAudit.transition_bridges.endpoint_mismatches, 0);
  assert.equal(bridgeAudit.blank_frames.unexpected, 1, '1x1 hitbox/transparent pixels must not imply intentional blank');
  assert.equal(bridgeAudit.derived_frames.provenance_unreferenced, 1);

  const blankReason = 'The fixture source intentionally disappears for one explicitly documented transition beat.';
  const declaredBlankFixture = structuredClone(bridgeFixture);
  declaredBlankFixture.sources.blank.intentionalBlankFrames = [{
    frame: 0,
    sourceFrame: 0,
    reason: blankReason,
    declaration: 'standalone/assets/cleaned/fixture/default/manifest.json',
  }];
  const declaredBlankAudit = await auditVariant({
    manifestFile,
    manifest: declaredBlankFixture,
    cleanedManifest: {
      processed_states: {
        blank: { intentional_blank_frames: [{ frame: 0, reason: blankReason }] },
      },
    },
  });
  assert.equal(declaredBlankAudit.blank_frames.intentional, 1);
  assert.equal(declaredBlankAudit.blank_frames.unexpected, 0);
  assert.equal(declaredBlankAudit.blank_frames.invalid_declarations, 0);

  const missingProvenanceFixture = structuredClone(declaredBlankFixture);
  missingProvenanceFixture.provenance.derivedAnimations = missingProvenanceFixture.provenance.derivedAnimations
    .filter((entry) => entry.id !== 'dropped-core');
  const missingProvenanceAudit = await auditVariant({
    manifestFile,
    manifest: missingProvenanceFixture,
    cleanedManifest: {
      processed_states: {
        blank: { intentional_blank_frames: [{ frame: 0, reason: blankReason }] },
      },
    },
  });
  assert.equal(missingProvenanceAudit.derived_frames.missing_provenance, 2);
  assert.ok(missingProvenanceAudit.states.dropped.issues.some((issue) => issue.includes('has no derived provenance')));
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

console.log('OK: standalone animation audit pixel-comparison tests');
