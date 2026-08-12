#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE_ROOT = path.join(REPO_ROOT, 'standalone');
const BUILD_BINARY = path.join(STANDALONE_ROOT, 'build', 'pet-ark');
const DIST_APP = path.join(STANDALONE_ROOT, 'dist', 'app');
const REGISTRY_PATH = path.join(STANDALONE_ROOT, 'characters', 'registry.json');
const RUNTIME_ASSETS = path.join(STANDALONE_ROOT, 'assets', 'runtime');

function usage() {
  console.log(`Usage: node scripts/standalone.mjs <command> [options]

Commands:
  dev       Build and launch the Wayland desktop pet
  build     Compile the native application
  package   Create standalone/dist/app with binary and runtime resources
  test      Run native state-machine, movement, and animation tests
  validate  Run logic tests and validate character/runtime asset metadata
  assets    Prepare runtime atlases and regenerate the C registry

Options:
  --character <id>  Character for dev or asset preparation (default: amiya)
  --sysroot <path>  Forward a cross-compilation sysroot to make/pkg-config
  --jobs <count>    Parallel make jobs
  --refresh-source  Download and export the selected PRTS Spine source first
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

async function validateAssets() {
  const registry = await loadJson(REGISTRY_PATH);
  if (registry.schema_version !== 1 || !Array.isArray(registry.characters) || registry.characters.length === 0) {
    throw new Error('standalone character registry must use schema_version 1 and contain characters');
  }
  const requiredStates = ['idle', 'walk-left', 'walk-right', 'clicked', 'picked-up', 'dragging', 'dropped', 'rest', 'sleep', 'wake'];
  const seen = new Set();
  let stateCount = 0;
  for (const character of registry.characters) {
    if (!character.id || !character.name || seen.has(character.id)) throw new Error(`invalid or duplicate character id: ${character.id}`);
    seen.add(character.id);
    if (!character.assets || !character.animations || !character.movement || !character.mirrorRules) {
      throw new Error(`${character.id}: missing assets, animations, movement, or mirrorRules`);
    }
    for (const state of requiredStates) {
      if (!character.animations[state]) throw new Error(`${character.id}: missing required state ${state}`);
    }
    const runtimeDir = path.resolve(REPO_ROOT, character.assets);
    const runtime = await loadJson(path.join(runtimeDir, 'manifest.json'));
    if (runtime.schemaVersion !== 1 || runtime.character?.id !== character.id) throw new Error(`${character.id}: runtime manifest identity mismatch`);
    const frameWidth = runtime.frameSize?.width;
    const frameHeight = runtime.frameSize?.height;
    if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth < 1 || frameHeight < 1) {
      throw new Error(`${character.id}: invalid runtime frameSize`);
    }
    for (const [sourceId, source] of Object.entries(runtime.sources || {})) {
      if (!Number.isInteger(source.frames) || source.frames < 1 || source.hitboxes?.length !== source.frames) {
        throw new Error(`${character.id}:${sourceId}: source frame/hitbox count mismatch`);
      }
      const sheet = path.join(runtimeDir, source.sheet);
      await assertFile(sheet, `${character.id}:${sourceId} runtime sheet`);
      const dimensions = await pngDimensions(sheet);
      if (dimensions.width !== source.columns * frameWidth || dimensions.height !== source.rows * frameHeight) {
        throw new Error(`${character.id}:${sourceId}: runtime sheet dimensions do not match metadata`);
      }
      for (const hitbox of source.hitboxes) {
        if (![hitbox.x, hitbox.y, hitbox.width, hitbox.height].every(Number.isInteger) || hitbox.width < 1 || hitbox.height < 1) {
          throw new Error(`${character.id}:${sourceId}: invalid hitbox`);
        }
      }
    }
    for (const [state, animation] of Object.entries(runtime.animations || {})) {
      const source = runtime.sources?.[animation.source];
      if (!source || !Array.isArray(animation.frameOrder) || animation.frameOrder.length === 0 || !(animation.fps > 0)) {
        throw new Error(`${character.id}:${state}: invalid animation definition`);
      }
      if (animation.frameOrder.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= source.frames)) {
        throw new Error(`${character.id}:${state}: frame order references an unavailable source frame`);
      }
      stateCount++;
    }
  }
  console.log(`OK: ${registry.characters.length} standalone character(s), ${stateCount} runtime animation states`);
}

async function prepareAssets(args) {
  const registry = await loadJson(REGISTRY_PATH);
  const selected = option(args, '--character');
  const characters = selected
    ? registry.characters.filter((character) => character.id === selected)
    : registry.characters;
  if (characters.length === 0) throw new Error(`Unknown standalone character: ${selected}`);
  for (const character of characters) {
    const characterArgs = ['--character', character.id];
    if (args.includes('--refresh-source')) {
      await run(process.execPath, ['shared/asset-tools/acquire-prts-spine.mjs', ...characterArgs]);
      await run(process.execPath, ['shared/asset-tools/export-prts-spine.mjs', ...characterArgs]);
    }
    await run(process.execPath, ['shared/image-processing/prepare-standalone-assets.mjs', ...characterArgs]);
  }
  await run(process.execPath, ['shared/asset-tools/generate-standalone-registry.mjs']);
  await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
  await validateAssets();
}

async function packageApp(args) {
  await make('build', args);
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
  await fs.copyFile(REGISTRY_PATH, path.join(DIST_APP, 'characters', 'registry.json'));
  await fs.cp(RUNTIME_ASSETS, path.join(DIST_APP, 'assets', 'runtime'), { recursive: true });
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    try {
      await fs.copyFile(path.join(REPO_ROOT, notice), path.join(DIST_APP, notice));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await fs.writeFile(path.join(DIST_APP, 'manifest.json'), `${JSON.stringify({
    schema_version: 1,
    executable: 'pet-ark',
    native_binary: 'bin/pet-ark',
    character_registry: 'characters/registry.json',
    runtime_assets: 'assets/runtime',
    platform: 'linux-wayland',
  }, null, 2)}\n`);
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
      await make('build', args);
      break;
    case 'test':
      await make('test', args);
      break;
    case 'validate':
      await make('test', args);
      await run(process.execPath, ['shared/image-processing/validate-generated-manifest.mjs']);
      await validateAssets();
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
      await run(BUILD_BINARY, ['--assets', RUNTIME_ASSETS, '--character', character, ...passthroughArgs(args)], {
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
