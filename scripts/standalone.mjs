#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE_ROOT = path.join(REPO_ROOT, 'standalone');
const BUILD_BINARY = path.join(STANDALONE_ROOT, 'build', 'pet-ark');
const DIST_APP = path.join(STANDALONE_ROOT, 'dist', 'app');
const DIST_CHARACTERS = path.join(STANDALONE_ROOT, 'dist', 'characters');
const DIST_MANIFESTS = path.join(STANDALONE_ROOT, 'dist', 'manifests');
const REGISTRY_PATH = path.join(STANDALONE_ROOT, 'characters', 'registry.json');
const ROSTER_PATH = path.join(REPO_ROOT, 'shared', 'character-data', 'standalone-roster.json');
const RUNTIME_ASSETS = path.join(STANDALONE_ROOT, 'assets', 'runtime');

function usage() {
  console.log(`Usage: node scripts/standalone.mjs <command> [options]

Commands:
  dev       Build and launch the Wayland desktop pet
  build     Compile the native application
  package   Create standalone/dist/app with binary and runtime resources
  test      Run native state-machine, movement, and animation tests
  validate  Run logic tests and validate character/runtime asset metadata
  build-all Build runtime resources for every character and skin, then compile
  validate-all
             Validate the complete roster, variants, skins, assets, and package registry
  audit      Generate pixel-audited standalone animation coverage
  assets    Prepare runtime atlases and regenerate the C registry

Options:
  --character <id>  Select one character (default for dev: amiya)
  --skin <id>       Select one skin id/variant id/name (default: default)
  --variant <id>    Select one variant id (takes precedence over --skin)
  --concurrency <n> Bounded source acquisition/export concurrency
  --mirror <path>   Read the pinned Ark-Models checkout from a local mirror
  --sysroot <path>  Forward a cross-compilation sysroot to make/pkg-config
  --jobs <count>    Parallel make jobs
  --refresh-source  Download and export the selected Ark-Models Spine source first
  --                Pass remaining arguments to the desktop application`);
}

function option(args, name, fallback = null) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function passthroughArgs(args) {
  const separator = args.indexOf('--');
  return separator >= 0 ? args.slice(separator + 1) : [];
}

function forwarded(args, names) {
  const result = [];
  for (const name of names) {
    const value = option(args, name);
    if (value !== null) result.push(name, value);
  }
  for (const name of ['--force']) if (args.includes(name)) result.push(name);
  return result;
}

function filenamePart(value) {
  return String(value).normalize('NFKC').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'selection';
}

function run(command, args, { cwd = REPO_ROOT, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Required command '${command}' was not found in PATH.`));
      } else {
        reject(error);
      }
    });
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} was terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with status ${code}`));
      else resolve();
    });
  });
}

function makeArgs(target, args) {
  const result = ['-C', STANDALONE_ROOT];
  const jobs = option(args, '--jobs');
  const sysroot = option(args, '--sysroot');
  if (jobs) {
    if (!/^\d+$/.test(jobs) || Number(jobs) < 1) throw new Error('--jobs must be a positive integer');
    result.push(`-j${jobs}`);
  }
  if (sysroot) result.push(`SYSROOT=${path.resolve(sysroot)}`);
  result.push(target);
  return result;
}

async function make(target, args) {
  await run(process.env.MAKE || 'make', makeArgs(target, args));
}

