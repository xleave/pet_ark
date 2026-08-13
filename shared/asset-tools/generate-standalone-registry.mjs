#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = path.join(root, 'standalone/characters/registry.json');
const outputPath = path.join(root, 'standalone/characters/generated_registry.c');
const runtimePrefix = 'standalone/assets/runtime/';

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(root, file)}: ${error.message}`);
  }
}

function quote(value) {
  return value === null || value === undefined ? 'NULL' : JSON.stringify(String(value));
}

function symbol(value) {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^\d/, '_$&').toLowerCase();
}

function float(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid floating-point registry value: ${value}`);
  return `${Number.isInteger(number) ? number.toFixed(1) : number}f`;
}

function boolean(value) {
  return value ? 'true' : 'false';
}

function runtimeDirectory(variant) {
  const value = variant.assets || variant.runtime_assets || variant.assets_subdir;
  if (!value || typeof value !== 'string') throw new Error(`${variant.id}: variant assets path is required`);
  return value.endsWith('/manifest.json') ? path.dirname(value) : value;
}

function assetsSubdir(directory) {
  const normalized = directory.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized.startsWith(runtimePrefix)) throw new Error(`${directory}: assets must be below ${runtimePrefix}`);
  const subdir = normalized.slice(runtimePrefix.length);
  if (!subdir || subdir.includes('..')) throw new Error(`${directory}: invalid runtime assets subdirectory`);
  return subdir;
}

function runtimeManifestPath(directory) {
  return path.resolve(root, directory, 'manifest.json');
}

function stateFallbackEntries(variant, runtime) {
  const fallbacks = {
    ...(runtime.variant?.stateFallbacks || runtime.variant?.state_fallbacks || runtime.stateFallbacks || runtime.state_fallbacks || {}),
    ...(variant.stateFallbacks || variant.state_fallbacks || {}),
  };
  return Object.entries(fallbacks);
}

const registry = await readJson(registryPath);
if (registry.schema_version !== 2 || !Array.isArray(registry.characters) || registry.characters.length === 0) {
  throw new Error('standalone character registry must use schema_version 2 and contain characters');
}

const output = ['#include "character.h"', '', '#include <stddef.h>', ''];
const characters = [];
const seenCharacters = new Set();

