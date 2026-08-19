#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { LOW_MOTION_VARIANTS } from './derive-standalone-motion.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sequenceSignature(animation) {
  return JSON.stringify([animation.source, animation.frameOrder]);
}

async function framePixels(runtimeDir, source, frame) {
  const file = path.join(runtimeDir, source.sheet);
  const width = (await sharp(file).metadata()).width / source.columns;
  const height = (await sharp(file).metadata()).height / source.rows;
  return sharp(file).extract({
    left: (frame % source.columns) * width,
    top: Math.floor(frame / source.columns) * height,
    width,
    height,
  }).ensureAlpha().raw().toBuffer();
}

function alphaShape(pixels, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let alphaPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      alphaPixels++;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    alphaPixels,
    bboxArea: right >= left && bottom >= top ? (right - left + 1) * (bottom - top + 1) : 0,
  };
}

async function animationEndpoint(runtimeDir, runtime, state, endpoint) {
  const animation = runtime.animations[state];
  const source = runtime.sources[animation.source];
  const frame = endpoint === 'first' ? animation.frameOrder[0] : animation.frameOrder.at(-1);
  return framePixels(runtimeDir, source, frame);
}

function pixelDifference(a, b) {
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference += Math.abs(a[index] - b[index]);
  return difference / a.length;
}

async function runtimeVariantsWith(state) {
  const runtimeRoot = path.join(root, 'standalone/assets/runtime');
  const matches = [];
  for (const characterEntry of await fs.readdir(runtimeRoot, { withFileTypes: true })) {
    if (!characterEntry.isDirectory()) continue;
    const characterDir = path.join(runtimeRoot, characterEntry.name);
    for (const variantEntry of await fs.readdir(characterDir, { withFileTypes: true })) {
      if (!variantEntry.isDirectory()) continue;
      const runtimeDir = path.join(characterDir, variantEntry.name);
      const runtime = JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8'));
      if (runtime.animations[state]) matches.push({
        identity: `${characterEntry.name}/${variantEntry.name}`,
        runtimeDir,
        runtime,
      });
    }
  }
  return matches;
}


async function readRuntime(identity) {
  const runtimeDir = path.join(root, 'standalone/assets/runtime', identity);
  return {
    identity,
    runtimeDir,
    runtime: JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8')),
  };
}

async function assertSingleSilhouetteBridges(identity) {
  const { runtimeDir, runtime } = await readRuntime(identity);
  const source = runtime.sources['derived-motion'];
  assert.ok(source, `${identity}: derived-motion source missing`);
  const [frameWidth, frameHeight] = [runtime.frameSize.width, runtime.frameSize.height];
  for (const [state, animation] of Object.entries(runtime.animations)) {
    if (!animation.transitionBridge) continue;
    const bridge = runtime.provenance.derivedAnimations.find((sequence) => sequence.id === animation.transitionBridge);
    assert.ok(bridge, `${identity}:${state}: bridge provenance missing`);
    assert.equal(bridge.bridge_style, 'single-silhouette-endpoint-transform', `${identity}:${state}: bridge style`);
    const firstPosition = animation.frameOrder.length - bridge.atlas_frames.length;
    assert.ok(firstPosition > 0, `${identity}:${state}: bridge has no physical predecessor`);
    const target = runtime.animations[animation.next];
    assert.ok(target, `${identity}:${state}: next state missing`);
    const [predecessorPixels, targetPixels] = await Promise.all([
      framePixels(runtimeDir, source, animation.frameOrder[firstPosition - 1]),
      framePixels(runtimeDir, runtime.sources[target.source], target.frameOrder[0]),
    ]);
    const endpointShapes = [
      alphaShape(predecessorPixels, frameWidth, frameHeight),
      alphaShape(targetPixels, frameWidth, frameHeight),
    ];
    const maximumAlphaArea = Math.max(...endpointShapes.map((shape) => shape.alphaPixels), 1);
    const maximumBboxArea = Math.max(...endpointShapes.map((shape) => shape.bboxArea), 1);
    for (const frame of bridge.atlas_frames.slice(0, -1)) {
      const pixels = await framePixels(runtimeDir, source, frame);
      const shape = alphaShape(pixels, frameWidth, frameHeight);
      assert.ok(shape.alphaPixels > 0, `${identity}:${state}:${frame}: bridge frame is transparent`);
      assert.ok(shape.alphaPixels <= maximumAlphaArea * 1.45, `${identity}:${state}:${frame}: bridge alpha area expanded`);
      assert.ok(shape.bboxArea <= maximumBboxArea * 1.2, `${identity}:${state}:${frame}: bridge bbox area expanded`);
    }
    const bridgeLast = await framePixels(runtimeDir, source, bridge.atlas_frames.at(-1));
    assert.ok(bridgeLast.equals(targetPixels), `${identity}:${state}: bridge does not end at exact target`);
  }
}

