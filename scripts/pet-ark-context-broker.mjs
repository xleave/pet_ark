#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

const runtimeRoot = process.env.XDG_RUNTIME_DIR
  ? path.join(process.env.XDG_RUNTIME_DIR, 'pet-ark')
  : null;
const once = process.argv.includes('--once');
const focusReactions = process.env.PET_ARK_CONTEXT_FOCUS !== 'false';
const socialReactions = process.env.PET_ARK_CONTEXT_SOCIAL !== 'false';
const minimumSocialSeconds = Math.max(45, Number(process.env.PET_ARK_CONTEXT_SOCIAL_MIN_SECONDS) || 90);
let focusedWindow = null;
let focusedWorkspace = null;
let focusChanges = 0;
let roundRobin = 0;
let ready = false;
let lastFocusReaction = 0;
let lastWorkspaceReaction = 0;
let socialTimer;

async function sockets() {
  if (!runtimeRoot) return [];
  try {
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name.endsWith('.sock'))
      .map((entry) => ({
        instance: entry.name === 'control.sock' ? 'default' : entry.name.slice(0, -5),
        path: path.join(runtimeRoot, entry.name),
      }))
      .sort((left, right) => left.instance.localeCompare(right.instance));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function request(socketPath, event) {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    client.setTimeout(1200);
    client.once('connect', () => client.end(`${JSON.stringify({ command: 'react', event })}\n`));
    client.once('timeout', () => client.destroy());
    client.once('error', () => resolve(false));
    client.once('close', () => resolve(true));
    client.resume();
  });
}

async function reactOne(event) {
  const available = await sockets();
  if (!available.length) return;
  const target = available[roundRobin++ % available.length];
  await request(target.path, event);
  console.log(`reaction ${event} -> ${target.instance}`);
}

async function socialMoment() {
  const available = await sockets();
  if (available.length >= 2) {
    const first = available[roundRobin++ % available.length];
    let second = available[roundRobin++ % available.length];
    if (second.path === first.path) second = available[(roundRobin++) % available.length];
    await request(first.path, 'attention');
    setTimeout(() => void request(second.path, 'celebrate'), 650);
    console.log(`social moment ${first.instance} -> ${second.instance}`);
  }
  const jitter = Math.round(minimumSocialSeconds * (0.7 + Math.random() * 0.8) * 1000);
  socialTimer = setTimeout(() => void socialMoment(), jitter);
}

async function focusChanged(id) {
  if (id === undefined || id === focusedWindow) return;
  focusedWindow = id;
  if (!ready || !focusReactions) return;
  focusChanges++;
  const now = Date.now();
  if (now - lastFocusReaction < 8000) return;
  lastFocusReaction = now;
  await reactOne(focusChanges % 3 === 0 ? 'attention' : 'wake');
}

async function workspaceChanged(id) {
  if (id === undefined || id === focusedWorkspace) return;
  focusedWorkspace = id;
  if (!ready || !focusReactions) return;
  const now = Date.now();
  if (now - lastWorkspaceReaction < 20000) return;
  lastWorkspaceReaction = now;
  await reactOne('celebrate');
}

async function handleEvent(event) {
  if (event.WindowsChanged) {
    const focused = event.WindowsChanged.windows.find((window) => window.is_focused);
    await focusChanged(focused?.id ?? null);
  } else if (event.WindowFocusChanged) {
    await focusChanged(event.WindowFocusChanged.id ?? null);
  } else if (event.WindowOpenedOrChanged?.window?.is_focused) {
    await focusChanged(event.WindowOpenedOrChanged.window.id);
  }
  if (event.WorkspacesChanged) {
    const focused = event.WorkspacesChanged.workspaces.find((workspace) => workspace.is_focused);
    await workspaceChanged(focused?.id ?? null);
  } else if (event.WorkspaceActivated && event.WorkspaceActivated.focused !== false) {
    await workspaceChanged(event.WorkspaceActivated.id);
  }
  if (event.ConfigLoaded) ready = true;
}

if (!runtimeRoot) throw new Error('XDG_RUNTIME_DIR is unavailable');
if (once) {
  const available = await sockets();
  await Promise.all(available.map((entry) => request(entry.path, 'wake')));
  console.log(`context smoke reaction delivered to ${available.length} instance(s)`);
} else {
  const compositor = spawn('niri', ['msg', '--json', 'event-stream'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: compositor.stdout });
  lines.on('line', (line) => {
    try {
      void handleEvent(JSON.parse(line)).catch((error) => {
        console.error(`ignored compositor event: ${error.message}`);
      });
    } catch (error) {
      console.error(`ignored malformed compositor event: ${error.message}`);
    }
  });
  compositor.once('error', (error) => {
    console.error(`cannot start niri event stream: ${error.message}`);
    process.exitCode = 1;
  });
  compositor.once('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0) process.exitCode = code || 1;
  });
  if (socialReactions) socialTimer = setTimeout(() => void socialMoment(), minimumSocialSeconds * 1000);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      clearTimeout(socialTimer);
      compositor.kill('SIGTERM');
    });
  }
  console.log(`watching niri desktop context; focus=${focusReactions}, social=${socialReactions}`);
}
