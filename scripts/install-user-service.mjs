#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'standalone', 'systemd', 'pet-ark.service.in');
const DEFAULT_LAUNCHER = path.join(ROOT, 'standalone', 'dist', 'app', 'pet-ark');

function usage() {
  console.log(`Usage: node scripts/install-user-service.mjs [options]

Options:
  --launcher PATH  Packaged pet-ark launcher
  --no-start       Install without starting the service
  --enable         Enable login startup (disabled by default)
  --help           Show this help`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= args.length) throw new Error(`${name} needs a value`);
  return args[index + 1];
}

function unitQuote(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code !== 0 && !allowFailure) reject(new Error(`${command} exited with status ${code}`));
      else resolve(code);
    });
  });
}

async function writeAtomic(destination, contents, mode = 0o644) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, { mode });
  await fs.rename(temporary, destination);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const launcher = path.resolve(option(args, '--launcher', DEFAULT_LAUNCHER));
  const home = os.homedir();
  const unitPath = path.join(home, '.config', 'systemd', 'user', 'pet-ark.service');
  const environmentPath = path.join(home, '.config', 'pet-ark', 'runtime.env');
  const launcherStat = await fs.stat(launcher);
  if (!launcherStat.isFile()) throw new Error(`launcher is not a file: ${launcher}`);

  const template = await fs.readFile(TEMPLATE, 'utf8');
  const unit = template
    .replace('@PET_ARK_LAUNCHER@', unitQuote(launcher));
  const defaultEnvironment = `PET_ARK_CHARACTER=amiya
PET_ARK_VARIANT=default
PET_ARK_SCALE=1
PET_ARK_SPEED=1
PET_ARK_AUTO_MOVE=true
PET_ARK_CLICK_THROUGH=false
PET_ARK_MONITOR=0
PET_ARK_VERBOSE=true
`;

  await run('systemctl', ['--user', 'stop', 'pet-ark.service'], { allowFailure: true });
  await writeAtomic(unitPath, unit);
  try {
    await fs.access(environmentPath);
  } catch {
    await writeAtomic(environmentPath, defaultEnvironment, 0o600);
  }
  await run('systemctl', ['--user', 'daemon-reload']);
  if (args.includes('--enable')) await run('systemctl', ['--user', 'enable', 'pet-ark.service']);
  else await run('systemctl', ['--user', 'disable', 'pet-ark.service'], { allowFailure: true });
  if (!args.includes('--no-start')) await run('systemctl', ['--user', 'start', 'pet-ark.service']);
  console.log(`installed ${unitPath}`);
  console.log(`configuration ${environmentPath}`);
  console.log(`login startup ${args.includes('--enable') ? 'enabled' : 'disabled'}`);
}

main().catch((error) => {
  console.error(`install-user-service: ${error.message}`);
  process.exitCode = 1;
});
