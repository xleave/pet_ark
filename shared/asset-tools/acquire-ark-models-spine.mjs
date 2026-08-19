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
const mirrorRoot = argument('--mirror');

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
      if (!response.ok) {
        const separator = url.lastIndexOf('/');
        const lowerFilenameUrl = `${url.slice(0, separator + 1)}${url.slice(separator + 1).toLocaleLowerCase()}`;
        if (response.status === 404 && lowerFilenameUrl !== url) {
          const fallback = await fetch(lowerFilenameUrl, {
            signal: AbortSignal.timeout(45_000),
            headers: { 'user-agent': 'pet-ark-asset-pipeline/0.4' },
          });
          if (fallback.ok) return Buffer.from(await fallback.arrayBuffer());
        }
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

async function sourceBuffer(relativePath) {
  const safePath = safeRelativeAssetPath(relativePath);
  if (mirrorRoot) {
    const exact = path.join(path.resolve(mirrorRoot), safePath);
    try { return await fs.readFile(exact); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const lowerFilename = path.join(path.dirname(exact), path.basename(exact).toLocaleLowerCase());
      return fs.readFile(lowerFilename);
    }
  }
  return fetchBuffer(rawUrl(safePath));
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

async function resolvedAssetName(sourceDirectory, assetName) {
  const safeName = safeRelativeAssetPath(assetName);
  if (!mirrorRoot) return safeName;
  const relative = safeRelativeAssetPath(`${sourceDirectory}/${safeName}`);
  const exact = path.join(path.resolve(mirrorRoot), relative);
  if (await fileIsPresent(exact)) return safeName;
  const lowerName = path.basename(safeName).toLocaleLowerCase();
  const lower = path.join(path.dirname(exact), lowerName);
  if (await fileIsPresent(lower)) return path.posix.join(path.posix.dirname(safeName), lowerName).replace(/^\.\//, '');
  return safeName;
}

async function download(relativeSource, destination, { force = false } = {}) {
  if (!force && await fileIsPresent(destination)) {
    const data = await fs.readFile(destination);
    return { resumed: true, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  const data = await sourceBuffer(relativeSource);
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
    .filter(([, entry]) => {
      if (entry.type !== 'Operator') return false;
      const candidates = [
        entry.assetId,
        ...Object.values(entry.assetList || {}).map((value) => {
          if (typeof value !== 'string') return '';
          return path.basename(value, path.extname(value));
        }),
      ];
      return candidates.some((candidate) => normalizedAssetId(candidate) === wanted);
    });
  if (matches.length !== 1) {
    throw new Error(`Ark-Models has ${matches.length} matches for ${path.basename(variant.source_asset_set.model)}`);
  }
  const [directory, entry] = matches[0];
  return { directory: safeRelativeAssetPath(directory), entry };
}

async function removeObsoleteSourceAssets(sourceDir, retainedPaths) {
  const retained = new Set(retainedPaths.map((file) => path.resolve(file)));
  const removableExtensions = new Set(['.atlas', '.json', '.png', '.skel', '.webp']);
  async function visit(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        if ((await fs.readdir(file)).length === 0) await fs.rmdir(file);
      } else if (
        entry.isFile()
        && removableExtensions.has(path.extname(entry.name).toLocaleLowerCase())
        && !retained.has(path.resolve(file))
        && !['meta.json', 'retrieval.json'].includes(entry.name)
      ) {
        await fs.rm(file);
      }
    }
  }
  await visit(sourceDir);
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
  const atlasName = await resolvedAssetName(sourceDirectory, atlasAsset);
  const skeletonName = await resolvedAssetName(sourceDirectory, skeletonAsset);
  const atlasPath = path.join(sourceDir, atlasName);
  const skeletonPath = path.join(sourceDir, skeletonName);
  const atlasRelativeSource = `${sourceDirectory}/${atlasName}`;
  const skeletonRelativeSource = `${sourceDirectory}/${skeletonName}`;
  const atlasSource = rawUrl(atlasRelativeSource);
  const skeletonSource = rawUrl(skeletonRelativeSource);
  const previous = await readJsonIfPresent(path.join(sourceDir, 'retrieval.json'));
  const refreshPinnedSource = force
    || previous?.source_provider !== 'ark-models'
    || previous?.source_commit !== arkModels.commit;

  const [atlasDownload, skeletonDownload] = await Promise.all([
    download(atlasRelativeSource, atlasPath, { force: refreshPinnedSource }),
    download(skeletonRelativeSource, skeletonPath, { force: refreshPinnedSource }),
  ]);
  const atlasText = await fs.readFile(atlasPath, 'utf8');
  const textureNames = atlasTextureNames(atlasText);
  if (!textureNames.length) throw new Error(`No texture page found in ${atlasPath}`);
  const textureFiles = [];
  for (const textureName of textureNames) {
    const resolvedTextureName = await resolvedAssetName(sourceDirectory, textureName);
    const relativeSource = `${sourceDirectory}/${resolvedTextureName}`;
    const source = rawUrl(relativeSource);
    const destination = path.join(sourceDir, resolvedTextureName);
    const downloadResult = await download(relativeSource, destination, { force: refreshPinnedSource });
    textureFiles.push({
      atlas_name: textureName,
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
  await removeObsoleteSourceAssets(sourceDir, [
    metadataPath,
    path.join(sourceDir, 'retrieval.json'),
    atlasPath,
    skeletonPath,
    ...textureFiles.map((entry) => path.join(REPO_ROOT, entry.path)),
  ]);
  console.log(`ready ${character.character_id}/${variant.variant_id} from Ark-Models@${arkModels.commit.slice(0, 12)}`);
}

const metadata = JSON.parse((await sourceBuffer('models_data.json')).toString('utf8'));
const jobs = selectedJobs();
if (args.includes('--audit')) {
  const failures = [];
  for (const job of jobs) {
    try { sourceEntry(metadata, job.variant); }
    catch (error) {
      failures.push({
        character: job.character.character_id,
        variant: job.variant.variant_id,
        reason: error.message,
      });
    }
  }
  console.log(JSON.stringify({
    source: `${arkModels.repository}@${arkModels.commit}`,
    requested_variants: jobs.length,
    mapped_variants: jobs.length - failures.length,
    failed_variants: failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} else {
const concurrency = positiveInteger('--concurrency', 4, 12);
console.log(`acquiring ${jobs.length} Ark-Models source variant(s), concurrency=${concurrency}`);
const failures = await mapBounded(jobs, concurrency, (job) => acquire(metadata, job));
console.log(`Ark-Models acquisition complete: ${jobs.length - failures.length}/${jobs.length}`);
if (failures.length) process.exitCode = 1;
}
