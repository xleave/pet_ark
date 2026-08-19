#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROSTER_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-roster.json');
const SOURCE_RECORD_PATH = path.join(REPO_ROOT, 'shared/character-data/upstream-sources.json');
const roster = JSON.parse(await fs.readFile(ROSTER_PATH, 'utf8'));
const sourceRecord = JSON.parse(await fs.readFile(SOURCE_RECORD_PATH, 'utf8'));
const arkModels = sourceRecord.sources.ark_models;
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
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/'));
  if (!normalized || path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Unsafe Ark-Models asset path: ${value}`);
  }
  return normalized;
}

function rawUrl(relativePath) {
  const encoded = safeRelativeAssetPath(relativePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${arkModels.raw_root}/${arkModels.commit}/${encoded}`;
}

function normalizedAssetId(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
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
      if (variant.status === 'source-available') jobs.push({ character, variant });
    }
  }
  if (!jobs.length) throw new Error('No source-available standalone variants matched the selection');
  return jobs;
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(45_000),
        headers: { 'user-agent': 'pet-ark-asset-pipeline/0.4' },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

async function fileIsPresent(filePath) {
  try { return (await fs.stat(filePath)).size > 0; }
  catch { return false; }
}

async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function download(url, destination, { force = false } = {}) {
  if (!force && await fileIsPresent(destination)) {
    const data = await fs.readFile(destination);
    return { resumed: true, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  const data = await fetchBuffer(url);
  const temporary = `${destination}.partial-${process.pid}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, destination);
  console.log(`downloaded ${path.relative(REPO_ROOT, destination)}`);
  return { resumed: false, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}

function atlasTextureNames(atlasText) {
  const lines = atlasText.split(/\r?\n/);
  const names = [];
  let blockStart = true;
  for (let index = 0; index < lines.length; index += 1) {
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

function sourceEntry(metadata, variant) {
  const wanted = normalizedAssetId(path.basename(variant.source_asset_set.model));
  const matches = Object.entries(metadata.data || {})
    .filter(([, entry]) => entry.type === 'Operator' && normalizedAssetId(entry.assetId) === wanted);
  if (matches.length !== 1) {
    throw new Error(`Ark-Models has ${matches.length} matches for ${path.basename(variant.source_asset_set.model)}`);
  }
  const [directory, entry] = matches[0];
  return { directory: safeRelativeAssetPath(directory), entry };
}

async function mapBounded(values, concurrency, work) {
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try { await work(values[index]); }
      catch (error) {
        failures.push({ value: values[index], error });
        console.error(`FAILED ${values[index].character.character_id}/${values[index].variant.variant_id}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return failures;
}

async function acquire(metadata, { character, variant }) {
  const { directory, entry } = sourceEntry(metadata, variant);
  const sourceDirectory = `models/${directory}`;
  const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', character.character_id, variant.variant_id);
  const force = args.includes('--force');
  const atlasAsset = entry.assetList?.['.atlas'];
  const skeletonAsset = entry.assetList?.['.skel'] || entry.assetList?.['.json'];
  if (typeof atlasAsset !== 'string' || typeof skeletonAsset !== 'string') {
    throw new Error(`Ark-Models entry is missing Spine files: ${entry.assetId}`);
  }
  const atlasName = safeRelativeAssetPath(atlasAsset);
  const skeletonName = safeRelativeAssetPath(skeletonAsset);
  const atlasPath = path.join(sourceDir, atlasName);
  const skeletonPath = path.join(sourceDir, skeletonName);
  const atlasSource = rawUrl(`${sourceDirectory}/${atlasName}`);
  const skeletonSource = rawUrl(`${sourceDirectory}/${skeletonName}`);
  const previous = await readJsonIfPresent(path.join(sourceDir, 'retrieval.json'));
  const refreshPinnedSource = force
    || previous?.source_provider !== 'ark-models'
    || previous?.source_commit !== arkModels.commit;

  const [atlasDownload, skeletonDownload] = await Promise.all([
    download(atlasSource, atlasPath, { force: refreshPinnedSource }),
    download(skeletonSource, skeletonPath, { force: refreshPinnedSource }),
  ]);
  const atlasText = await fs.readFile(atlasPath, 'utf8');
  const textureNames = atlasTextureNames(atlasText);
  if (!textureNames.length) throw new Error(`No texture page found in ${atlasPath}`);
  const textureFiles = [];
  for (const textureName of textureNames) {
    const source = rawUrl(`${sourceDirectory}/${textureName}`);
    const destination = path.join(sourceDir, textureName);
    const downloadResult = await download(source, destination, { force: refreshPinnedSource });
    textureFiles.push({
      source,
      path: path.relative(REPO_ROOT, destination),
      bytes: downloadResult.bytes,
      sha256: downloadResult.sha256,
    });
  }

  const metadataPath = path.join(sourceDir, 'meta.json');
  await fs.writeFile(metadataPath, `${JSON.stringify(entry, null, 2)}\n`);
  const retrieval = {
    schema_version: 3,
    character_id: character.character_id,
    character_name: character.character_name,
    localized_name: character.localized_name,
    game_key: character.game_key,
    variant_id: variant.variant_id,
    variant_type: variant.variant_type,
    variant_name: variant.name,
    skin_id: variant.skin_id,
    skin_name: variant.skin_name,
    source_provider: 'ark-models',
    source_page: arkModels.repository,
    source_commit: arkModels.commit,
    source_metadata: rawUrl('models_data.json'),
    source_directory: sourceDirectory,
    source_asset: entry,
    source_properties: {
      spine_runtime: arkModels.spine_runtime,
      premultiplied_alpha: arkModels.premultiplied_alpha,
      texture_origin: arkModels.texture_origin,
      usage: arkModels.usage,
    },
    retrieval_date: new Date().toISOString().slice(0, 10),
    files: {
      meta: path.relative(REPO_ROOT, metadataPath),
      atlas: path.relative(REPO_ROOT, atlasPath),
      skeleton: path.relative(REPO_ROOT, skeletonPath),
      textures: textureFiles,
    },
    integrity: {
      atlas: { bytes: atlasDownload.bytes, sha256: atlasDownload.sha256 },
      skeleton: { bytes: skeletonDownload.bytes, sha256: skeletonDownload.sha256 },
    },
  };
  await fs.writeFile(path.join(sourceDir, 'retrieval.json'), `${JSON.stringify(retrieval, null, 2)}\n`);
  console.log(`ready ${character.character_id}/${variant.variant_id} from Ark-Models@${arkModels.commit.slice(0, 12)}`);
}

const metadata = JSON.parse((await fetchBuffer(rawUrl('models_data.json'))).toString('utf8'));
const jobs = selectedJobs();
const concurrency = positiveInteger('--concurrency', 4, 12);
console.log(`acquiring ${jobs.length} Ark-Models source variant(s), concurrency=${concurrency}`);
const failures = await mapBounded(jobs, concurrency, (job) => acquire(metadata, job));
console.log(`Ark-Models acquisition complete: ${jobs.length - failures.length}/${jobs.length}`);
if (failures.length) process.exitCode = 1;