async function loadJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, file)}: ${error.message}`);
  }
}

async function withTemporaryManifestOutputs(operation) {
  await fs.mkdir(DIST_MANIFESTS, { recursive: true });
  const temporaryDirectory = await fs.mkdtemp(path.join(DIST_MANIFESTS, '.selection-'));
  try {
    return await operation(temporaryDirectory);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function copyTree(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(sourceEntry, destinationEntry);
    else if (entry.isFile()) await fs.copyFile(sourceEntry, destinationEntry);
    else throw new Error(`Unsupported asset entry: ${path.relative(REPO_ROOT, sourceEntry)}`);
  }
}

async function copyDirectory(source, destination) {
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(
    path.dirname(REPO_ROOT),
    `.pet-ark-copy-${path.basename(destination)}-`,
  ));
  try {
    await copyTree(source, temporary);
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function syncDistMetadata() {
  await Promise.all([
    fs.mkdir(DIST_MANIFESTS, { recursive: true }),
    fs.mkdir(path.join(STANDALONE_ROOT, 'dist', 'registry'), { recursive: true }),
  ]);
  await Promise.all([
    fs.copyFile(REGISTRY_PATH, path.join(DIST_MANIFESTS, 'registry.json')),
    fs.copyFile(REGISTRY_PATH, path.join(STANDALONE_ROOT, 'dist', 'registry', 'characters.json')),
    fs.copyFile(ROSTER_PATH, path.join(DIST_MANIFESTS, 'roster.json')),
  ]);
}

function packagedRegistry(registry) {
  return {
    ...registry,
    characters: registry.characters.map((character) => ({
      ...character,
      variants: character.variants.map((variant) => {
        const subdir = variant.assets.replace(/^standalone\/assets\/runtime\/?/, '');
        return { ...variant, assets: `assets/runtime/${subdir}` };
      }),
    })),
  };
}

function runtimeStateFallbacks(runtime) {
  const animations = runtime.animations || runtime.states || {};
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
  return {
    ...Object.fromEntries(Object.entries(aliases).filter(([requested, fallback]) => !animations[requested] && animations[fallback])),
    ...(runtime.variant?.stateFallbacks || runtime.variant?.state_fallbacks || runtime.stateFallbacks || runtime.state_fallbacks || {}),
  };
}

async function validatePackagedRegistry() {
  const appManifest = await loadJson(path.join(DIST_APP, 'manifest.json'));
  if (appManifest.schema_version !== 2 || !appManifest.character_registry || !appManifest.runtime_assets) {
    throw new Error('packaged app manifest must use schema_version 2 and declare registry/runtime assets');
  }
  const registry = await loadJson(path.join(DIST_APP, appManifest.character_registry));
  if (registry.schema_version !== 2 || !Array.isArray(registry.characters) || registry.characters.length === 0) {
    throw new Error('packaged character registry is unreadable or empty');
  }
  let variants = 0;
  for (const character of registry.characters) {
    for (const variant of character.variants || []) {
      const runtimeManifest = path.resolve(DIST_APP, variant.assets, 'manifest.json');
      if (!runtimeManifest.startsWith(`${DIST_APP}${path.sep}`)) throw new Error(`${character.id}:${variant.id}: packaged assets leave app directory`);
      const runtime = await loadJson(runtimeManifest);
      if (runtime.character?.id !== character.id || (runtime.variant?.id || 'default') !== variant.id) {
        throw new Error(`${character.id}:${variant.id}: packaged runtime identity mismatch`);
      }
      const runtimeAnimations = runtime.animations || runtime.states || {};
      if (!isDeepStrictEqual(variant.animations, runtimeAnimations)) {
        throw new Error(`${character.id}:${variant.id}: packaged registry animations differ from runtime manifest`);
      }
      if (!isDeepStrictEqual(variant.stateFallbacks || {}, runtimeStateFallbacks(runtime))) {
        throw new Error(`${character.id}:${variant.id}: packaged registry fallbacks differ from runtime manifest`);
      }
      const runtimeStates = Object.keys(runtimeAnimations);
      if (!isDeepStrictEqual(variant.availableStates || [], runtimeStates)) {
        throw new Error(`${character.id}:${variant.id}: packaged registry availableStates differ from runtime manifest`);
      }
      variants++;
    }
  }
  console.log(`OK: packaged registry readable (${registry.characters.length} character(s), ${variants} variant(s))`);
}

async function assertFile(file, label) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size === 0) throw new Error('file is empty');
  } catch (error) {
    throw new Error(`${label}: ${path.relative(REPO_ROOT, file)} (${error.message})`);
  }
}

async function pngDimensions(file) {
  const header = await fs.readFile(file);
  const signature = '89504e470d0a1a0a';
  if (header.length < 24 || header.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`${path.relative(REPO_ROOT, file)} is not a PNG file`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

async function prepareAssets(args) {
  const roster = await loadJson(ROSTER_PATH);
  const characterId = option(args, '--character', 'amiya');
  const selector = option(args, '--variant', option(args, '--skin', 'default'));
  const character = roster.characters.find((entry) => entry.character_id === characterId);
  if (!character) throw new Error(`Unknown standalone character: ${characterId}`);
  const variant = character.variants.find((entry) => entry.variant_id === selector || entry.skin_id === selector || entry.skin_name === selector);
  if (!variant) throw new Error(`${characterId}: unknown skin/variant ${selector}`);
  if (variant.status !== 'source-available') throw new Error(`${characterId}/${variant.variant_id}: ${variant.reason || 'animation source is unavailable'}`);
  const defaultVariant = character.variants.find((entry) => entry.variant_id === character.default_variant_id);
  const requiredVariants = variant.variant_id === character.default_variant_id ? [variant] : [defaultVariant, variant];
  for (const requiredVariant of requiredVariants) {
    if (!requiredVariant) throw new Error(`${characterId}: default variant is missing from roster`);
    const selectedArgs = ['--character', characterId, '--variant', requiredVariant.variant_id];
    const cleanedManifest = path.join(
      STANDALONE_ROOT,
      'assets',
      'cleaned',
      characterId,
      requiredVariant.variant_id,
      'manifest.json',
    );
    if (args.includes('--refresh-source') || !await exists(cleanedManifest)) {
      const sourceArgs = [...selectedArgs, ...forwarded(args, ['--concurrency', '--mirror'])];
      await run(process.execPath, ['shared/asset-tools/acquire-ark-models-spine.mjs', ...sourceArgs]);
      await run(process.execPath, ['shared/asset-tools/export-ark-models-spine.mjs', ...sourceArgs]);
    }
    await run(process.execPath, ['shared/image-processing/prepare-standalone-assets.mjs', ...selectedArgs]);
  }
  await run(process.execPath, ['shared/image-processing/sync-generated-motion-manifest.mjs']);
  await run(process.execPath, ['shared/image-processing/build-runtime-registry.mjs']);
  await run(process.execPath, ['shared/asset-tools/generate-standalone-registry.mjs']);
  await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
  await withTemporaryManifestOutputs(async (temporaryDirectory) => {
    await run(process.execPath, [
      'shared/image-processing/validate-standalone-coverage.mjs',
      '--character', characterId,
      '--variant', variant.variant_id,
      '--write', path.join(temporaryDirectory, `coverage-${filenamePart(characterId)}-${filenamePart(variant.variant_id)}.json`),
    ]);
  });
  await run(process.execPath, ['shared/image-processing/validate-standalone-coverage.mjs']);
  for (const requiredVariant of requiredVariants) {
    await copyDirectory(
      path.join(RUNTIME_ASSETS, characterId, requiredVariant.variant_id),
      path.join(DIST_CHARACTERS, characterId, requiredVariant.variant_id),
    );
  }
  await syncDistMetadata();
}

async function prepareAll(args) {
  if (args.includes('--refresh-source')) {
    const sourceArgs = ['--all', ...forwarded(args, ['--concurrency', '--mirror'])];
    await run(process.execPath, ['shared/asset-tools/acquire-ark-models-spine.mjs', ...sourceArgs]);
    await run(process.execPath, ['shared/asset-tools/export-ark-models-spine.mjs', ...sourceArgs]);
  }
  const roster = await loadJson(ROSTER_PATH);
  const variants = roster.characters.flatMap((character) => character.variants
    .filter((variant) => variant.status === 'source-available')
    .map((variant) => ({ character, variant })));
  const concurrency = Number(option(args, '--concurrency', '4'));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('--concurrency must be an integer from 1 to 32');
  let cursor = 0;
  async function worker() {
    while (cursor < variants.length) {
      const index = cursor++;
      const { character, variant } = variants[index];
      await run(process.execPath, [
        'shared/image-processing/prepare-standalone-assets.mjs',
        '--character', character.character_id,
        '--variant', variant.variant_id,
      ]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, variants.length) }, () => worker()));
  await run(process.execPath, ['shared/image-processing/sync-generated-motion-manifest.mjs']);
  await run(process.execPath, ['shared/image-processing/build-runtime-registry.mjs']);
  await run(process.execPath, ['shared/asset-tools/generate-standalone-registry.mjs']);
  await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
  await run(process.execPath, ['shared/image-processing/validate-standalone-coverage.mjs', '--check-accounted']);
  await run(process.execPath, [
    'shared/image-processing/validate-standalone-animation-coverage.mjs',
    '--require-roster-reconciled',
    '--require-complete',
  ]);
  await copyDirectory(RUNTIME_ASSETS, DIST_CHARACTERS);
  await syncDistMetadata();
  await run(process.execPath, [
    'shared/image-processing/generate-standalone-contact-sheets.mjs',
    ...forwarded(args, ['--concurrency']),
  ]);
  await run(process.execPath, ['shared/image-processing/validate-standalone-contact-sheets.mjs']);
}

async function packageApp(args) {
  await make('build', args);
  await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
  await run(process.execPath, ['shared/image-processing/validate-standalone-coverage.mjs']);
  await run(process.execPath, [
    'shared/image-processing/validate-standalone-animation-coverage.mjs',
    '--require-roster-reconciled',
    '--require-complete',
  ]);
  await run(process.execPath, ['shared/image-processing/validate-standalone-contact-sheets.mjs']);
  const binaryDestination = path.join(DIST_APP, 'bin', 'pet-ark');
  const launcherDestination = path.join(DIST_APP, 'pet-ark');
  await fs.rm(DIST_APP, { recursive: true, force: true });
  await Promise.all([
    fs.mkdir(path.dirname(binaryDestination), { recursive: true }),
    fs.mkdir(path.join(DIST_APP, 'characters'), { recursive: true }),
    fs.mkdir(path.join(DIST_APP, 'assets'), { recursive: true }),
  ]);
  await fs.copyFile(BUILD_BINARY, binaryDestination);
  await fs.chmod(binaryDestination, 0o755);
  await fs.writeFile(launcherDestination, `#!/bin/sh
