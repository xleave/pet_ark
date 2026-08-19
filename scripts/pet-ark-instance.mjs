#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const instancesRoot = path.join(os.homedir(), '.config/pet-ark/instances');
const safeId = /^[a-z0-9._-]+$/i;

function usage() {
  console.log(`Usage: node scripts/pet-ark-instance.mjs <command> [arguments]

Commands:
  list
  create ID [--character ID] [--variant ID] [--scale N] [--speed N] [--monitor N] [--no-start]
  start|stop|restart ID`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (capture) child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with status ${code}`));
      else resolve(capture ? Buffer.concat(chunks).toString('utf8') : undefined);
    });
  });
}

function numberOption(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`);
  return parsed;
}

async function writeAtomic(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function createInstance(id, args) {
  const registry = JSON.parse(await fs.readFile(path.join(root, 'standalone/characters/registry.json'), 'utf8'));
  const characterId = option(args, '--character', 'amiya');
  const character = registry.characters.find((entry) => entry.id === characterId);
  if (!character) throw new Error(`unknown character: ${characterId}`);
  const variantId = option(args, '--variant', character.default_variant_id);
  if (!character.variants.some((entry) => entry.id === variantId)) throw new Error(`unknown variant: ${characterId}/${variantId}`);
  const scale = numberOption(option(args, '--scale', '1'), 0.25, 3, 'scale');
  const speed = numberOption(option(args, '--speed', '1'), 0.1, 5, 'speed');
  const monitor = numberOption(option(args, '--monitor', '0'), 0, 15, 'monitor');
  if (!Number.isInteger(monitor)) throw new Error('monitor must be an integer');
  const file = path.join(instancesRoot, `${id}.env`);
  try {
    await fs.access(file);
    throw new Error(`instance already exists: ${id}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeAtomic(file, `PET_ARK_CHARACTER=${characterId}\nPET_ARK_VARIANT=${variantId}\nPET_ARK_SCALE=${scale}\nPET_ARK_SPEED=${speed}\nPET_ARK_AUTO_MOVE=true\nPET_ARK_CLICK_THROUGH=false\nPET_ARK_MONITOR=${monitor}\nPET_ARK_VERBOSE=true\n`);
  if (!args.includes('--no-start')) await run('systemctl', ['--user', 'start', `pet-ark@${id}.service`]);
  console.log(`created ${id}: ${characterId}/${variantId}`);
}

async function listInstances() {
  await fs.mkdir(instancesRoot, { recursive: true, mode: 0o700 });
  const entries = (await fs.readdir(instancesRoot)).filter((entry) => entry.endsWith('.env')).sort();
  if (!entries.length) return console.log('no additional pet instances');
  for (const entry of entries) {
    const id = entry.slice(0, -4);
    const state = (await run('systemctl', ['--user', 'is-active', `pet-ark@${id}.service`], { capture: true }).catch(() => 'inactive')).trim();
    console.log(`${id}\t${state}\t${path.join(instancesRoot, entry)}`);
  }
}

const [command, id, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === '-h') usage();
else if (command === 'list') await listInstances();
else {
  if (!id || !safeId.test(id) || id === 'default' || id === 'control') throw new Error('instance id must be safe and cannot be default/control');
  if (command === 'create') await createInstance(id, args);
  else if (['start', 'stop', 'restart'].includes(command)) await run('systemctl', ['--user', command, `pet-ark@${id}.service`]);
  else throw new Error(`unknown command: ${command}`);
}