for (const identity of LOW_MOTION_VARIANTS) {
  const runtimeDir = path.join(root, 'standalone/assets/runtime', identity);
  const runtime = JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8'));
  const animations = runtime.animations;
  for (const state of ['run-left', 'run-right', 'picked-up', 'dragging', 'dropped', 'rest', 'sleep', 'wake', 'special']) {
    assert.ok(animations[state], `${identity}:${state} missing`);
    assert.ok(['source', 'derived', 'generated'].includes(animations[state].origin), `${identity}:${state} origin`);
    assert.ok(animations[state].provenanceId, `${identity}:${state} provenanceId`);
  }
  assert.notEqual(sequenceSignature(animations['run-right']), sequenceSignature(animations['walk-right']), `${identity}: fake run`);
  assert.notEqual(sequenceSignature(animations.clicked), sequenceSignature(animations.special), `${identity}: clicked=special`);
  assert.notEqual(sequenceSignature(animations.idle), sequenceSignature(animations.rest), `${identity}: idle=rest`);
  assert.notEqual(sequenceSignature(animations.rest), sequenceSignature(animations.sleep), `${identity}: rest=sleep`);
  assert.ok(animations['picked-up'].frameOrder.length >= 6, `${identity}: picked-up frame count`);
  assert.ok(animations.dragging.frameOrder.length >= 6, `${identity}: dragging frame count`);
  assert.ok(animations.dropped.frameOrder.length >= 8, `${identity}: dropped frame count`);
  assert.equal(animations.rest.loop, false, `${identity}: power-down transition must not loop`);
  assert.equal(animations.rest.next, 'sleep', `${identity}: power-down transition target`);
  assert.equal(animations.sleep.loop, true, `${identity}: powered-down pulse must loop`);
  assert.equal(animations.wake.intentionalReverseOf, 'rest', `${identity}: wake provenance`);
  const powerDown = runtime.provenance.derivedAnimations.find((sequence) => sequence.id === 'rest-power-down');
  assert.ok(powerDown, `${identity}: power-down provenance`);
  assert.deepEqual(
    animations.wake.frameOrder.slice(0, powerDown.atlas_frames.length),
    powerDown.atlas_frames.slice().reverse(),
    `${identity}: wake begins with reverse power-down motion`,
  );
  assert.ok(animations.wake.frameOrder.length > powerDown.atlas_frames.length, `${identity}: wake lacks idle transition bridge`);
  const endpointChecks = [
    ['dropped', 'idle'],
    ['rest', 'sleep'],
    ['wake', 'idle'],
    ['special', 'idle'],
  ];
  for (const [from, to] of endpointChecks) {
    const [fromPixels, toPixels] = await Promise.all([
      animationEndpoint(runtimeDir, runtime, from, 'last'),
      animationEndpoint(runtimeDir, runtime, to, 'first'),
    ]);
    assert.ok(fromPixels.equals(toPixels), `${identity}: ${from}->${to} endpoint pixels differ`);
  }
  const wakeFrames = await Promise.all(animations.wake.frameOrder.map((frame) => framePixels(runtimeDir, runtime.sources[animations.wake.source], frame)));
  assert.ok(new Set(wakeFrames.map((frame) => frame.toString('base64'))).size >= 6, `${identity}: wake transition is visually repeated`);
  const source = runtime.sources['derived-motion'];
  const sleepFrames = await Promise.all(animations.sleep.frameOrder.map((frame) => framePixels(runtimeDir, source, frame)));
  const uniqueSleepFrames = new Set(sleepFrames.map((frame) => frame.toString('base64')));
  assert.ok(uniqueSleepFrames.size >= 5, `${identity}: sleep pulse is static`);
  const seam = pixelDifference(sleepFrames.at(-1), sleepFrames[0]);
  const internal = sleepFrames.slice(1).map((frame, index) => pixelDifference(sleepFrames[index], frame));
  assert.ok(seam <= Math.max(...internal) * 1.5, `${identity}: sleep loop seam jumps (${seam})`);
}

