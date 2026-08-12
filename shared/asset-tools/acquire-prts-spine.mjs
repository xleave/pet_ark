#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'standalone/characters/registry.json'), 'utf8'));

function argument(name, fallback = null) {
  const match = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (match) return match.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  console.log(`downloaded ${path.relative(REPO_ROOT, destination)}`);
}

const characterId = argument('--character', 'amiya');
const character = registry.characters.find((entry) => entry.id === characterId);
if (!character) throw new Error(`Unknown standalone character: ${characterId}`);

const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', character.id);
const metaPath = path.join(sourceDir, 'meta.json');
await download(character.source.meta, metaPath);
const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
const base = `${meta.prefix}${character.source.model}`;
const atlasPath = path.join(sourceDir, `${path.basename(character.source.model)}.atlas`);
await Promise.all([
  download(`${base}.atlas`, atlasPath),
  download(`${base}.skel`, path.join(sourceDir, `${path.basename(character.source.model)}.skel`)),
]);
const atlas = await fs.readFile(atlasPath, 'utf8');
const texture = atlas.split(/\r?\n/).find((line) => line.trim().endsWith('.png'))?.trim();
if (!texture) throw new Error(`No texture page found in ${atlasPath}`);
await download(new URL(texture, `${base}.atlas`).href, path.join(sourceDir, texture));
await fs.writeFile(path.join(sourceDir, 'retrieval.json'), `${JSON.stringify({
  character_id: character.id,
  character_name: character.localized_name,
  source_page: character.source.page,
  source_meta: character.source.meta,
  model: character.source.model,
  retrieval_date: '2026-08-12',
}, null, 2)}\n`);
