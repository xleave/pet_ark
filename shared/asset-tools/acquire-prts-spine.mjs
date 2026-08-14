#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROSTER_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-roster.json');
const roster = JSON.parse(await fs.readFile(ROSTER_PATH, 'utf8'));
const args = process.argv.slice(2);

function argument(name, fallback = null) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positiveInteger(name, fallback, maximum) {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function safeRelativeAssetPath(value) {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Unsafe texture path in atlas: ${value}`);
  }
  return normalized;
}

function atlasTextureNames(atlasText) {
  const lines = atlasText.split(/\r?\n/);
  const names = [];
  let blockStart = true;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) {
      blockStart = true;
      continue;
    }
    if (!blockStart) continue;
    blockStart = false;
    const next = lines.slice(index + 1).map((value) => value.trim()).find(Boolean) ?? '';
    if (/\.(?:png|webp)$/i.test(line) && /^(?:size|format|filter|repeat):/i.test(next)) {
      names.push(safeRelativeAssetPath(line));
    }
  }
  return [...new Set(names)];
}

async function fileIsPresent(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

async function download(url, destination, { force = false } = {}) {
  if (!force && await fileIsPresent(destination)) {
    return { path: destination, url, resumed: true };
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      const temporary = `${destination}.partial-${process.pid}`;
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      await fs.rename(temporary, destination);
      console.log(`downloaded ${path.relative(REPO_ROOT, destination)}`);
      return { path: destination, url, resumed: false };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

function matchingVariant(character, selector) {
  if (!selector) return character.variants.find((variant) => variant.variant_id === character.default_variant_id);
  const lowered = selector.toLocaleLowerCase();
  return character.variants.find((variant) => [
    variant.variant_id,
    variant.id,
    variant.skin_id,
    variant.skin_name,
    variant.name,
  ].filter(Boolean).some((value) => String(value).toLocaleLowerCase() === lowered));
}

function selectedJobs() {
  const all = args.includes('--all');
  const characterId = argument('--character', all ? null : 'amiya');
  const selector = argument('--variant', argument('--skin'));
  const characters = characterId
    ? roster.characters.filter((character) => character.character_id === characterId)
    : roster.characters;
  if (!characters.length) throw new Error(`Unknown standalone character: ${characterId}`);

  const jobs = [];
  for (const character of characters) {
    const variants = all && !selector
      ? character.variants
      : [matchingVariant(character, selector)].filter(Boolean);
    if (!variants.length && characterId) {
      throw new Error(`Unknown standalone variant for ${character.character_id}: ${selector}`);
    }
    for (const variant of variants) {
      if (variant.status !== 'source-available') continue;
      jobs.push({ character, variant });
    }
  }
  if (!jobs.length) throw new Error('No source-available standalone variants matched the selection');
  return jobs;
}

async function mapBounded(values, concurrency, work) {
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        await work(values[index], index);
      } catch (error) {
        failures.push({ value: values[index], error });
        console.error(`FAILED ${values[index].character.character_id}/${values[index].variant.variant_id}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return failures;
}

async function acquire({ character, variant }) {
  const sourceDir = path.join(
    REPO_ROOT,
    'standalone/assets/source',
    character.character_id,
    variant.variant_id,
  );
  const assets = variant.source_asset_set;
  const modelBaseName = path.basename(assets.model);
  const metaPath = path.join(sourceDir, 'meta.json');
  const atlasPath = path.join(sourceDir, `${modelBaseName}.atlas`);
  const skeletonPath = path.join(sourceDir, `${modelBaseName}.skel`);
  const force = args.includes('--force');

  await Promise.all([
    download(assets.meta, metaPath, { force }),
    download(assets.atlas, atlasPath, { force }),
    download(assets.skel, skeletonPath, { force }),
  ]);

  const atlasText = await fs.readFile(atlasPath, 'utf8');
  const textureNames = atlasTextureNames(atlasText);
  if (!textureNames.length) throw new Error(`No texture page found in ${atlasPath}`);

  const atlasBase = new URL('.', assets.atlas);
  const textureFiles = [];
  for (const textureName of textureNames) {
    const destination = path.join(sourceDir, textureName);
    const url = new URL(textureName, atlasBase).href;
    await download(url, destination, { force });
    textureFiles.push({
      source: url,
      path: path.relative(REPO_ROOT, destination),
    });
  }

  const retrieval = {
    schema_version: 2,
    character_id: character.character_id,
    character_name: character.character_name,
    localized_name: character.localized_name,
    game_key: character.game_key,
    variant_id: variant.variant_id,
    variant_type: variant.variant_type,
    variant_name: variant.name,
    skin_id: variant.skin_id,
    skin_name: variant.skin_name,
    source_page: character.source_page,
    source_meta: character.source_meta,
    source_asset_set: assets,
    retrieval_date: roster.retrieved_at,
    files: {
      meta: path.relative(REPO_ROOT, metaPath),
      atlas: path.relative(REPO_ROOT, atlasPath),
      skeleton: path.relative(REPO_ROOT, skeletonPath),
      textures: textureFiles,
    },
  };
  await fs.writeFile(path.join(sourceDir, 'retrieval.json'), `${JSON.stringify(retrieval, null, 2)}\n`);
  console.log(`ready ${character.character_id}/${variant.variant_id}`);
}

const jobs = selectedJobs();
const concurrency = positiveInteger('--concurrency', 6, 24);
console.log(`acquiring ${jobs.length} standalone source variant(s), concurrency=${concurrency}`);
const failures = await mapBounded(jobs, concurrency, acquire);
console.log(`source acquisition complete: ${jobs.length - failures.length}/${jobs.length}`);
if (failures.length) process.exitCode = 1;
