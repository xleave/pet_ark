#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { DEFAULT_BEHAVIOR_CONFIG, normalizeBehaviorConfig } from '../shared/behavior/config.mjs';
import { MockAiProvider } from '../shared/behavior/mock-ai-provider.mjs';
import { createProvider } from '../shared/behavior/provider.mjs';
import { BehaviorScheduler } from '../shared/behavior/scheduler.mjs';

const runtimeRoot = process.env.XDG_RUNTIME_DIR
  ? path.join(process.env.XDG_RUNTIME_DIR, 'pet-ark')
  : null;
const configRoot = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'pet-ark')
  : path.join(os.homedir(), '.config/pet-ark');
const stateRoot = process.env.XDG_STATE_HOME
  ? path.join(process.env.XDG_STATE_HOME, 'pet-ark')
  : path.join(os.homedir(), '.local/state/pet-ark');
const configPath = path.join(configRoot, 'behavior.json');
const timelinePath = path.join(stateRoot, 'events.jsonl');
const once = process.argv.includes('--once');
const replayIndex = process.argv.indexOf('--replay');

let config = normalizeBehaviorConfig(DEFAULT_BEHAVIOR_CONFIG);
let configMtime = 0;
let provider = new MockAiProvider(config);
let providerHealth = { state: 'mock', message: 'Mock AI active', checked_at: Date.now() };
let focusedWindow = null;
let focusedWorkspace = null;
let ready = false;
let running = true;
let world = [];
let roundRobin = 0;
let previousPointer = new Map();
let windows = new Map();
let overviewOpen = false;
let lastWorldWrite = 0;
let socialTimer;
let worldTimer;
let schedulerTimer;
let configTimer;

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function loadConfig({ create = true } = {}) {
  try {
    const stat = await fs.stat(configPath);
    if (stat.mtimeMs === configMtime) return false;
    config = normalizeBehaviorConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
    configMtime = stat.mtimeMs;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = normalizeBehaviorConfig(DEFAULT_BEHAVIOR_CONFIG);
    if (create) {
      await writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
      configMtime = (await fs.stat(configPath)).mtimeMs;
    }
  }
  provider = createProvider(config);
  providerHealth = {
    state: config.provider.kind === 'mock' ? 'mock' : 'configured',
    message: config.provider.kind === 'mock' ? 'Mock AI active' : `${config.provider.kind} configured`,
    checked_at: Date.now(),
  };
  return true;
}

function timelineRecord(event) {
  const intent = event.intent || event.active;
  return {
    timestamp: event.timestamp || Date.now(),
    type: event.type,
    target: intent?.target || event.target || null,
    action: intent?.action || null,
    source: intent?.source || null,
    reason: event.reason || intent?.reason || null,
    speech: intent?.speech || null,
    provider: config.provider.kind,
  };
}

async function appendTimeline(event) {
  if (!config.privacy.persist_timeline) return;
  try {
    await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await fs.appendFile(timelinePath, `${JSON.stringify(timelineRecord(event))}\n`, { mode: 0o600 });
    const stat = await fs.stat(timelinePath);
    if (stat.size > 2 * 1024 * 1024) await fs.rename(timelinePath, `${timelinePath}.1`).catch(() => {});
  } catch (error) {
    console.error(`timeline unavailable: ${error.message}`);
  }
}

const scheduler = new BehaviorScheduler({
  onEvent: (event) => {
    void appendTimeline(event);
    if (event.type === 'rejected') console.error(`rejected intent: ${event.reason}`);
  },
});

async function sockets() {
  if (!runtimeRoot) return [];
  try {
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isSocket() && entry.name.endsWith('.sock'))
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

function request(socketPath, payload, timeout = 1200) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let response = '';
    client.setEncoding('utf8');
    client.setTimeout(timeout);
    client.once('connect', () => client.end(`${JSON.stringify(payload)}\n`));
    client.on('data', (chunk) => { response += chunk; });
    client.once('timeout', () => client.destroy(new Error('runtime request timed out')));
    client.once('error', reject);
    client.once('close', () => {
      try {
        const value = JSON.parse(response);
        if (!value.ok) reject(new Error(value.error || 'runtime rejected request'));
        else resolve(value);
      } catch (error) {
        reject(new Error(`runtime returned invalid JSON: ${error.message}`));
      }
    });
  });
}