for (const entry of registry.characters) {
  if (!entry.id || seenCharacters.has(entry.id)) throw new Error(`invalid or duplicate character id: ${entry.id}`);
  seenCharacters.add(entry.id);
  if (!Array.isArray(entry.variants) || entry.variants.length === 0) throw new Error(`${entry.id}: variants are required`);
  const characterSymbol = symbol(entry.id);
  const variants = [];
  const seenVariants = new Set();

  for (const variant of entry.variants) {
    if (!variant.id || seenVariants.has(variant.id)) throw new Error(`${entry.id}: invalid or duplicate variant id ${variant.id}`);
    seenVariants.add(variant.id);
    if (variant.id !== entry.default_variant_id && variant.fallback_variant_id !== entry.default_variant_id) {
      throw new Error(`${entry.id}:${variant.id}: non-default variant must explicitly fall back to ${entry.default_variant_id}`);
    }
    const directory = runtimeDirectory(variant);
    const runtime = await readJson(runtimeManifestPath(directory));
    const runtimeCharacterId = runtime.character?.id || runtime.character_id;
    const runtimeVariantId = runtime.variant?.id || runtime.variant_id || 'default';
    if (runtimeCharacterId !== entry.id || runtimeVariantId !== variant.id) {
      throw new Error(`${entry.id}:${variant.id}: runtime manifest identity mismatch`);
    }
    const variantSymbol = `${characterSymbol}_${symbol(variant.id)}`;
    const subdir = assetsSubdir(directory);
    const sources = runtime.sources || {};
    const animations = runtime.animations || runtime.states || {};
    if (Object.keys(sources).length === 0 || Object.keys(animations).length === 0) {
      throw new Error(`${entry.id}:${variant.id}: runtime sources and animations are required`);
    }

    for (const [sourceId, source] of Object.entries(sources)) {
      if (!Array.isArray(source.hitboxes) || source.hitboxes.length !== source.frames) {
        throw new Error(`${entry.id}:${variant.id}:${sourceId}: source hitbox count mismatch`);
      }
      const sourceSymbol = `${variantSymbol}_${symbol(sourceId)}`;
      output.push(`static const PetHitbox ${sourceSymbol}_hitboxes[] = {`);
      for (const hitbox of source.hitboxes) {
        output.push(`  { ${hitbox.x}, ${hitbox.y}, ${hitbox.width}, ${hitbox.height} },`);
      }
      output.push('};');
      output.push(`static const PetAnimationSource ${sourceSymbol}_source = {`);
      output.push(`  ${quote(sourceId)}, ${quote(`${subdir}/${source.sheet}`)}, ${source.frames}, ${source.columns}, ${source.rows}, ${sourceSymbol}_hitboxes`);
      output.push('};', '');
    }

    for (const [animationId, animation] of Object.entries(animations)) {
      if (!Array.isArray(animation.frameOrder) || animation.frameOrder.length === 0) {
        throw new Error(`${entry.id}:${variant.id}:${animationId}: frameOrder is required`);
      }
      const orderSymbol = `${variantSymbol}_${symbol(animationId)}_order`;
      output.push(`static const int ${orderSymbol}[] = { ${animation.frameOrder.join(', ')} };`);
    }
    output.push('', `static const PetAnimationDefinition ${variantSymbol}_animations[] = {`);
    for (const [animationId, animation] of Object.entries(animations)) {
      const sourceSymbol = `${variantSymbol}_${symbol(animation.source)}`;
      const orderSymbol = `${variantSymbol}_${symbol(animationId)}_order`;
      output.push(`  { ${quote(animationId)}, &${sourceSymbol}_source, ${orderSymbol}, ${animation.frameOrder.length}, ${animation.fps}, ${boolean(animation.loop)}, ${boolean(animation.mirror)}, ${boolean(animation.holdLast)}, ${quote(animation.next)} },`);
    }
    output.push('};', '');

    const fallbackEntries = stateFallbackEntries(variant, runtime);
    if (fallbackEntries.length) {
      output.push(`static const PetStateFallback ${variantSymbol}_fallbacks[] = {`);
      for (const [requested, fallback] of fallbackEntries) output.push(`  { ${quote(requested)}, ${quote(fallback)} },`);
      output.push('};', '');
    }
    variants.push({ variant, runtime, variantSymbol, subdir, fallbackEntries });
  }

  if (!seenVariants.has(entry.default_variant_id)) throw new Error(`${entry.id}: default_variant_id is not registered`);
  output.push(`static const PetVariant ${characterSymbol}_variants[] = {`);
  for (const { variant, runtime, variantSymbol, subdir, fallbackEntries } of variants) {
    const runtimeVariant = runtime.variant || {};
    const mirrorRules = runtimeVariant.mirrorRules || variant.mirrorRules || {};
    const canMirror = mirrorRules.canMirror ?? (mirrorRules.strategy !== 'independent-directions');
    output.push('  {');
    output.push(`    .id = ${quote(variant.id)},`);
    output.push(`    .skin_id = ${quote(variant.skin_id)},`);
    output.push(`    .name = ${quote(variant.name || runtimeVariant.name || variant.id)},`);
    output.push(`    .localized_name = ${quote(variant.localized_name || runtimeVariant.localizedName || variant.name || variant.id)},`);
    output.push(`    .variant_type = ${quote(variant.variant_type || runtimeVariant.type)},`);
    output.push(`    .assets_subdir = ${quote(subdir)},`);
    output.push(`    .default_scale = ${float(variant.defaultScale ?? runtimeVariant.defaultScale ?? 1)},`);
    output.push(`    .can_mirror = ${boolean(canMirror)},`);
    output.push(`    .animations = ${variantSymbol}_animations,`);
    output.push(`    .animation_count = sizeof(${variantSymbol}_animations) / sizeof(${variantSymbol}_animations[0]),`);
    output.push(`    .state_fallbacks = ${fallbackEntries.length ? `${variantSymbol}_fallbacks` : 'NULL'},`);
    output.push(`    .state_fallback_count = ${fallbackEntries.length ? `sizeof(${variantSymbol}_fallbacks) / sizeof(${variantSymbol}_fallbacks[0])` : '0'},`);
    output.push(`    .fallback_variant_id = ${quote(variant.fallback_variant_id ?? runtimeVariant.fallbackVariantId)},`);
    output.push('  },');
  }
  output.push('};', '');
  characters.push({ entry, characterSymbol });
}

output.push('const PetCharacter PET_CHARACTERS[] = {');
for (const { entry, characterSymbol } of characters) {
  const movement = entry.movement || {};
  for (const key of ['walkPixelsPerSecond', 'runPixelsPerSecond', 'idleMinSeconds', 'idleMaxSeconds', 'restAfterSeconds']) {
    if (!(movement[key] > 0)) throw new Error(`${entry.id}: invalid movement.${key}`);
  }
  output.push('  {');
  output.push(`    ${quote(entry.id)}, ${quote(entry.name)}, ${quote(entry.localized_name)},`);
  output.push(`    ${float(movement.walkPixelsPerSecond)}, ${float(movement.runPixelsPerSecond)}, ${float(movement.idleMinSeconds)}, ${float(movement.idleMaxSeconds)}, ${float(movement.restAfterSeconds)},`);
  output.push(`    ${characterSymbol}_variants, sizeof(${characterSymbol}_variants) / sizeof(${characterSymbol}_variants[0]), ${quote(entry.default_variant_id)}`);
  output.push('  },');
}
output.push('};');
output.push('const size_t PET_CHARACTER_COUNT = sizeof(PET_CHARACTERS) / sizeof(PET_CHARACTERS[0]);', '');

await fs.writeFile(outputPath, output.join('\n'));
console.log(`generated C registry for ${characters.length} standalone character(s) and ${characters.reduce((total, entry) => total + entry.entry.variants.length, 0)} variant(s)`);