set -eu
app_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$app_root/bin/pet-ark" --assets "$app_root/assets/runtime" "$@"
`);
  await fs.chmod(launcherDestination, 0o755);
  const registry = await loadJson(REGISTRY_PATH);
  await fs.writeFile(
    path.join(DIST_APP, 'characters', 'registry.json'),
    `${JSON.stringify(packagedRegistry(registry), null, 2)}\n`,
  );
  await copyDirectory(RUNTIME_ASSETS, path.join(DIST_APP, 'assets', 'runtime'));
  try {
    await fs.copyFile(path.join(STANDALONE_ROOT, 'dist', 'coverage.json'), path.join(DIST_APP, 'coverage.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.copyFile(path.join(STANDALONE_ROOT, 'dist', 'animation-coverage.json'), path.join(DIST_APP, 'animation-coverage.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    try {
      await fs.copyFile(path.join(REPO_ROOT, notice), path.join(DIST_APP, notice));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await fs.writeFile(path.join(DIST_APP, 'manifest.json'), `${JSON.stringify({
    schema_version: 2,
    executable: 'pet-ark',
    native_binary: 'bin/pet-ark',
    character_registry: 'characters/registry.json',
    runtime_assets: 'assets/runtime',
    coverage: 'coverage.json',
    animation_coverage: 'animation-coverage.json',
    platform: 'linux-wayland',
  }, null, 2)}\n`);
  await copyDirectory(RUNTIME_ASSETS, DIST_CHARACTERS);
  await syncDistMetadata();
  await validatePackagedRegistry();
  console.log(`packaged ${path.relative(REPO_ROOT, DIST_APP)}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  switch (command) {
    case 'build':
      if (option(args, '--character')) await prepareAssets(args);
      await make('build', args);
      break;
    case 'build-all':
      await prepareAll(args);
      await make('build', args);
      break;
    case 'test':
      await make('test', args);
      await run(process.execPath, ['shared/image-processing/test-standalone-animation-audit.mjs']);
      await run(process.execPath, ['shared/image-processing/test-derived-standalone-motion.mjs']);
      await run(process.execPath, ['shared/image-processing/test-standalone-contact-sheets.mjs']);
      await run(process.execPath, ['shared/image-processing/test-dist-manifest-hygiene.mjs']);
      break;
    case 'validate':
      await make('test', args);
      await run(process.execPath, ['shared/image-processing/test-standalone-animation-audit.mjs']);
      await run(process.execPath, ['shared/image-processing/test-standalone-contact-sheets.mjs']);
      await run(process.execPath, ['shared/image-processing/test-dist-manifest-hygiene.mjs']);
      if (option(args, '--character')) {
        const id = option(args, '--character');
        const variant = option(args, '--variant', option(args, '--skin', 'default'));
        await run(process.execPath, [
          'shared/image-processing/validate-generated-manifest.mjs',
          ...forwarded(args, ['--character', '--variant', '--skin']),
        ]);
        await withTemporaryManifestOutputs(async (temporaryDirectory) => {
          await run(process.execPath, [
            'shared/image-processing/validate-standalone-coverage.mjs',
            ...forwarded(args, ['--character', '--variant', '--skin']),
            '--write', path.join(temporaryDirectory, `coverage-${filenamePart(id)}-${filenamePart(variant)}.json`),
            '--require-complete',
          ]);
          await run(process.execPath, [
            'shared/image-processing/validate-standalone-animation-coverage.mjs',
            ...forwarded(args, ['--character', '--variant', '--skin']),
            '--write', path.join(temporaryDirectory, `animation-coverage-${filenamePart(id)}-${filenamePart(variant)}.json`),
            '--require-complete',
          ]);
        });
      } else {
        await run(process.execPath, ['shared/image-processing/test-derived-standalone-motion.mjs']);
        await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
        await run(process.execPath, ['shared/image-processing/validate-standalone-coverage.mjs']);
        await run(process.execPath, [
          'shared/image-processing/validate-standalone-animation-coverage.mjs',
          '--require-roster-reconciled',
          '--require-complete',
        ]);
      }
      break;
    case 'validate-all':
      await run(process.execPath, ['shared/image-processing/build-runtime-registry.mjs']);
      await run(process.execPath, ['shared/asset-tools/generate-standalone-registry.mjs']);
      await make('test', args);
      await run(process.execPath, ['shared/image-processing/test-standalone-animation-audit.mjs']);
      await run(process.execPath, ['shared/image-processing/test-derived-standalone-motion.mjs']);
      await run(process.execPath, ['shared/image-processing/test-standalone-contact-sheets.mjs']);
      await run(process.execPath, ['shared/image-processing/test-dist-manifest-hygiene.mjs']);
      await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
      await run(process.execPath, ['shared/image-processing/validate-standalone-coverage.mjs', '--check-accounted']);
      await run(process.execPath, [
        'shared/image-processing/validate-standalone-animation-coverage.mjs',
        '--require-roster-reconciled',
        '--require-complete',
      ]);
      await run(process.execPath, ['shared/image-processing/validate-standalone-contact-sheets.mjs']);
      await run(process.execPath, ['shared/image-processing/validate-dist-manifest-hygiene.mjs']);
      break;
    case 'audit':
      await run(process.execPath, [
        'shared/image-processing/validate-standalone-animation-coverage.mjs',
        ...forwarded(args, ['--character', '--variant', '--skin', '--concurrency']),
        ...((args.includes('--require-animation-complete') || args.includes('--require-complete')) ? ['--require-complete'] : []),
        '--require-roster-reconciled',
      ]);
      break;
    case 'assets':
      await prepareAssets(args);
      break;
    case 'package':
      await packageApp(args);
      break;
    case 'dev': {
      await make('build', args);
      const character = option(args, '--character', 'amiya');
      const skin = option(args, '--variant', option(args, '--skin'));
      await run(BUILD_BINARY, ['--assets', RUNTIME_ASSETS, '--character', character, ...(skin ? ['--skin', skin] : []), ...passthroughArgs(args)], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PET_ARK_ASSETS: RUNTIME_ASSETS,
        },
      });
      break;
    }
    default:
      usage();
      throw new Error(`Unknown standalone command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`standalone: ${error.message}`);
  process.exitCode = 1;
});