function nextTarget() {
  if (!world.length) return 'default';
  return world[roundRobin++ % world.length].instance;
}

function sanitizedContext(context) {
  const value = { ...context };
  if (!config.privacy.include_app_id) delete value.app_id;
  if (!config.privacy.include_window_title) delete value.title;
  if (!config.privacy.include_workspace_name) delete value.workspace_name;
  value.instances = world.map(({ instance, character, variant, x, y, width, height, direction, pointer_inside }) => ({
    instance, character, variant, x, y, width, height, direction, pointer_inside,
  }));
  return value;
}

async function decide(context) {
  if (!config.enabled || config.interaction_intensity <= 0) return;
  const enriched = sanitizedContext({ target: context.target || nextTarget(), ...context });
  try {
    const intents = await provider.decide(enriched);
    providerHealth = { state: 'ready', message: config.provider.kind, checked_at: Date.now() };
    for (const intent of intents) {
      if (intent.priority < 75 && Math.random() > config.interaction_intensity) {
        await appendTimeline({ type: 'suppressed', reason: 'interaction-intensity', intent, timestamp: Date.now() });
        continue;
      }
      scheduler.submit(intent);
    }
  } catch (error) {
    providerHealth = { state: 'fallback', message: error.message.slice(0, 240), checked_at: Date.now() };
    console.error(`AI provider fallback: ${error.message}`);
    const fallback = await new MockAiProvider(config).decide(enriched);
    for (const intent of fallback) scheduler.submit({ ...intent, source: 'mock-fallback' });
  }
}

function center(entry) {
  return { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };
}

function runtimePayload(intent) {
  const own = world.find((entry) => entry.instance === intent.target);
  const other = world.find((entry) => entry.instance === intent.params.target_instance);
  if (intent.action === 'follow' && own && other) {
    const otherCenter = center(other);
    const gap = intent.params.gap || 88;
    const side = center(own).x <= otherCenter.x ? -1 : 1;
    return { command: 'act', action: 'follow', x: Math.max(0, otherCenter.x + side * gap - own.width / 2) };
  }
  if (intent.action === 'flee' && own && other) {
    const direction = center(own).x <= center(other).x ? -1 : 1;
    return { command: 'act', action: 'flee', x: direction < 0 ? 0 : Math.max(0, own.surface_width - own.width) };
  }
  if (intent.action === 'look_at') {
    let direction = intent.params.direction;
    if (!direction && own && other) direction = center(other).x < center(own).x ? -1 : 1;
    return { command: 'act', action: 'look_at', direction: direction || 1 };
  }
  if (intent.action === 'move_to') return { command: 'act', action: 'move_to', x: intent.params.x || 0 };
  if (intent.action === 'emote') return { command: 'act', action: 'emote', event: intent.params.event || 'attention' };
  if (intent.action === 'sequence') return { command: 'act', action: 'emote', event: intent.params.event || 'attention' };
  return { command: 'act', action: intent.action };
}

async function execute(intent) {
  const entry = world.find((candidate) => candidate.instance === intent.target);
  if (!entry) {
    await appendTimeline({ type: 'failed', reason: 'target-offline', intent, timestamp: Date.now() });
    return;
  }
  try {
    await request(entry.socket, runtimePayload(intent));
    await appendTimeline({ type: 'executed', intent, timestamp: Date.now() });
    console.log(`action ${intent.action} -> ${intent.target}${intent.speech ? ` · ${intent.speech}` : ''}`);
  } catch (error) {
    await appendTimeline({ type: 'failed', reason: error.message, intent, timestamp: Date.now() });
  }
}

