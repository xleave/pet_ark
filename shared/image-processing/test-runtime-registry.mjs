#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildRuntimeRegistry } from './build-runtime-registry.mjs';

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function variant(id, runtimeStatus, sourceStatus = 'source-available') {
  return {
    variant_id: id,
    variant_type: id === 'default' ? 'base_form' : 'skin',
    skin_id: id === 'default' ? null : id,
    skin_name: id === 'default' ? null : id,
    status: sourceStatus,
    runtime: {
      status: runtimeStatus,
      path: runtimeStatus === 'implemented' ? `stale/${id}/manifest.json` : null,
      fallback_variant_id: id === 'default' ? null : 'default',
    },
  };
}

function character(id, variants) {
  return {
    character_id: id,
    character_name: id,
    localized_name: id,
    default_variant_id: 'default',
    source_page: `https://example.invalid/${id}`,
    variants,
  };
}

function runtimeManifest(characterId, variantId) {
  return {
    character: {
      id: characterId,
      movement: {
        walkPixelsPerSecond: 68,
        runPixelsPerSecond: 116,
        idleMinSeconds: 4,
        idleMaxSeconds: 11,
        restAfterSeconds: 75,
      },
    },
    variant: { id: variantId },
    animations: {
      idle: { source: 'idle', frameOrder: [0], fps: 1, loop: true },
    },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-ark-runtime-registry-'));
try {
  const rosterPath = path.join(root, 'shared/character-data/standalone-roster.json');
  const sourcesPath = path.join(root, 'shared/character-data/standalone-sources.json');
  const registryPath = path.join(root, 'standalone/characters/registry.json');
  const roster = {
    schema_version: 2,
    statistics: { expected_variants: 3, source_available_variants: 2 },
    characters: [
      character('ready', [variant('default', 'pending'), variant('skin-one', 'implemented')]),
      character('blocked', [variant('default', 'authorization-blocked', 'source-unavailable')]),
    ],
  };
  const sources = {
    schema_version: 2,
    statistics: { expected_variants: 3, source_available_variants: 2 },
  };
  await writeJson(rosterPath, roster);
  await writeJson(sourcesPath, sources);
  await writeJson(
    path.join(root, 'standalone/assets/runtime/ready/default/manifest.json'),
    runtimeManifest('ready', 'default'),
  );

  await buildRuntimeRegistry(root);
  const syncedRoster = JSON.parse(await fs.readFile(rosterPath, 'utf8'));
  const syncedSources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  const [ready, blocked] = syncedRoster.characters;
  assert.equal(ready.variants[0].runtime.status, 'implemented');
  assert.equal(ready.variants[0].runtime.path, 'standalone/assets/runtime/ready/default/manifest.json');
  assert.equal(ready.variants[1].runtime.status, 'pending');
  assert.equal(ready.variants[1].runtime.path, null);
  assert.equal(blocked.variants[0].runtime.status, 'authorization-blocked');
  assert.equal(blocked.variants[0].runtime.path, null);
  assert.equal(blocked.variants[0].status, 'source-unavailable');
  assert.equal(syncedRoster.statistics.implemented_runtime_variants, 1);
  assert.equal(syncedSources.statistics.implemented_runtime_variants, 1);
  assert.equal(registry.characters.length, 1);
  assert.deepEqual(registry.characters[0].variants.map((entry) => entry.id), ['default']);

  await fs.rm(path.join(root, 'standalone/assets/runtime/ready/default/manifest.json'));
  await buildRuntimeRegistry(root);
  const emptyRoster = JSON.parse(await fs.readFile(rosterPath, 'utf8'));
  const emptySources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const emptyRegistry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  assert.equal(emptyRoster.characters[0].variants[0].runtime.status, 'pending');
  assert.equal(emptyRoster.characters[0].variants[0].runtime.path, null);
  assert.equal(emptyRoster.characters[1].variants[0].runtime.status, 'authorization-blocked');
  assert.equal(emptyRoster.statistics.implemented_runtime_variants, 0);
  assert.equal(emptySources.statistics.implemented_runtime_variants, 0);
  assert.deepEqual(emptyRegistry.characters, []);
  const leftovers = (await Promise.all([
    path.dirname(registryPath),
    path.dirname(rosterPath),
  ].map(async (directory) => (await fs.readdir(directory))
    .filter((entry) => entry.includes('.partial-')))))
    .flat();
  assert.deepEqual(leftovers, []);
  console.log('OK: runtime registry synchronization fixture (implemented, pending, blocked, empty)');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
