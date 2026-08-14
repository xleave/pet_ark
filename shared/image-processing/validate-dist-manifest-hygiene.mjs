#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDistManifestHygiene,
} from './dist-manifest-hygiene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(ROOT, 'standalone/dist/manifests');

async function removeTemporarySelectionDirectories() {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.selection-'))
    .map((entry) => fs.rm(path.join(directory, entry.name), { recursive: true, force: true })));
}

await removeTemporarySelectionDirectories();
validateDistManifestHygiene(directory).then(({ manifests }) => {
  console.log(`OK: standalone dist manifest hygiene (${manifests.length} maintained files)`);
}).catch((error) => {
  console.error(`standalone dist manifest hygiene: ${error.message}`);
  process.exitCode = 1;
});
