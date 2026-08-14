#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  EXPECTED_DIST_MANIFESTS,
  validateDistManifestHygiene,
} from './dist-manifest-hygiene.mjs';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-ark-dist-manifest-hygiene-'));
try {
  await Promise.all(EXPECTED_DIST_MANIFESTS.map((name) => fs.writeFile(path.join(fixture, name), '{}\n')));
  assert.deepEqual(
    (await validateDistManifestHygiene(fixture)).manifests,
    [...EXPECTED_DIST_MANIFESTS].sort(),
  );

  await fs.writeFile(path.join(fixture, 'tmp-selection.json'), '{}\n');
  await assert.rejects(
    validateDistManifestHygiene(fixture),
    /unexpected: tmp-selection\.json/,
  );
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

console.log('OK: standalone dist manifest hygiene tests');