function overlaps(left, right) {
  if (left.surface_width !== right.surface_width || left.surface_height !== right.surface_height) return false;
  const horizontal = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const vertical = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return horizontal > Math.min(left.width, right.width) * 0.32 && vertical > Math.min(left.height, right.height) * 0.32;
}

async function writeWorldSnapshot() {
  if (!runtimeRoot || Date.now() - lastWorldWrite < 250) return;
  lastWorldWrite = Date.now();
  const snapshot = {
    schema_version: 1,
    timestamp: Date.now(),
    provider: providerHealth,
    interaction_intensity: config.interaction_intensity,
    instances: world.map(({ socket, ...entry }) => entry),
    scheduler: scheduler.snapshot(),
  };
  await writeAtomic(path.join(runtimeRoot, 'world.json'), `${JSON.stringify(snapshot, null, 2)}\n`).catch(() => {});
}

async function refreshWorld() {
  const available = await sockets();
  const statuses = await Promise.all(available.map(async (entry) => {
    try {
      const status = await request(entry.path, { command: 'get_status' }, 700);
      return { ...status, instance: entry.instance, socket: entry.path };
    } catch { return null; }
  }));
  world = statuses.filter(Boolean);
  for (const entry of world) {
    const before = previousPointer.get(entry.instance) || false;
    if (entry.pointer_inside && !before) void decide({ type: 'pointer_enter', target: entry.instance });
    previousPointer.set(entry.instance, entry.pointer_inside);
  }
  for (let left = 0; left < world.length; left += 1) {
    for (let right = left + 1; right < world.length; right += 1) {
      if (overlaps(world[left], world[right])) {
        void decide({ type: 'collision', target: world[right].instance, other: world[left].instance });
      }
    }
  }
  await writeWorldSnapshot();
}

function windowContext(window) {
  return {
    id: window?.id ?? null,
    app_id: window?.app_id ?? null,
    title: window?.title ?? null,
    workspace_id: window?.workspace_id ?? null,
    urgent: window?.is_urgent === true,
  };
}

async function focusChanged(id) {
  if (id === undefined || id === focusedWindow) return;
  focusedWindow = id;
  if (!ready) return;
  const window = windows.get(id);
  await decide({ type: 'focus_changed', ...windowContext(window), focus_direction: roundRobin % 2 ? -1 : 1 });
}

async function workspaceChanged(id, workspaceName = null) {
  if (id === undefined || id === focusedWorkspace) return;
  focusedWorkspace = id;
  if (!ready) return;
  await decide({ type: 'workspace_changed', workspace_id: id, workspace_name: workspaceName });
}

async function replaceWindows(nextWindows) {
  const next = new Map(nextWindows.map((window) => [window.id, window]));
  if (ready) {
    for (const [id, window] of next) {
      if (!windows.has(id)) void decide({ type: 'window_opened', ...windowContext(window) });
      else if (window.is_urgent && !windows.get(id)?.is_urgent) void decide({ type: 'window_urgent', ...windowContext(window) });
    }
    for (const [id, window] of windows) {
      if (!next.has(id)) void decide({ type: 'window_closed', ...windowContext(window) });
    }
  }
  windows = next;
  const focused = nextWindows.find((window) => window.is_focused);
  await focusChanged(focused?.id ?? null);
}

