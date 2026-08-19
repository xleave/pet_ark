#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_BINARY = path.join(
  ROOT,
  'control-center',
  'src-tauri',
  'target',
  'release',
  'pet-ark-control-center',
);
const APP_BINARY = path.join(ROOT, 'standalone', 'dist', 'app', 'bin', 'pet-ark-control-center');
const SOURCE_ICON = path.join(ROOT, 'control-center', 'src-tauri', 'icons', 'icon.png');

function desktopEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(' ', '\\ ').replaceAll('\t', '\\t');
}

function runOptional(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

async function writeAtomic(destination, contents, mode) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, { mode });
  await fs.rename(temporary, destination);
}

async function copyAtomic(source, destination, mode) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.copyFile(source, temporary);
  await fs.chmod(temporary, mode);
  await fs.rename(temporary, destination);
}

async function main() {
  const home = os.homedir();
  const desktopPath = path.join(
    home,
    '.local',
    'share',
    'applications',
    'io.github.xleave.petark.control.desktop',
  );
  const iconPath = path.join(
    home,
    '.local',
    'share',
    'icons',
    'hicolor',
    '512x512',
    'apps',
    'pet-ark-control-center.png',
  );
  const stat = await fs.stat(RELEASE_BINARY);
  if (!stat.isFile()) throw new Error('release binary is missing; run npm run control:center:build first');

  await copyAtomic(RELEASE_BINARY, APP_BINARY, 0o755);
  await copyAtomic(SOURCE_ICON, iconPath, 0o644);
  const desktop = `[Desktop Entry]
Type=Application
Version=1.0
Name=Pet Ark Control Center
Name[zh_CN]=Pet Ark 桌宠控制中心
Comment=Manage the native Wayland desktop pet
Comment[zh_CN]=管理原生 Wayland 桌宠、配置与日志
Exec=${desktopEscape(APP_BINARY)}
Icon=pet-ark-control-center
Terminal=false
Categories=Settings;
Keywords=desktop;pet;wayland;arknights;
StartupNotify=true
StartupWMClass=pet-ark-control-center
`;
  await writeAtomic(desktopPath, desktop, 0o644);
  await runOptional('update-desktop-database', [path.dirname(desktopPath)]);
  console.log(`installed ${APP_BINARY}`);
  console.log(`desktop entry ${desktopPath}`);
  console.log('login startup remains unchanged');
}

main().catch((error) => {
  console.error(`install-control-center: ${error.message}`);
  process.exitCode = 1;
});
