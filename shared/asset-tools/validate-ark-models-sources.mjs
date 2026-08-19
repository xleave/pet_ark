#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roster = JSON.parse(await fs.readFile(path.join(root, 'shared/character-data/standalone-roster.json'), 'utf8'));
const sources = JSON.parse(await fs.readFile(path.join(root, 'shared/character-data/upstream-sources.json'), 'utf8'));
const arkModels = sources.sources.ark_models;
const failures = [];
let checked = 0;
const expectedDirectories = new Set();

async function regularFile(file, label) {
  try {
    if (!(await fs.stat(file)).isFile()) throw new Error('not a regular file');
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

for (const character of roster.characters) {
  for (const variant of character.variants) {
    if (variant.status !== 'source-available') continue;
    const identity = `${character.character_id}/${variant.variant_id}`;
    const sourceDir = path.join(root, 'standalone/assets/source', character.character_id, variant.variant_id);
    expectedDirectories.add(sourceDir);
    let retrieval;
    try {
      retrieval = JSON.parse(await fs.readFile(path.join(sourceDir, 'retrieval.json'), 'utf8'));
    } catch (error) {
      failures.push(`${identity}: retrieval.json: ${error.message}`);
      continue;
    }
    checked++;
    if (retrieval.source_provider !== 'ark-models') failures.push(`${identity}: provider is ${retrieval.source_provider || 'missing'}`);
    if (retrieval.source_commit !== arkModels.commit) failures.push(`${identity}: commit is ${retrieval.source_commit || 'missing'}`);
    if (retrieval.source_page !== arkModels.repository) failures.push(`${identity}: source page is not Ark-Models`);
    const declared = [
      retrieval.files?.atlas,
      retrieval.files?.skeleton,
      ...(retrieval.files?.textures || []).map((entry) => entry.path),
    ].filter(Boolean);
    if (declared.length < 3) failures.push(`${identity}: source file declaration is incomplete`);
    for (const file of declared) {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(`${sourceDir}${path.sep}`)) {
        failures.push(`${identity}: source file escapes its variant directory: ${file}`);
      } else {
        await regularFile(absolute, `${identity}: ${file}`);
      }
    }
    for (const [kind, manifestPath] of [
      ['cleaned', path.join(root, 'standalone/assets/cleaned', character.character_id, variant.variant_id, 'manifest.json')],
      ['runtime', path.join(root, 'standalone/assets/runtime', character.character_id, variant.variant_id, 'manifest.json')],
    ]) {
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const provider = kind === 'runtime' ? manifest.source?.provider : manifest.source_provider;
        const commit = kind === 'runtime' ? manifest.source?.commit : manifest.source_commit;
        if (provider !== 'ark-models' || commit !== arkModels.commit) {
          failures.push(`${identity}: ${kind} manifest does not retain Ark-Models provenance`);
        }
      } catch (error) {
        failures.push(`${identity}: ${kind} manifest: ${error.message}`);
      }
    }
  }
}

const sourceRoot = path.join(root, 'standalone/assets/source');
for (const characterEntry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
  if (!characterEntry.isDirectory()) continue;
  const characterRoot = path.join(sourceRoot, characterEntry.name);
  for (const variantEntry of await fs.readdir(characterRoot, { withFileTypes: true })) {
    if (!variantEntry.isDirectory()) continue;
    const directory = path.join(characterRoot, variantEntry.name);
    if (!expectedDirectories.has(directory)) failures.push(`${characterEntry.name}/${variantEntry.name}: orphan source directory is not permitted`);
  }
}

if (failures.length) {
  console.error(failures.slice(0, 50).join('\n'));
  if (failures.length > 50) console.error(`... ${failures.length - 50} more failure(s)`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${checked} standalone variants use Ark-Models@${arkModels.commit.slice(0, 12)} exclusively`);
}
