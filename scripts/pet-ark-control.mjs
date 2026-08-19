#!/usr/bin/env node

import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.log(`Usage: node scripts/pet-ark-control.mjs [--instance ID] <command> [value]

Commands:
  status
  scale <0.25..3.0>
  speed <0.1..5.0>
  auto-move <on|off>
  click-through <on|off>
  select <character> [variant]
  react <attention|celebrate|wake>
  quit

Environment:
  PET_ARK_CONTROL_SOCKET  Override the default runtime socket path`);
}

function boolean(value, label) {
  if (['on', 'true', '1', 'yes'].includes(value)) return true;
  if (['off', 'false', '0', 'no'].includes(value)) return false;
  throw new Error(`${label} must be on or off`);
}

function number(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function request(args) {
  const [command, ...values] = args;
  switch (command) {
    case 'status': return { command: 'get_status' };
    case 'scale': return { command: 'set_scale', value: number(values[0], 0.25, 3, 'scale') };
    case 'speed': return { command: 'set_speed', value: number(values[0], 0.1, 5, 'speed') };
    case 'auto-move': return { command: 'set_auto_move', value: boolean(values[0], 'auto-move') };
    case 'click-through': return { command: 'set_click_through', value: boolean(values[0], 'click-through') };
    case 'select':
      if (!values[0]) throw new Error('select needs a character id');
      return { command: 'select', character: values[0], ...(values[1] ? { variant: values[1] } : {}) };
    case 'react':
      if (!['attention', 'celebrate', 'wake'].includes(values[0])) {
        throw new Error('react needs attention, celebrate, or wake');
      }
      return { command: 'react', event: values[0] };
    case 'quit': return { command: 'quit' };
    default: throw new Error(`unknown command: ${command || '(none)'}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const instanceIndex = args.indexOf('--instance');
  let instance = process.env.PET_ARK_INSTANCE || 'default';
  if (instanceIndex >= 0) {
    if (!args[instanceIndex + 1]) throw new Error('--instance needs an id');
    instance = args[instanceIndex + 1];
    args.splice(instanceIndex, 2);
  }
  if (!/^[a-z0-9._-]+$/i.test(instance)) throw new Error('instance id contains unsupported characters');
  const runtime = process.env.XDG_RUNTIME_DIR;
  const socketPath = process.env.PET_ARK_CONTROL_SOCKET ||
    (runtime ? path.join(runtime, 'pet-ark', `${instance === 'default' ? 'control' : instance}.sock`) : null);
  if (!socketPath) throw new Error('XDG_RUNTIME_DIR and PET_ARK_CONTROL_SOCKET are unavailable');
  const payload = request(args);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000);
    socket.once('connect', () => socket.end(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => { response += chunk; });
    socket.once('timeout', () => socket.destroy(new Error('control request timed out')));
    socket.once('error', reject);
    socket.once('close', () => {
      if (!response.trim()) return reject(new Error('runtime returned no response'));
      try {
        const parsed = JSON.parse(response);
        console.log(JSON.stringify(parsed, null, 2));
        if (!parsed.ok) process.exitCode = 1;
        resolve();
      } catch (error) {
        reject(new Error(`invalid runtime response: ${error.message}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(`pet-ark-control: ${error.message}`);
  process.exitCode = 1;
});