async function handleEvent(event) {
  if (event.WindowsChanged) await replaceWindows(event.WindowsChanged.windows);
  else if (event.WindowOpenedOrChanged?.window) {
    const window = event.WindowOpenedOrChanged.window;
    const previous = windows.get(window.id);
    windows.set(window.id, window);
    if (ready && !previous) void decide({ type: 'window_opened', ...windowContext(window) });
    if (ready && window.is_urgent && !previous?.is_urgent) void decide({ type: 'window_urgent', ...windowContext(window) });
    if (window.is_focused) await focusChanged(window.id);
  } else if (event.WindowClosed) {
    const previous = windows.get(event.WindowClosed.id);
    windows.delete(event.WindowClosed.id);
    if (ready) void decide({ type: 'window_closed', ...windowContext(previous) });
  } else if (event.WindowFocusChanged) await focusChanged(event.WindowFocusChanged.id ?? null);

  if (event.WorkspacesChanged) {
    const focused = event.WorkspacesChanged.workspaces.find((workspace) => workspace.is_focused);
    await workspaceChanged(focused?.id ?? null, focused?.name ?? null);
  } else if (event.WorkspaceActivated && event.WorkspaceActivated.focused !== false) {
    await workspaceChanged(event.WorkspaceActivated.id);
  }
  if (event.OverviewOpenedOrClosed && event.OverviewOpenedOrClosed.is_open !== overviewOpen) {
    overviewOpen = event.OverviewOpenedOrClosed.is_open;
    if (ready) void decide({ type: 'overview_changed', open: overviewOpen });
  }
  if (event.ConfigLoaded) ready = true;
}

async function replay(file) {
  const contents = await fs.readFile(file, 'utf8');
  const mock = new MockAiProvider(config);
  const output = [];
  for (const line of contents.split(/\r?\n/).filter(Boolean)) {
    const context = JSON.parse(line);
    output.push({ context, intents: await mock.decide(context) });
  }
  console.log(JSON.stringify(output, null, 2));
}

async function shutdown(compositor) {
  if (!running) return;
  running = false;
  clearTimeout(socialTimer);
  clearInterval(worldTimer);
  clearInterval(schedulerTimer);
  clearInterval(configTimer);
  compositor?.kill('SIGTERM');
  await writeWorldSnapshot();
}

if (replayIndex < 0) {
  if (!runtimeRoot) throw new Error('XDG_RUNTIME_DIR is unavailable');
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
}
await loadConfig({ create: replayIndex < 0 });

if (replayIndex >= 0) {
  const file = process.argv[replayIndex + 1];
  if (!file) throw new Error('--replay requires a JSONL file');
  await replay(path.resolve(file));
} else if (once) {
  await refreshWorld();
  for (const entry of world) scheduler.submit({ target: entry.instance, action: 'wake', priority: 100, ttl_ms: 2000, source: 'smoke' });
  for (const intent of scheduler.drain()) await execute(intent);
  console.log(`context smoke action delivered to ${world.length} instance(s)`);
} else {
  const compositor = spawn('niri', ['msg', '--json', 'event-stream'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: compositor.stdout });
  lines.on('line', (line) => {
    try { void handleEvent(JSON.parse(line)).catch((error) => console.error(`ignored compositor event: ${error.message}`)); }
    catch (error) { console.error(`ignored malformed compositor event: ${error.message}`); }
  });
  compositor.once('error', (error) => {
    console.error(`cannot start niri event stream: ${error.message}`);
    process.exitCode = 1;
  });
  compositor.once('exit', (code, signal) => {
    if (running && signal !== 'SIGTERM' && code !== 0) process.exitCode = code || 1;
  });
  worldTimer = setInterval(() => void refreshWorld().catch((error) => console.error(`world refresh: ${error.message}`)), 700);
  schedulerTimer = setInterval(() => {
    for (const intent of scheduler.drain()) void execute(intent);
  }, 120);
  configTimer = setInterval(() => void loadConfig().catch((error) => console.error(`config reload: ${error.message}`)), 2000);
  const scheduleSocial = () => {
    const minimum = 55_000 + Math.round((1 - config.interaction_intensity) * 120_000);
    socialTimer = setTimeout(() => {
      void decide({ type: 'social_tick' });
      scheduleSocial();
    }, minimum + Math.round(Math.random() * minimum * 0.7));
  };
  scheduleSocial();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown(compositor));
  await refreshWorld();
  console.log(`watching niri context; provider=${config.provider.kind}, intensity=${config.interaction_intensity.toFixed(2)}, instances=${world.length}`);
}
