#!/usr/bin/env node
/**
 * Enumerate PRTS public base-building Spine models for the checked-in playable roster.
 *
 * This deliberately records URLs and source availability only. It does not download
 * or mark a runtime variant implemented; the standalone asset builder owns that step.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(ROOT, 'shared/character-data');
const DEFAULT_OPERATORS = path.join(DATA, 'operators.json');
const DEFAULT_OUTPUT = path.join(DATA, 'standalone-roster.json');
const DEFAULT_SOURCES = path.join(DATA, 'standalone-sources.json');
const GAME_META_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/char_meta_table.json';
const PRTS_PAGE_ROOT = 'https://prts.wiki/w/';
const PRTS_ASSET_ROOT = 'https://torappu.prts.wiki/assets/char_spine';
const RETRIEVAL_DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const args = {
    operators: DEFAULT_OPERATORS,
    output: DEFAULT_OUTPUT,
    sources: DEFAULT_SOURCES,
    concurrency: 8,
    retries: 5,
    timeoutMs: 45_000,
    refresh: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--operators') args.operators = path.resolve(argv[++index]);
    else if (value === '--output') args.output = path.resolve(argv[++index]);
    else if (value === '--sources-output') args.sources = path.resolve(argv[++index]);
    else if (value === '--concurrency') args.concurrency = Number(argv[++index]);
    else if (value === '--retries') args.retries = Number(argv[++index]);
    else if (value === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (value === '--refresh') args.refresh = true;
    else if (value === '--help') {
      console.log('Usage: node shared/asset-tools/standalone-roster.mjs [--refresh] [--concurrency N]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 32) {
    throw new Error('--concurrency must be an integer from 1 to 32');
  }
  return args;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, { retries, timeoutMs }) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const requestUrl = `${url}?roster=${RETRIEVAL_DATE.replaceAll('-', '')}-${attempt}`;
      const response = await fetch(requestUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json', 'user-agent': 'pet-ark-standalone-roster/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || typeof value.prefix !== 'string' || !value.skin) {
        throw new Error('response is not a PRTS char_spine meta object');
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError;
}

function stableCharacterId(operator) {
  return operator.id.replace(/-chibi$/, '');
}

function skinInternalId(model, gameKey) {
  const normalized = model
    .replace(/^defaultskin\/build\/build_/, '')
    .replace(/^.*\/build\/build_/, '')
    .replace(new RegExp(`^${gameKey}_?`), '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'default';
}

function assetSet(metaUrl, prefix, model) {
  const base = new URL(model, prefix).href;
  return {
    meta: metaUrl,
    model,
    skel: `${base}.skel`,
    atlas: `${base}.atlas`,
    texture: `${base}.png`,
  };
}

function buildVariant({ characterId, gameKey, metaUrl, prefix, skinName, skin, defaultScale }) {
  const building = skin?.['基建'];
  const availableViews = [];
  if (skin?.['正面']?.file) availableViews.push('front');
  if (building?.file) availableViews.push('building');
  if (skin?.['背面']?.file) availableViews.push('back');
  const isDefault = skinName === '默认';
  const sourceId = building?.file ? skinInternalId(building.file, gameKey) : null;
  const variantId = isDefault ? 'default' : `skin-${sourceId || `unresolved-${encodeURIComponent(skinName)}`}`;
  const sourceAvailable = Boolean(building?.file);
  const legacyAmiya = characterId === 'amiya' && isDefault;
  return {
    variant_id: variantId,
    id: variantId,
    variant_type: isDefault ? 'base_form' : 'skin',
    skin_id: isDefault ? null : sourceId,
    skin_name: isDefault ? null : skinName,
    name: isDefault ? '默认' : skinName,
    is_default: isDefault,
    source_asset_set: sourceAvailable ? assetSet(metaUrl, prefix, building.file) : { meta: metaUrl, model: null, skel: null, atlas: null, texture: null },
    available_views: availableViews,
    status: sourceAvailable ? 'source-available' : 'source-incomplete',
    reason: sourceAvailable ? null : 'PRTS meta exposes this appearance but no base-building model.',
    defaultScale,
    mirrorRules: { strategy: 'safe-mirror', independentDirections: false },
    fallbackVariant: isDefault ? null : 'default',
    runtime: {
      status: legacyAmiya ? 'implemented' : 'pending',
      path: legacyAmiya ? 'standalone/assets/runtime/amiya/manifest.json' : null,
      fallback_variant_id: isDefault ? null : 'default',
      fallback_policy: isDefault ? 'none' : 'same-state-default-appearance-only-when-manifest-declares-compatible',
    },
  };
}

function inferPlayableVariantType(operator, alterKeys) {
  return alterKeys.has(operator.game_key) ? 'alter' : 'base_form';
}

async function fetchAlterKeys({ retries, timeoutMs }) {
  try {
    const response = await fetch(GAME_META_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'pet-ark-standalone-roster/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const meta = await response.json();
    const alters = new Set();
    for (const group of Object.values(meta.spCharGroups || {})) {
      for (const gameKey of group.slice(1)) alters.add(gameKey);
    }
    return alters;
  } catch (error) {
    // The PRTS roster remains reproducible without this optional classification source.
    // Keep the returned set empty rather than guessing alter identity from key spelling.
    process.stderr.write(`Alter classification unavailable after ${retries} configured source retries: ${error.message}\n`);
    return new Set();
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readPrevious(output) {
  try {
    return JSON.parse(await fs.readFile(output, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function previousMeta(previous, gameKey) {
  const entry = previous?.characters?.find((character) => character.game_key === gameKey);
  if (!entry || entry.status === 'source-unavailable') return null;
  const skins = {};
  for (const variant of entry.variants || []) {
    const name = variant.is_default ? '默认' : variant.skin_name;
    if (!name) continue;
    const model = variant.source_asset_set?.model;
    skins[name] = {
      '基建': model ? { file: model } : undefined,
    };
  }
  return Object.keys(skins).length ? { prefix: entry.source_prefix, name: entry.localized_name, skin: skins } : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const operators = JSON.parse(await fs.readFile(args.operators, 'utf8'));
  const previous = args.refresh ? null : await readPrevious(args.output);

  // Each alter remains a standalone character entry. The grouping source only classifies it.
  const alterKeys = await fetchAlterKeys(args);
  let completed = 0;
  const characters = await mapConcurrent(operators, args.concurrency, async (operator) => {
    const characterId = stableCharacterId(operator);
    const metaUrl = `${PRTS_ASSET_ROOT}/${operator.game_key}/meta.json`;
    let meta = previousMeta(previous, operator.game_key);
    let error = null;
    if (!meta) {
      try { meta = await fetchJson(metaUrl, args); }
      catch (caught) { error = String(caught?.message || caught); }
    }
    completed += 1;
    if (completed % 25 === 0 || completed === operators.length) {
      process.stderr.write(`\rPRTS metadata ${completed}/${operators.length}`);
    }
    const base = {
      character_id: characterId,
      character_name: operator.display_name,
      localized_name: operator.localized_name,
      source_id: operator.source_id,
      game_key: operator.game_key,
      playable_form_type: inferPlayableVariantType(operator, alterKeys),
      source_page: `${PRTS_PAGE_ROOT}${encodeURIComponent(operator.localized_name)}`,
      source_meta: metaUrl,
      source_prefix: meta?.prefix || `${PRTS_ASSET_ROOT}/${operator.game_key}/`,
      source_name: meta?.name || null,
      default_variant_id: 'default',
      status: meta ? 'source-indexed' : 'source-unavailable',
      reason: meta ? null : `PRTS char_spine meta retrieval failed: ${error}`,
      variants: [],
    };
    if (!meta) return base;
    base.variants = Object.entries(meta.skin).map(([skinName, skin]) => buildVariant({
      characterId, gameKey: operator.game_key, metaUrl, prefix: meta.prefix, skinName, skin,
      defaultScale: characterId === 'amiya' ? 1 : 1,
    })).sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.variant_id.localeCompare(right.variant_id));
    if (!base.variants.some((variant) => variant.is_default)) {
      base.status = 'source-incomplete';
      base.reason = 'PRTS meta has no default appearance entry.';
    }
    return base;
  });
  process.stderr.write('\n');

  characters.sort((left, right) => left.character_id.localeCompare(right.character_id));
  const allVariants = characters.flatMap((character) => character.variants);
  const statistics = {
    expected_characters: characters.length,
    source_indexed_characters: characters.filter((character) => character.status !== 'source-unavailable').length,
    source_unavailable_characters: characters.filter((character) => character.status === 'source-unavailable').length,
    expected_default_appearances: characters.length,
    source_available_default_appearances: characters.filter((character) => character.variants.some((variant) => variant.is_default && variant.status === 'source-available')).length,
    source_incomplete_default_appearances: characters.filter((character) => !character.variants.some((variant) => variant.is_default && variant.status === 'source-available')).length,
    expected_variants: allVariants.length,
    source_available_variants: allVariants.filter((variant) => variant.status === 'source-available').length,
    expected_skins: allVariants.filter((variant) => variant.variant_type === 'skin').length,
    source_available_skins: allVariants.filter((variant) => variant.variant_type === 'skin' && variant.status === 'source-available').length,
    source_incomplete_skins: allVariants.filter((variant) => variant.variant_type === 'skin' && variant.status !== 'source-available').length,
    implemented_runtime_variants: allVariants.filter((variant) => variant.runtime.status === 'implemented').length,
  };
  const roster = {
    schema_version: 1,
    retrieved_at: RETRIEVAL_DATE,
    scope: 'Mainland-CN playable forms in shared/character-data/operators.json. Formally separate playable alters remain separate character entries; PRTS base-building appearances are variants and named appearances are skins.',
    sources: ['prts-playable-operator-index', 'prts-char-spine-api', 'arknights-game-data-character-meta'],
    statistics,
    characters,
  };
  const sources = {
    schema_version: 1,
    retrieval_date: RETRIEVAL_DATE,
    scope: roster.scope,
    sources: [
      {
        id: 'prts-playable-operator-index', title: 'PRTS 干员一览', authority: 'community public index',
        url: 'https://prts.wiki/w/%E5%B9%B2%E5%91%98%E4%B8%80%E8%A7%88', use: 'playable roster and localized identity index',
      },
      {
        id: 'prts-char-spine-api', title: 'PRTS public char_spine metadata and assets', authority: 'community public asset service',
        url_template: `${PRTS_ASSET_ROOT}/{game_key}/meta.json`, use: 'enumerate public base-building Spine default appearances and named skin appearances',
      },
      {
        id: 'arknights-game-data-character-meta', title: 'Kengxxiao/ArknightsGameData character metadata', authority: 'public game-data mirror',
        url: 'https://github.com/Kengxxiao/ArknightsGameData/blob/master/zh_CN/gamedata/excel/char_meta_table.json', raw_url: GAME_META_URL,
        use: 'audit formally separate playable alter groups without merging their roster entries',
      },
    ],
    statistics,
    unavailable_characters: characters.filter((character) => character.status === 'source-unavailable').map((character) => ({
      character_id: character.character_id, game_key: character.game_key, reason: character.reason,
    })),
    incomplete_variants: characters.flatMap((character) => character.variants
      .filter((variant) => variant.status !== 'source-available')
      .map((variant) => ({ character_id: character.character_id, variant_id: variant.variant_id, reason: variant.reason }))),
  };
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(roster, null, 2)}\n`);
  await fs.writeFile(args.sources, `${JSON.stringify(sources, null, 2)}\n`);
  console.log(JSON.stringify(statistics, null, 2));
}

await main();
