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