const exitVariants = await runtimeVariantsWith('exit');
assert.ok(exitVariants.length > 0, 'expected at least one optional exit animation');
for (const { identity, runtimeDir, runtime } of exitVariants) {
  const exit = runtime.animations.exit;
  assert.equal(exit.origin, 'derived', `${identity}: exit must include a derived settle bridge`);
  assert.equal(exit.next, 'idle', `${identity}: exit transition target`);
  assert.equal(exit.loop, false, `${identity}: exit must not loop`);
  const exitSource = runtime.provenance.derivedAnimations.find((sequence) => sequence.state === 'exit-source');
  const exitSettle = runtime.provenance.derivedAnimations.find((sequence) => sequence.state === 'exit-settle');
  assert.ok(exitSource, `${identity}: physical exit provenance`);
  assert.ok(exitSettle, `${identity}: exit bridge provenance`);
  assert.equal(exit.transitionBridge, exitSettle.id, `${identity}: exit settle provenance`);
  assert.ok(exitSettle.atlas_frames.length >= 8, `${identity}: exit bridge is too short`);
  assert.equal(
    exit.frameOrder.length,
    exitSource.atlas_frames.length + exitSettle.atlas_frames.length,
    `${identity}: exit does not include both physical and settle sequences`,
  );
  const [exitPixels, idlePixels] = await Promise.all([
    animationEndpoint(runtimeDir, runtime, 'exit', 'last'),
    animationEndpoint(runtimeDir, runtime, 'idle', 'first'),
  ]);
  assert.ok(exitPixels.equals(idlePixels), `${identity}: exit->idle endpoint pixels differ`);
}

const representativeBridgeVariants = [
  'amiya/default',
  'dobermann/default',
  'necrass/default',
  'rosmontis/default',
  'meteor/skin-epoque-28',
];
for (const identity of representativeBridgeVariants) await assertSingleSilhouetteBridges(identity);

for (const identity of ['dobermann/default', 'mizuki/default', 'u-official/skin-sanrio-1']) {
  const { runtime } = await readRuntime(identity);
  const wakeTransition = runtime.provenance.derivedAnimations.find((sequence) => sequence.state === 'wake-transition');
  assert.ok(wakeTransition, `${identity}: sparse wake transition provenance missing`);
  assert.deepEqual(
    runtime.animations.wake.frameOrder.slice(0, wakeTransition.atlas_frames.length),
    wakeTransition.atlas_frames,
    `${identity}: sparse wake transition is not wired into runtime`,
  );
}

const allRuntimeVariants = await runtimeVariantsWith('idle');
for (const { identity, runtime } of allRuntimeVariants) {
  const source = runtime.sources['derived-motion'];
  if (!source) continue;
  const referenced = new Set(Object.values(runtime.animations)
    .filter((animation) => animation.source === 'derived-motion')
    .flatMap((animation) => animation.frameOrder));
  const missing = Array.from({ length: source.frames }, (_, frame) => frame).filter((frame) => !referenced.has(frame));
  assert.deepEqual(missing, [], `${identity}: unreferenced derived frames`);
}

const generated = JSON.parse(await fs.readFile(path.join(root, 'standalone/assets/generated/manifest.json'), 'utf8'));
const acceptedPowerDown = generated.sequences.filter((sequence) =>
  sequence.accepted && sequence.managed_by === 'standalone-derived-motion-v1' && sequence.generator_kind === 'image2-equivalent'
);
assert.equal(acceptedPowerDown.length, LOW_MOTION_VARIANTS.size, 'accepted power-down midpoint count');
assert.ok(generated.sequences.some((sequence) =>
  !sequence.accepted && sequence.character === 'castle-3' && sequence.animation === 'power-down-image2-v1'
), 'Castle-3 rejected built-in image2 candidate');

console.log(`OK: ${LOW_MOTION_VARIANTS.size} low-source variants have distinct grabbed/drag/drop, power-down, seamless sleep, wake, run, and special motion; ${exitVariants.length} optional exit animations settle to idle`);
