#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  deriveStandaloneAnimations,
  selectStandaloneAnimations,
  validateStandaloneAnimationContract,
} from './standalone-animation-contract.mjs';

const complete = ['Relax', 'Move', 'Interact', 'Special', 'Sit', 'Sleep', 'Exit', 'zF_Idle', 'Relax_Idle', 'Move2'];
const animations = deriveStandaloneAnimations(complete);
assert.equal(animations.clicked.source, 'Interact');
assert.equal(animations.special.source, 'Special');
assert.deepEqual(animations.exit, { source: 'Exit', fps: 12, loop: false, next: 'idle' });
assert.deepEqual(animations['idle-alt'], { source: 'zF_Idle', fps: 12, loop: true });
assert.deepEqual(animations['move-alt'], { source: 'Move2', fps: 12, loop: true });
assert.doesNotThrow(() => validateStandaloneAnimationContract(animations, complete, 'fixture'));

const common = deriveStandaloneAnimations(['relax', 'move', 'interact', 'sit', 'sleep']);
assert.equal(common.special.source, 'interact');
assert.equal(Object.keys(common).length, 13);
assert.equal(
  deriveStandaloneAnimations(['relax', 'move', 'interact', 'sit', 'sleep', 'relax_idle'])['idle-alt'].source,
  'relax_idle',
);
assert.throws(
  () => validateStandaloneAnimationContract({ ...animations, special: { ...animations.special, source: 'Interact' } }, complete, 'fixture'),
  /special must use Special/,
);
assert.throws(
  () => validateStandaloneAnimationContract({ ...animations, exit: undefined }, complete, 'fixture'),
  /Exit must be exposed as exit/,
);

const derivedExitProvenance = [
  {
    id: 'exit-source-exit',
    state: 'exit-source',
    intent: 'exit',
    origin: 'derived',
    operation: 'physical-exit-runtime-copy',
    source_animation: 'exit',
    source_frames: ['standalone/assets/cleaned/fixture/default/exit/000.png'],
    atlas_frames: [20, 21],
  },
  {
    id: 'exit-settle-exit',
    state: 'exit-settle',
    intent: 'exit',
    origin: 'derived',
    operation: 'exit-to-idle-registration-bridge',
    source_animation: 'exit',
    source_frames: [],
    atlas_frames: [22, 23],
    bridge_style: 'single-silhouette-endpoint-transform',
  },
];
const derivedExit = {
  ...animations,
  exit: {
    source: 'derived-motion',
    origin: 'derived',
    provenanceId: 'exit-settle-exit',
    transitionFromProvenanceId: 'exit-source-exit',
    transitionBridge: 'exit-settle-exit',
    frameOrder: [20, 21, 22, 23],
    fps: 12,
    loop: false,
    next: 'idle',
  },
};
assert.doesNotThrow(() => validateStandaloneAnimationContract(
  derivedExit,
  complete,
  'derived fixture',
  { derivedAnimations: derivedExitProvenance },
));
assert.throws(
  () => validateStandaloneAnimationContract(derivedExit, complete, 'derived fixture'),
  /transitionFromProvenanceId must resolve to exactly one provenance sequence/,
);
assert.throws(
  () => validateStandaloneAnimationContract(derivedExit, complete, 'derived fixture', {
    derivedAnimations: derivedExitProvenance.map((entry) => entry.id === 'exit-source-exit'
      ? { ...entry, source_animation: 'interact' }
      : entry),
  }),
  /must retain physical Exit provenance/,
);
assert.throws(
  () => validateStandaloneAnimationContract({
    ...derivedExit,
    exit: { ...derivedExit.exit, frameOrder: [20, 22, 21, 23] },
  }, complete, 'derived fixture', { derivedAnimations: derivedExitProvenance }),
  /must play physical Exit before its settle bridge/,
);
assert.throws(
  () => validateStandaloneAnimationContract({
    ...animations,
    'idle-alt': { ...animations['idle-alt'], loop: false },
  }, complete, 'fixture'),
  /idle-alt loop must be true/,
);
assert.throws(
  () => validateStandaloneAnimationContract({
    ...animations,
    'move-alt': { ...animations['move-alt'], source: 'Move' },
  }, complete, 'fixture'),
  /move-alt must use Move2/,
);
assert.throws(
  () => validateStandaloneAnimationContract({
    ...animations,
    'idle-alt': {
      source: 'derived-motion',
      origin: 'derived',
      provenanceId: 'idle-alt-derived',
      loop: true,
    },
  }, complete, 'fixture', { derivedAnimations: derivedExitProvenance }),
  /idle-alt must use zF_Idle/,
);

const staleRegistryAnimations = { idle: { source: 'stale', fps: 1, loop: true } };
assert.equal(selectStandaloneAnimations({
  available: complete,
  legacyAnimations: staleRegistryAnimations,
  legacySchemaVersion: 2,
}).special.source, 'Special');
assert.equal(selectStandaloneAnimations({
  available: complete,
  legacyAnimations: staleRegistryAnimations,
  legacySchemaVersion: 1,
}), staleRegistryAnimations);
assert.equal(selectStandaloneAnimations({
  available: complete,
  variantAnimations: staleRegistryAnimations,
  legacyAnimations: animations,
  legacySchemaVersion: 2,
}), staleRegistryAnimations);

console.log('OK: standalone animation contract (physical special priority and optional states)');
