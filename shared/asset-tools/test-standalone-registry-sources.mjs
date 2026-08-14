#!/usr/bin/env node

import assert from 'node:assert/strict';

import { referencedRuntimeSourceEntries } from './standalone-registry-sources.mjs';

const sources = {
  idle: { sheet: 'idle.png' },
  provenance_only: { sheet: 'source-only.png' },
  movement: { sheet: 'movement.png' },
};
const animations = {
  idle: { source: 'idle' },
  clicked: { source: 'idle' },
  'walk-right': { source: 'movement' },
};

assert.deepEqual(
  referencedRuntimeSourceEntries(sources, animations, 'fixture').map(([sourceId]) => sourceId),
  ['idle', 'movement'],
);
assert.throws(
  () => referencedRuntimeSourceEntries(sources, { broken: { source: 'missing' } }, 'fixture'),
  /fixture:broken: missing animation source missing/,
);
assert.throws(
  () => referencedRuntimeSourceEntries(sources, { broken: {} }, 'fixture'),
  /fixture:broken: animation source is required/,
);

console.log('OK: standalone C registry emits only animation-referenced sources');
