#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const [sourceA, sourceB, output] = process.argv.slice(2);

if (!sourceA || !sourceB || !output) {
  console.error('Usage: node shared/image-processing/interpolate-frame.mjs <frame-a.png> <frame-b.png> <output.png>');
  process.exit(2);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function difference(a, b) {
  let changedPixels = 0;
  let absoluteError = 0;
  for (let offset = 0; offset < a.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a[offset + channel] - b[offset + channel]);
      absoluteError += delta;
      changed ||= delta !== 0;
    }
    changedPixels += Number(changed);
  }
  return {
    changed_pixels: changedPixels,
    mean_absolute_error: absoluteError / a.length,
  };
}

const a = await sharp(sourceA).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const b = await sharp(sourceB).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
  throw new Error(`Source dimensions differ: ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}`);
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-ark-interpolate-'));
try {
  await Promise.all([
    fs.copyFile(sourceA, path.join(temporary, '000.png')),
    fs.copyFile(sourceB, path.join(temporary, '001.png')),
    // minterpolate buffers a future frame before it emits the A/B interval.
    fs.copyFile(sourceB, path.join(temporary, '002.png')),
  ]);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-framerate', '1', '-start_number', '0',
    '-i', path.join(temporary, '%03d.png'),
    '-vf', 'minterpolate=fps=2:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=rgba',
    '-frames:v', '3',
    path.join(temporary, 'interpolated-%03d.png'),
  ]);

  const midpoint = await sharp(path.join(temporary, 'interpolated-002.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  for (let offset = 0; offset < midpoint.data.length; offset += 4) {
    if (midpoint.data[offset + 3] === 0) {
      midpoint.data[offset] = 0;
      midpoint.data[offset + 1] = 0;
      midpoint.data[offset + 2] = 0;
    } else {
      visiblePixels++;
    }
  }
  if (!visiblePixels) throw new Error('Interpolated frame is fully transparent');

  const fromA = difference(a.data, midpoint.data);
  const fromB = difference(midpoint.data, b.data);
  if (!fromA.changed_pixels || !fromB.changed_pixels) {
    throw new Error('Interpolated frame duplicates an endpoint');
  }

  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await sharp(midpoint.data, {
    raw: {
      width: midpoint.info.width,
      height: midpoint.info.height,
      channels: 4,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);

  console.log(JSON.stringify({
    source_frame_a: sourceA,
    source_frame_b: sourceB,
    output,
    width: midpoint.info.width,
    height: midpoint.info.height,
    visible_pixels: visiblePixels,
    difference_from_a: fromA,
    difference_from_b: fromB,
    generator: 'ffmpeg minterpolate 50% optical-flow midpoint',
  }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
