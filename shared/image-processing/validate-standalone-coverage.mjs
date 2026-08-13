#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STANDALONE = path.join(ROOT, 'standalone');
const ROSTER_PATH = path.join(ROOT, 'shared/character-data/standalone-roster.json');
const REGISTRY_PATH = path.join(STANDALONE, 'characters/registry.json');
const GENERATED_PATH = path.join(STANDALONE, 'assets/generated/manifest.json');
const DEFAULT_OUTPUT = path.join(STANDALONE, 'dist/coverage.json');
const REQUIRED_STATES = [
  'idle',
  'walk-left',
  'walk-right',
  'clicked',
  'picked-up',
  'dragging',
  'dropped',
  'rest',
  'sleep',
  'wake',
  'special',
];

function option(name, fallback = null) {
  const args = process.argv.slice(2);
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function flag(name) {
  return process.argv.slice(2).includes(name);
}

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readJson(file, required = true) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null;
    throw new Error(`${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function relativePath(value) {
  if (!value || typeof value !== 'string') return null;
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`path leaves repository: ${value}`);
  }
  return { absolute, relative: path.relative(ROOT, absolute) };
}

function characterId(character) {
  return character.character_id || character.id;
}

function variantId(variant) {
  return variant.variant_id || variant.id || variant.skin_id || 'default';
}

function registryCharacters(registry) {
  if (!registry || !Array.isArray(registry.characters)) return [];
  return registry.characters;
}

function validateRuntimeRegistry(registry) {
  if (registry.schema_version !== 2 || !Array.isArray(registry.characters) || registry.characters.length === 0) {
    throw new Error('runtime character registry must use schema_version 2 and contain characters');
  }
  const characters = new Set();
  for (const character of registry.characters) {
    const id = characterId(character);
    if (!id || characters.has(id)) throw new Error(`runtime registry has invalid or duplicate character: ${id}`);
    characters.add(id);
    if (!Array.isArray(character.variants) || character.variants.length === 0) throw new Error(`${id}: runtime variants are required`);
    const variants = new Set();
    for (const variant of character.variants) {
      const idVariant = variantId(variant);
      if (!idVariant || variants.has(idVariant)) throw new Error(`${id}: runtime registry has invalid or duplicate variant ${idVariant}`);
      variants.add(idVariant);
      if (!variant.assets || !variant.animations || !variant.variant_type) {
        throw new Error(`${id}:${idVariant}: runtime registry requires assets, animations, and variant_type`);
      }
      if (idVariant !== character.default_variant_id && variant.fallback_variant_id !== character.default_variant_id) {
        throw new Error(`${id}:${idVariant}: non-default variant must explicitly fall back to ${character.default_variant_id}`);
      }
    }
    if (!variants.has(character.default_variant_id)) throw new Error(`${id}: runtime default variant is not registered`);
  }
}

function registryCharacter(registry, id) {
  return registryCharacters(registry).find((entry) => characterId(entry) === id);
}

function registryVariant(entry, id) {
  if (!entry) return null;
  if (Array.isArray(entry.variants)) return entry.variants.find((variant) => variantId(variant) === id) || null;
  return id === 'default' ? entry : null;
}

function sourceBlocked(status) {
  return ['source-incomplete', 'source-unavailable', 'authorization-blocked', 'blocked'].includes(status);
}

function runtimeCandidatePaths(character, variant, registryEntry, registryVariantEntry) {
  const id = characterId(character);
  const variantName = variantId(variant);
  const candidates = [
    registryVariantEntry?.runtime_manifest,
    registryVariantEntry?.manifest,
  ];
  const assets = registryVariantEntry?.assets || registryVariantEntry?.assets_subdir;
  if (assets) {
    const runtimeRoot = assets.startsWith('standalone/') ? assets : `standalone/assets/runtime/${assets}`;
    candidates.push(runtimeRoot.endsWith('.json') ? runtimeRoot : `${runtimeRoot}/manifest.json`);
  }
  candidates.push(variant.runtime?.path);
  if (variantName === 'default') {
    const legacyAssets = registryEntry?.assets;
    if (legacyAssets) candidates.push(`${legacyAssets}/manifest.json`);
    candidates.push(`standalone/assets/runtime/${id}/manifest.json`);
  }
  candidates.push(`standalone/assets/runtime/${id}/${variantName}/manifest.json`);
  return [...new Set(candidates.filter(Boolean).map((value) => relativePath(value)))];
}

function legacyRoster(registry) {
  return {
    schema_version: 1,
    metadata: {
      source: 'legacy standalone/characters/registry.json',
      retrieval_date: null,
    },
    characters: registryCharacters(registry).map((character) => ({
      character_id: characterId(character),
      character_name: character.name,
      localized_name: character.localized_name,
      source_page: character.source?.page,
      status: 'source-available',
      reason: null,
      variants: [{
        variant_id: 'default',
        variant_type: 'base_form',
        skin_id: null,
        skin_name: null,
        source_asset_set: character.source || {},
        status: 'source-available',
        reason: null,
        runtime: {
          status: 'implemented',
          path: character.assets ? `${character.assets}/manifest.json` : null,
          fallback_variant_id: null,
          fallback_policy: 'Default variant has no cross-variant fallback.',
        },
      }],
    })),
  };
}

function validateRosterShape(roster) {
  if (!roster || !Array.isArray(roster.characters) || roster.characters.length === 0) {
    throw new Error('standalone roster must contain a non-empty characters array');
  }
  const characterIds = new Set();
  for (const character of roster.characters) {
    const id = characterId(character);
    if (!id || characterIds.has(id)) throw new Error(`invalid or duplicate standalone character id: ${id}`);
    characterIds.add(id);
    if (!(character.character_name || character.name) || !character.localized_name) {
      throw new Error(`${id}: character_name/name and localized_name are required`);
    }
    if (!character.source_page) throw new Error(`${id}: source_page is required`);
    if (!Array.isArray(character.variants) || character.variants.length === 0) throw new Error(`${id}: variants are required`);
    const variants = new Set();
    let defaultCount = 0;
    for (const variant of character.variants) {
      const idVariant = variantId(variant);
      if (!idVariant || variants.has(idVariant)) throw new Error(`${id}: invalid or duplicate variant id: ${idVariant}`);
      variants.add(idVariant);
      if (idVariant === 'default') defaultCount++;
      if (!['base_form', 'skin'].includes(variant.variant_type)) throw new Error(`${id}:${idVariant}: variant_type must be base_form or skin`);
      if (variant.variant_type === 'skin' && (!variant.skin_id || !variant.skin_name)) {
        throw new Error(`${id}:${idVariant}: skin variants require skin_id and skin_name`);
      }
      if (!variant.status) throw new Error(`${id}:${idVariant}: source status is required`);
      if (sourceBlocked(variant.status) && !variant.reason) throw new Error(`${id}:${idVariant}: blocked source requires a concrete reason`);
      if (variant.status === 'source-available' && (!variant.source_asset_set || typeof variant.source_asset_set !== 'object')) {
        throw new Error(`${id}:${idVariant}: source-available variant requires source_asset_set`);
      }
      if (!variant.runtime || typeof variant.runtime !== 'object' || !variant.runtime.status) {
        throw new Error(`${id}:${idVariant}: runtime status is required`);
      }
      const fallback = variant.runtime.fallback_variant_id;
      if (fallback && !character.variants.some((candidate) => variantId(candidate) === fallback)) {
        throw new Error(`${id}:${idVariant}: fallback variant ${fallback} is outside this character`);
      }
      if (fallback === idVariant) throw new Error(`${id}:${idVariant}: fallback variant cannot reference itself`);
      if (fallback && !variant.runtime.fallback_policy) throw new Error(`${id}:${idVariant}: fallback_policy is required`);
      const runtimeStatus = variant.runtime.status;
      if (!['pending', 'implemented', 'blocked', 'source-unavailable', 'source-incomplete', 'authorization-blocked'].includes(runtimeStatus)) {
        throw new Error(`${id}:${idVariant}: unsupported runtime status ${runtimeStatus}`);
      }
      if (['blocked', 'source-unavailable', 'source-incomplete', 'authorization-blocked'].includes(runtimeStatus) &&
          !(variant.runtime.reason || variant.reason)) {
        throw new Error(`${id}:${idVariant}: blocked runtime requires a concrete reason`);
      }
    }
    if (defaultCount !== 1) throw new Error(`${id}: exactly one default variant is required`);
  }
}

function manifestAnimations(manifest) {
  return manifest.animations || manifest.states || {};
}

function manifestIdentity(manifest) {
  return {
    character: manifest.character?.id || manifest.character?.character_id || manifest.character_id || manifest.characterId,
    variant: manifest.variant?.id || manifest.variant?.variant_id || manifest.variant_id || manifest.variantId || 'default',
  };
}

async function validateRuntimePng(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width < 1 || info.height < 1) {
    throw new Error(`${path.relative(ROOT, file)} is not a non-empty RGBA image`);
  }
  let visible = 0;
  let hiddenRgb = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3]) visible++;
    else if (data[offset] || data[offset + 1] || data[offset + 2]) hiddenRgb++;
  }
  if (!visible) throw new Error(`${path.relative(ROOT, file)} is fully transparent`);
  if (hiddenRgb) throw new Error(`${path.relative(ROOT, file)} has ${hiddenRgb} transparent pixels with hidden RGB`);
  return { width: info.width, height: info.height };
}

async function validateRuntimeManifest(file, character, variant) {
  const manifest = await readJson(file);
  const identity = manifestIdentity(manifest);
  const expectedCharacter = characterId(character);
  const expectedVariant = variantId(variant);
  if (identity.character !== expectedCharacter) {
    throw new Error(`${expectedCharacter}:${expectedVariant}: runtime manifest character identity is ${identity.character || 'missing'}`);
  }
  if (identity.variant !== expectedVariant && !(expectedVariant === 'default' && identity.variant === 'default')) {
    throw new Error(`${expectedCharacter}:${expectedVariant}: runtime manifest variant identity is ${identity.variant}`);
  }
  const width = manifest.frameSize?.width || manifest.frame_size?.width;
  const height = manifest.frameSize?.height || manifest.frame_size?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${expectedCharacter}:${expectedVariant}: invalid runtime frame size`);
  }
  for (const [sourceId, source] of Object.entries(manifest.sources || {})) {
    if (!Number.isInteger(source.frames) || source.frames < 1 || source.hitboxes?.length !== source.frames) {
      throw new Error(`${expectedCharacter}:${expectedVariant}:${sourceId}: frame/hitbox count mismatch`);
    }
    if ('generatedFrames' in source && (!Number.isInteger(source.generatedFrames) || source.generatedFrames < 0 || source.generatedFrames > source.frames)) {
      throw new Error(`${expectedCharacter}:${expectedVariant}:${sourceId}: invalid generated frame count`);
    }
    if (!Number.isInteger(source.columns) || !Number.isInteger(source.rows) || !source.sheet) {
      throw new Error(`${expectedCharacter}:${expectedVariant}:${sourceId}: invalid source atlas metadata`);
    }
    const sheet = path.resolve(path.dirname(file), source.sheet);
    const dimensions = await validateRuntimePng(sheet);
    if (dimensions.width !== source.columns * width || dimensions.height !== source.rows * height) {
      throw new Error(`${expectedCharacter}:${expectedVariant}:${sourceId}: atlas dimensions do not match manifest`);
    }
    for (const hitbox of source.hitboxes) {
      if (![hitbox.x, hitbox.y, hitbox.width, hitbox.height].every(Number.isInteger) || hitbox.width < 1 || hitbox.height < 1) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${sourceId}: invalid hitbox`);
      }
    }
  }
  for (const [state, animation] of Object.entries(manifestAnimations(manifest))) {
    if (!(animation.fps > 0)) throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: fps must be positive`);
    if (animation.source) {
      const source = manifest.sources?.[animation.source];
      if (!source) throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: missing source ${animation.source}`);
      if (!Array.isArray(animation.frameOrder) || animation.frameOrder.length === 0) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: empty frame order`);
      }
      if (animation.frameOrder.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= source.frames)) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: unavailable source frame referenced`);
      }
      if (animation.generatedFrames?.some((frame) => !animation.frameOrder.includes(frame))) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: generated frame is not in frame order`);
      }
    }
  }
  for (const provenance of manifest.provenance?.generatedFrames || []) {
    if (!manifest.sources?.[provenance.source] || !Number.isInteger(provenance.frame) || provenance.frame < 0 || provenance.frame >= manifest.sources[provenance.source].frames) {
      throw new Error(`${expectedCharacter}:${expectedVariant}: invalid generated frame provenance`);
    }
    if (!await exists(path.resolve(ROOT, provenance.file))) {
      throw new Error(`${expectedCharacter}:${expectedVariant}: generated provenance file is missing: ${provenance.file}`);
    }
    if (!Array.isArray(provenance.states) || provenance.states.length === 0) {
      throw new Error(`${expectedCharacter}:${expectedVariant}: generated provenance requires explicit runtime states`);
    }
    for (const state of provenance.states) {
      const animation = manifestAnimations(manifest)[state];
      if (!animation || !animation.generatedFrames?.includes(provenance.frame) || !animation.frameOrder?.includes(provenance.frame)) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: generated provenance frame is not used`);
      }
    }
    for (const [state, animation] of Object.entries(manifestAnimations(manifest))) {
      if (animation.generatedFrames?.includes(provenance.frame) && !provenance.states.includes(state)) {
        throw new Error(`${expectedCharacter}:${expectedVariant}:${state}: generated frame use is absent from provenance states`);
      }
    }
  }
  return manifest;
}

function stateFallbacks(variant, registryVariantEntry, manifest) {
  return {
    ...(manifest?.stateFallbacks || manifest?.state_fallbacks || manifest?.fallbacks || {}),
    ...(registryVariantEntry?.stateFallbacks || registryVariantEntry?.state_fallbacks || registryVariantEntry?.fallbacks || {}),
    ...(variant.runtime?.state_fallbacks || {}),
  };
}

function resolveState(state, variant, manifest, registryVariantEntry) {
  const animations = manifestAnimations(manifest);
  if (animations[state]) return state;
  const fallbacks = stateFallbacks(variant, registryVariantEntry, manifest);
  const seen = new Set([state]);
  let candidate = fallbacks[state];
  while (candidate) {
    if (seen.has(candidate)) throw new Error(`${variantId(variant)}: state fallback cycle at ${candidate}`);
    seen.add(candidate);
    if (animations[candidate]) return candidate;
    candidate = fallbacks[candidate];
  }
  return null;
}

function blockedReason(character, variant) {
  if (sourceBlocked(variant.status)) return variant.reason;
  if (sourceBlocked(character.status)) return character.reason;
  if (['blocked', 'source-unavailable', 'source-incomplete', 'authorization-blocked'].includes(variant.runtime?.status)) {
    return variant.runtime.reason || variant.reason;
  }
  return null;
}

async function generatedCounts() {
  const generated = await readJson(GENERATED_PATH, false);
  const accepted = (generated?.sequences || []).filter((sequence) => sequence.accepted);
  return {
    sequences: generated?.sequences?.length || 0,
    accepted_sequences: accepted.length,
    accepted_frames: accepted.reduce((total, sequence) => total + (sequence.generated_frames?.length || 0), 0),
  };
}

const runtimeRegistry = await readJson(REGISTRY_PATH);
validateRuntimeRegistry(runtimeRegistry);
const sourceRoster = await readJson(ROSTER_PATH, false);
const roster = sourceRoster || legacyRoster(runtimeRegistry);
validateRosterShape(roster);

const characterFilter = option('--character');
const variantFilter = option('--variant', option('--skin'));
const selectedCharacters = characterFilter
  ? roster.characters.filter((character) => characterId(character) === characterFilter)
  : roster.characters;
if (selectedCharacters.length === 0) throw new Error(`Unknown standalone character: ${characterFilter}`);

const characterDetails = [];
const variantDetails = [];
const manifests = new Map();
for (const character of selectedCharacters) {
  const id = characterId(character);
  const registryEntry = registryCharacter(runtimeRegistry, id);
  const selectedVariants = variantFilter
    ? character.variants.filter((variant) => variantId(variant) === variantFilter || variant.skin_id === variantFilter)
    : character.variants;
  if (selectedVariants.length === 0) throw new Error(`${id}: unknown variant/skin ${variantFilter}`);
  for (const variant of selectedVariants) {
    const idVariant = variantId(variant);
    const runtimeVariant = registryVariant(registryEntry, idVariant);
    const candidates = runtimeCandidatePaths(character, variant, registryEntry, runtimeVariant);
    const candidate = (await Promise.all(candidates.map(async (entry) => ({ ...entry, exists: await exists(entry.absolute) }))))
      .find((entry) => entry.exists);
    const declaredImplemented = variant.runtime.status === 'implemented';
    if (declaredImplemented && !candidate) {
      throw new Error(`${id}:${idVariant}: runtime is marked implemented but no manifest exists`);
    }
    let manifest = null;
    if (candidate) {
      manifest = await validateRuntimeManifest(candidate.absolute, character, variant);
      manifests.set(`${id}:${idVariant}`, { manifest, file: candidate.absolute, runtimeVariant });
    }
    const reason = blockedReason(character, variant);
    if (manifest && !runtimeVariant) {
      throw new Error(`${id}:${idVariant}: runtime manifest exists but variant is not readable from standalone/characters/registry.json`);
    }
    const status = manifest && runtimeVariant ? 'implemented' : reason ? 'blocked' : 'missing';
    variantDetails.push({
      character_id: id,
      character_name: character.character_name || character.name,
      localized_name: character.localized_name,
      variant_id: idVariant,
      variant_type: variant.variant_type,
      skin_id: variant.skin_id || null,
      skin_name: variant.skin_name || null,
      source_status: variant.status,
      status,
      reason: reason || null,
      runtime_manifest: candidate?.relative || null,
      fallback_variant_id: variant.runtime.fallback_variant_id || null,
    });
  }
}

for (const character of selectedCharacters) {
  const id = characterId(character);
  const details = variantDetails.filter((variant) => variant.character_id === id);
  const base = details.find((variant) => variant.variant_id === 'default');
  characterDetails.push({
    character_id: id,
    character_name: character.character_name || character.name,
    localized_name: character.localized_name,
    status: base.status,
    reason: base.reason,
    default_variant: base.variant_id,
    variants: details.length,
    implemented_variants: details.filter((variant) => variant.status === 'implemented').length,
  });
}

for (const detail of variantDetails.filter((entry) => entry.status === 'implemented')) {
  const character = selectedCharacters.find((entry) => characterId(entry) === detail.character_id);
  const variant = character.variants.find((entry) => variantId(entry) === detail.variant_id);
  const current = manifests.get(`${detail.character_id}:${detail.variant_id}`);
  const fallbackId = variant.runtime.fallback_variant_id;
  const fallback = fallbackId ? manifests.get(`${detail.character_id}:${fallbackId}`) : null;
  for (const state of REQUIRED_STATES) {
    if (resolveState(state, variant, current.manifest, current.runtimeVariant)) continue;
    if (fallback) {
      const fallbackVariant = character.variants.find((entry) => variantId(entry) === fallbackId);
      if (resolveState(state, fallbackVariant, fallback.manifest, fallback.runtimeVariant)) continue;
    }
    throw new Error(`${detail.character_id}:${detail.variant_id}: required state ${state} has no same-character fallback`);
  }
}

const skinDetails = variantDetails.filter((variant) => variant.variant_type === 'skin');
const missingCharacters = characterDetails.filter((entry) => entry.status !== 'implemented');
const missingVariants = variantDetails.filter((entry) => entry.status !== 'implemented');
const missingSkins = skinDetails.filter((entry) => entry.status !== 'implemented');
const blockedCharacters = missingCharacters.filter((entry) => entry.status === 'blocked');
const blockedVariants = missingVariants.filter((entry) => entry.status === 'blocked');
const blockedSkins = missingSkins.filter((entry) => entry.status === 'blocked');
const unaccountedCharacters = missingCharacters.filter((entry) => entry.status === 'missing');
const unaccountedVariants = missingVariants.filter((entry) => entry.status === 'missing');
const unaccountedSkins = missingSkins.filter((entry) => entry.status === 'missing');
const image2 = await generatedCounts();
const coverage = {
  schema_version: 2,
  generated_on: roster.retrieved_at || roster.metadata?.retrieval_date || roster.metadata?.retrieved_on || new Date().toISOString().slice(0, 10),
  roster_source: sourceRoster ? path.relative(ROOT, ROSTER_PATH) : path.relative(ROOT, REGISTRY_PATH),
  roster_retrieval_date: roster.retrieved_at || roster.metadata?.retrieval_date || roster.metadata?.retrieved_on || roster.source?.retrieval_date || null,
  expected_characters: characterDetails.length,
  implemented_characters: characterDetails.length - missingCharacters.length,
  missing_characters: missingCharacters.length,
  blocked_characters: blockedCharacters.length,
  unaccounted_characters: unaccountedCharacters.length,
  expected_variants: variantDetails.length,
  implemented_variants: variantDetails.length - missingVariants.length,
  missing_variants: missingVariants.length,
  blocked_variants: blockedVariants.length,
  unaccounted_variants: unaccountedVariants.length,
  expected_skins: skinDetails.length,
  implemented_skins: skinDetails.length - missingSkins.length,
  missing_skins: missingSkins.length,
  blocked_skins: blockedSkins.length,
  unaccounted_skins: unaccountedSkins.length,
  image2,
  complete: missingCharacters.length === 0 && missingVariants.length === 0 && missingSkins.length === 0,
  accounted: unaccountedCharacters.length === 0 && unaccountedVariants.length === 0 && unaccountedSkins.length === 0,
  characters: characterDetails,
  variants: variantDetails,
  missing: {
    characters: missingCharacters,
    variants: missingVariants,
    skins: missingSkins,
  },
  blocked: {
    characters: blockedCharacters,
    variants: blockedVariants,
    skins: blockedSkins,
  },
  unaccounted: {
    characters: unaccountedCharacters,
    variants: unaccountedVariants,
    skins: unaccountedSkins,
  },
};

const output = relativePath(option('--write', path.relative(ROOT, DEFAULT_OUTPUT)));
await fs.mkdir(path.dirname(output.absolute), { recursive: true });
await fs.writeFile(output.absolute, `${JSON.stringify(coverage, null, 2)}\n`);
console.log(`coverage: characters ${coverage.implemented_characters}/${coverage.expected_characters}, variants ${coverage.implemented_variants}/${coverage.expected_variants}, skins ${coverage.implemented_skins}/${coverage.expected_skins}`);
console.log(`coverage: missing ${coverage.missing_characters} character(s), ${coverage.missing_variants} variant(s), ${coverage.missing_skins} skin(s); unaccounted ${coverage.unaccounted_variants} variant(s)`);
console.log(`wrote ${output.relative}`);

if (flag('--check-accounted') && !coverage.accounted) {
  throw new Error(`coverage has ${coverage.unaccounted_variants} unimplemented variant(s) without a documented source/authorization block`);
}
if (flag('--require-complete') && !coverage.complete) {
  throw new Error(`coverage is incomplete: ${coverage.missing_variants} variant(s), including ${coverage.missing_skins} skin(s)`);
}
