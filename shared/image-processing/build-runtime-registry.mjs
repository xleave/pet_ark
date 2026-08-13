#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rosterPath = path.join(root, 'shared/character-data/standalone-roster.json');
const runtimeRoot = path.join(root, 'standalone/assets/runtime');
const registryPath = path.join(root, 'standalone/characters/registry.json');

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(root, file)}: ${error.message}`);
  }
}

async function fileExists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function variantId(variant) {
  return variant.variant_id || variant.id || variant.skin_id || 'default';
}

function fallbackStates(animations) {
  const aliases = {
    'run-left': 'walk-left',
    'run-right': 'walk-right',
    clicked: 'idle',
    special: 'idle',
    'picked-up': 'rest',
    dragging: 'rest',
    dropped: 'idle',
    sleep: 'rest',
    wake: 'idle',
  };
  return Object.fromEntries(Object.entries(aliases).filter(([requested, fallback]) => !animations[requested] && animations[fallback]));
}

const roster = await readJson(rosterPath);
if (!Array.isArray(roster.characters) || roster.characters.length === 0) throw new Error('standalone roster has no characters');

const characters = [];
for (const sourceCharacter of roster.characters) {
  const variants = [];
  for (const sourceVariant of sourceCharacter.variants) {
    const id = variantId(sourceVariant);
    const assets = `standalone/assets/runtime/${sourceCharacter.character_id}/${id}`;
    const manifestPath = path.join(root, assets, 'manifest.json');
    if (!await fileExists(manifestPath)) continue;
    const runtime = await readJson(manifestPath);
    const manifestCharacter = runtime.character?.id || runtime.character_id;
    const manifestVariant = runtime.variant?.id || runtime.variant_id || 'default';
    if (manifestCharacter !== sourceCharacter.character_id || manifestVariant !== id) {
      throw new Error(`${sourceCharacter.character_id}:${id}: runtime manifest identity mismatch`);
    }
    const animations = runtime.animations || runtime.states || {};
    if (!animations.idle || Object.keys(animations).length === 0) {
      throw new Error(`${sourceCharacter.character_id}:${id}: runtime must provide idle and at least one animation`);
    }
    const runtimeVariant = runtime.variant || {};
    const stateFallbacks = {
      ...fallbackStates(animations),
      ...(runtimeVariant.stateFallbacks || runtimeVariant.state_fallbacks || {}),
    };
    variants.push({
      id,
      skin_id: sourceVariant.skin_id || null,
      name: sourceVariant.name || sourceVariant.skin_name || runtimeVariant.name || 'Default',
      localized_name: sourceVariant.skin_name || sourceVariant.name || runtimeVariant.localizedName || '默认',
      variant_type: sourceVariant.variant_type,
      assets,
      source: {
        page: sourceCharacter.source_page,
        meta: sourceVariant.source_asset_set?.meta,
        model: sourceVariant.source_asset_set?.model,
      },
      animations,
      stateFallbacks,
      fallback_variant_id: id === sourceCharacter.default_variant_id
        ? null
        : sourceVariant.runtime?.fallback_variant_id || sourceCharacter.default_variant_id,
      defaultScale: runtimeVariant.defaultScale || sourceVariant.defaultScale || 1,
      availableStates: Object.keys(animations),
      specialStates: Object.keys(animations).filter((state) => ![
        'idle', 'walk-left', 'walk-right', 'run-left', 'run-right', 'clicked', 'picked-up',
        'dragging', 'dropped', 'rest', 'sleep', 'wake',
      ].includes(state)),
      mirrorRules: runtimeVariant.mirrorRules || sourceVariant.mirrorRules || { strategy: 'safe-mirror' },
    });
  }
  if (!variants.length) continue;
  if (!variants.some((variant) => variant.id === sourceCharacter.default_variant_id)) {
    throw new Error(`${sourceCharacter.character_id}: implemented skin exists without its default runtime variant`);
  }
  const defaultVariant = variants.find((variant) => variant.id === sourceCharacter.default_variant_id);
  const defaultManifest = await readJson(path.join(root, defaultVariant.assets, 'manifest.json'));
  characters.push({
    id: sourceCharacter.character_id,
    name: sourceCharacter.character_name,
    localized_name: sourceCharacter.localized_name,
    default_variant_id: sourceCharacter.default_variant_id,
    movement: defaultManifest.character?.movement || {
      walkPixelsPerSecond: 68,
      runPixelsPerSecond: 116,
      idleMinSeconds: 4,
      idleMaxSeconds: 11,
      restAfterSeconds: 75,
    },
    variants,
  });
}

if (!characters.length) throw new Error('no implemented standalone runtime manifests were found');
const registry = {
  schema_version: 2,
  generated_from: 'shared/character-data/standalone-roster.json + standalone/assets/runtime/*/*/manifest.json',
  characters,
};
await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`generated runtime JSON registry for ${characters.length} character(s) and ${characters.reduce((total, character) => total + character.variants.length, 0)} variant(s)`);
