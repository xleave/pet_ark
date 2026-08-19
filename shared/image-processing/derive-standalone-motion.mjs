import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const MAX_COLUMNS = 8;
const LOW_MOTION_VARIANTS = new Set([
  'castle-3/default',
  'castle-3/skin-summer-1',
  'confess-47/default',
  'friston-3/default',
  'gallus2/default',
  'justice-knight/default',
  'justice-knight/skin-boc-7',
  'lancet-2/default',
  'lancet-2/skin-boc-4',
  'phonor-0/default',
  'phonor-0/skin-boc-9',
  'thermal-ex/default',
  'thermal-ex/skin-marthe-7',
]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function clamped(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function alphaBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function cleanTransparentRgb(data) {
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3]) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  }
  return data;
}

function hasVisibleAlpha(data) {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 0) return true;
  }
  return false;
}

function blit(destination, destinationWidth, destinationHeight, source, sourceWidth, sourceHeight, left, top) {
  for (let sourceY = 0; sourceY < sourceHeight; sourceY++) {
    const destinationY = top + sourceY;
    if (destinationY < 0 || destinationY >= destinationHeight) continue;
    for (let sourceX = 0; sourceX < sourceWidth; sourceX++) {
      const destinationX = left + sourceX;
      if (destinationX < 0 || destinationX >= destinationWidth) continue;
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const destinationOffset = (destinationY * destinationWidth + destinationX) * 4;
      source.copy(destination, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

async function transformedRawFrame(sourceData, frameWidth, frameHeight, transform = {}, canvasPadding = 2) {
  const bounds = alphaBounds(sourceData, frameWidth, frameHeight);
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  let resizedWidth = Math.max(1, Math.round(bounds.width * scaleX));
  let resizedHeight = Math.max(1, Math.round(bounds.height * scaleY));
  const fitScale = Math.min(
    1,
    (frameWidth - canvasPadding * 2) / resizedWidth,
    (frameHeight - canvasPadding * 2) / resizedHeight,
  );
  resizedWidth = Math.max(1, Math.floor(resizedWidth * fitScale));
  resizedHeight = Math.max(1, Math.floor(resizedHeight * fitScale));
  const layer = await sharp(sourceData, {
    raw: { width: frameWidth, height: frameHeight, channels: 4 },
  }).extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
    .resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer();
  const brightness = transform.brightness ?? 1;
  const alpha = transform.alpha ?? 1;
  for (let offset = 0; offset < layer.length; offset += 4) {
    layer[offset] = clamped(Math.round(layer[offset] * brightness), 0, 255);
    layer[offset + 1] = clamped(Math.round(layer[offset + 1] * brightness), 0, 255);
    layer[offset + 2] = clamped(Math.round(layer[offset + 2] * brightness), 0, 255);
    layer[offset + 3] = clamped(Math.round(layer[offset + 3] * alpha), 0, 255);
  }
  cleanTransparentRgb(layer);
  const originalCenterX = bounds.x + bounds.width / 2;
  const originalBottom = bounds.y + bounds.height;
  const desiredLeft = Math.round(originalCenterX - resizedWidth / 2 + (transform.x ?? 0));
  const desiredTop = Math.round(originalBottom - resizedHeight + (transform.y ?? 0));
  const left = clamped(desiredLeft, canvasPadding, frameWidth - canvasPadding - resizedWidth);
  const top = clamped(desiredTop, canvasPadding, frameHeight - canvasPadding - resizedHeight);
  const output = Buffer.alloc(frameWidth * frameHeight * 4);
  blit(output, frameWidth, frameHeight, layer, resizedWidth, resizedHeight, left, top);
  cleanTransparentRgb(output);
  return {
    buffer: output,
    hitbox: alphaBounds(output, frameWidth, frameHeight),
    visible: hasVisibleAlpha(output),
  };
}

async function transformedFrame(file, frameWidth, frameHeight, transform = {}) {
  const source = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (source.info.width !== frameWidth || source.info.height !== frameHeight || source.info.channels !== 4) {
    throw new Error(`${file}: derived motion source must be ${frameWidth}x${frameHeight} RGBA`);
  }
  return transformedRawFrame(source.data, frameWidth, frameHeight, transform);
}

async function rawFrame(file, frameWidth, frameHeight) {
  const source = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (source.info.width !== frameWidth || source.info.height !== frameHeight || source.info.channels !== 4) {
    throw new Error(`${file}: transition target must be ${frameWidth}x${frameHeight} RGBA`);
  }
  cleanTransparentRgb(source.data);
  const hitbox = alphaBounds(source.data, frameWidth, frameHeight);
  return {
    buffer: source.data,
    hitbox,
    visible: hitbox.width > 1 || hitbox.height > 1 || source.data[3] !== 0,
  };
}

function opacityFrame(frame, opacity, frameWidth, frameHeight) {
  if (opacity >= 1) return {
    buffer: Buffer.from(frame.buffer),
    hitbox: { ...frame.hitbox },
    visible: frame.visible,
  };
  const output = Buffer.from(frame.buffer);
  for (let offset = 3; offset < output.length; offset += 4) {
    output[offset] = clamped(Math.round(output[offset] * opacity), 0, 255);
  }
  cleanTransparentRgb(output);
  return {
    buffer: output,
    hitbox: alphaBounds(output, frameWidth, frameHeight),
    visible: hasVisibleAlpha(output),
  };
}

function sampledOpacity(levels, index, count) {
  if (count <= 1) return levels.at(-1);
  const position = index * (levels.length - 1) / (count - 1);
  const left = Math.floor(position);
  const right = Math.min(levels.length - 1, Math.ceil(position));
  const progress = position - left;
  return levels[left] + (levels[right] - levels[left]) * progress;
}

async function transitionBridge(from, to, frameWidth, frameHeight, count = 8) {
  if (count < 4) throw new Error(`transition bridge needs at least 4 frames, received ${count}`);
  const frames = [];
  const fromCenter = from.hitbox.x + from.hitbox.width / 2;
  const fromBottom = from.hitbox.y + from.hitbox.height;
  const toCenter = to.hitbox.x + to.hitbox.width / 2;
  const toBottom = to.hitbox.y + to.hitbox.height;
  const sourceFrames = Math.floor(count / 2);
  const targetFrames = count - sourceFrames;
  const fadeOut = [1, 0.6, 0.25, 0.08];
  const fadeIn = [0.08, 0.25, 0.6, 1];

  // Never composite both endpoint poses into one raster. The outgoing pose is
  // registered onto the incoming bbox while it fades, then the incoming pose
  // fades up at that exact registration. At the low-opacity switch there is
  // only one silhouette in every frame, so wide pose changes cannot become a
  // two-character/double-exposure image.
  for (let index = 0; index < sourceFrames; index++) {
    const progress = index / Math.max(1, count - 1);
    if (index === 0) {
      frames.push(opacityFrame(from, 1, frameWidth, frameHeight));
      continue;
    }
    const opacity = sampledOpacity(fadeOut, index, sourceFrames);
    const transformed = await transformedRawFrame(from.buffer, frameWidth, frameHeight, {
      scaleX: 1 + (to.hitbox.width / Math.max(1, from.hitbox.width) - 1) * progress,
      scaleY: 1 + (to.hitbox.height / Math.max(1, from.hitbox.height) - 1) * progress,
      x: (toCenter - fromCenter) * progress,
      y: (toBottom - fromBottom) * progress,
      alpha: opacity,
    }, 0);
    frames.push(transformed.visible ? transformed : opacityFrame(from, 1, frameWidth, frameHeight));
  }
  for (let index = 0; index < targetFrames; index++) {
    const progress = (sourceFrames + index) / Math.max(1, count - 1);
    const opacity = sampledOpacity(fadeIn, index, targetFrames);
    if (index === targetFrames - 1) {
      frames.push(opacityFrame(to, 1, frameWidth, frameHeight));
      continue;
    }
    const interpolatedWidth = from.hitbox.width + (to.hitbox.width - from.hitbox.width) * progress;
    const interpolatedHeight = from.hitbox.height + (to.hitbox.height - from.hitbox.height) * progress;
    const interpolatedCenter = fromCenter + (toCenter - fromCenter) * progress;
    const interpolatedBottom = fromBottom + (toBottom - fromBottom) * progress;
    const transformed = await transformedRawFrame(to.buffer, frameWidth, frameHeight, {
      scaleX: interpolatedWidth / Math.max(1, to.hitbox.width),
      scaleY: interpolatedHeight / Math.max(1, to.hitbox.height),
      x: interpolatedCenter - toCenter,
      y: interpolatedBottom - toBottom,
      alpha: opacity,
    }, 0);
    frames.push(transformed.visible ? transformed : opacityFrame(to, 1, frameWidth, frameHeight));
  }
  return frames;
}

function definitionOrder(frameCount, definition) {
  let result;
  if (definition.range) {
    const [start, rawEnd] = definition.range;
    const end = clamped(rawEnd, 0, frameCount - 1);
    const first = clamped(start, 0, frameCount - 1);
    const step = first <= end ? 1 : -1;
    result = [];
    for (let frame = first; frame !== end + step; frame += step) result.push(frame);
  } else {
    result = Array.from({ length: frameCount }, (_, index) => index);
  }
  return definition.reverse ? result.reverse() : result;
}

function resample(values, count) {
  if (values.length === count) return values.slice();
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  return Array.from({ length: count }, (_, index) => values[Math.round(index * (values.length - 1) / (count - 1))]);
}

async function pngFiles(directory) {
  return (await fs.readdir(directory)).filter((file) => file.endsWith('.png')).sort().map((file) => path.join(directory, file));
}

async function uniquePixelFrameCount(files, stopAt = Infinity) {
  const unique = [];
  for (const file of files) {
    const pixels = await sharp(file).ensureAlpha().raw().toBuffer();
    if (!unique.some((candidate) => candidate.equals(pixels))) unique.push(pixels);
    if (unique.length >= stopAt) break;
  }
  return unique.length;
}

async function mostVisibleFile(files) {
  let selected = files[0];
  let maximumVisible = -1;
  for (const file of files) {
    const pixels = await sharp(file).ensureAlpha().raw().toBuffer();
    let visible = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) visible += Number(pixels[offset] !== 0);
    if (visible > maximumVisible) {
      maximumVisible = visible;
      selected = file;
    }
  }
  return selected;
}

function sameVisualDefinition(a, b, sourceCounts) {
  if (!a || !b || a.source !== b.source) return false;
  return JSON.stringify(definitionOrder(sourceCounts[a.source], a)) === JSON.stringify(definitionOrder(sourceCounts[b.source], b));
}

function phases(count, callback) {
  return Array.from({ length: count }, (_, index) => callback(index / Math.max(1, count - 1), index));
}

async function writeRawPng(file, frame, width, height) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(frame.buffer, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(file);
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

export async function deriveStandaloneMotion({
  root,
  character,
  variant,
  cleanedDir,
  runtimeDir,
  frameWidth,
  frameHeight,
  animationDefinitions,
}) {
  const identity = `${character}/${variant}`;
  const generatedDir = path.join(root, 'standalone/assets/generated', character, variant);
  const sourceFiles = {};
  const sourceCounts = {};
  for (const definition of Object.values(animationDefinitions)) {
    if (sourceFiles[definition.source]) continue;
    sourceFiles[definition.source] = await pngFiles(path.join(cleanedDir, definition.source));
    sourceCounts[definition.source] = sourceFiles[definition.source].length;
  }
  const filesFor = (definition) => definitionOrder(sourceCounts[definition.source], definition)
    .map((index) => sourceFiles[definition.source][index]);
  const sequences = [];
  const add = (state, definition, files, transforms, metadata = {}) => sequences.push({
    state,
    source: definition.source,
    files: resample(files, transforms.length),
    transforms,
    ...metadata,
  });
  const addBridge = (state, definition, targetDefinition, metadata = {}) => sequences.push({
    state,
    source: definition.source,
    files: [],
    transforms: [],
    bridge: {
      from: filesFor(definition).at(-1),
      to: filesFor(targetDefinition)[0],
      count: metadata.bridge_frames || 8,
      fromSequence: metadata.bridge_from_sequence || null,
      fromEndpoint: metadata.bridge_from_endpoint || 'last',
      toSequence: metadata.bridge_to_sequence || null,
      toEndpoint: metadata.bridge_to_endpoint || 'first',
    },
    ...metadata,
  });
  const addCopy = (state, definition, metadata = {}) => {
    const files = filesFor(definition);
    add(state, definition, files, files.map(() => ({})), metadata);
  };

  const moveDefinition = animationDefinitions['walk-right'];
  const moveFiles = filesFor(moveDefinition);
  const moveUniqueFrames = await uniquePixelFrameCount(moveFiles, 3);
  if (moveUniqueFrames < 3) {
    add('walk', moveDefinition, moveFiles, [
      { x: -1, y: 0, scaleX: 1.0, scaleY: 1.0 },
      { x: 0, y: -1, scaleX: 1.01, scaleY: 0.99 },
      { x: 1, y: -3, scaleX: 1.02, scaleY: 0.98 },
      { x: 2, y: -2, scaleX: 1.01, scaleY: 0.99 },
      { x: 1, y: 0, scaleX: 1.0, scaleY: 1.0 },
      { x: 0, y: -1, scaleX: 0.99, scaleY: 1.01 },
      { x: -1, y: -2, scaleX: 0.98, scaleY: 1.02 },
      { x: -2, y: -1, scaleX: 0.99, scaleY: 1.01 },
    ], {
      operation: 'sparse-source-eight-phase-walk-bob',
      intent: 'walk',
      source_unique_frames: moveUniqueFrames,
    });
  }
  const runFrameCount = 8;
  add('run', moveDefinition, moveFiles, phases(runFrameCount, (_progress, index) => {
    const angle = index * Math.PI * 2 / runFrameCount;
    return {
      scaleX: 1.025 + Math.cos(angle) * 0.008,
      scaleY: 0.975 - Math.cos(angle) * 0.008,
      x: 2 + Math.round(Math.sin(angle) * 2),
      y: -Math.round((1 - Math.cos(angle * 2)) * 2),
      brightness: 1.02,
    };
  }), { operation: 'forward-lean-and-stride-bob', intent: 'run' });

  const poseDefinition = animationDefinitions['picked-up'];
  const poseFiles = filesFor(poseDefinition);
  const stablePoseFrame = await mostVisibleFile(poseFiles);
  add('picked-up', poseDefinition, [stablePoseFrame], phases(6, (progress) => ({
    scaleX: 1 - 0.025 * progress,
    scaleY: 1 - 0.025 * progress,
    x: Math.round(Math.sin(progress * Math.PI) * 2),
    y: -Math.round(progress * 8),
  })), { operation: 'lift-with-inertial-sway', intent: 'grabbed' });
  add('dragging', poseDefinition, [stablePoseFrame], phases(6, (progress, index) => ({
    scaleX: 0.975,
    scaleY: 0.975,
    x: [-3, -1, 2, 3, 1, -2][index],
    y: -8 + [0, -1, 0, 1, 0, -1][index],
  })), { operation: 'suspended-sway-loop', intent: 'dragging' });
  add('dropped-motion', poseDefinition, [stablePoseFrame], [
    { scaleX: 0.975, scaleY: 0.975, x: -2, y: -8 },
    { scaleX: 0.98, scaleY: 0.98, x: -1, y: -6 },
    { scaleX: 0.99, scaleY: 0.99, x: 0, y: -3 },
    { scaleX: 1.0, scaleY: 1.0, x: 1, y: 0 },
    { scaleX: 1.045, scaleY: 0.91, x: 0, y: 3 },
    { scaleX: 0.985, scaleY: 1.025, x: 0, y: -1 },
    { scaleX: 1.01, scaleY: 0.985, x: 0, y: 1 },
    { scaleX: 1.0, scaleY: 1.0, x: 0, y: 0 },
  ], { operation: 'fall-impact-squash-recovery', intent: 'landing' });
  addBridge('dropped-settle', animationDefinitions.dropped, animationDefinitions.idle, {
    operation: 'landing-to-idle-registration-bridge',
    intent: 'dropped',
    bridge_frames: 8,
    bridge_from_sequence: 'dropped-motion',
  });

  const specialDefinition = animationDefinitions.special;
  const derivedSpecialFallback = sameVisualDefinition(animationDefinitions.clicked, animationDefinitions.special, sourceCounts);
  if (derivedSpecialFallback) {
    const specialFiles = filesFor(specialDefinition);
    add('special-motion', specialDefinition, specialFiles, phases(Math.max(6, Math.min(8, specialFiles.length)), (progress, index) => ({
      scaleX: 1 + 0.025 * Math.sin(progress * Math.PI),
      scaleY: 1 + 0.025 * Math.sin(progress * Math.PI),
      x: [0, -2, 2, -1, 1, 0, -1, 0][index] ?? 0,
      y: -Math.round(2 * Math.sin(progress * Math.PI)),
      brightness: 1 + 0.08 * Math.sin(progress * Math.PI),
    })), { operation: 'character-local-emphasis-pulse', intent: 'special' });
  } else {
    addCopy('special-source', specialDefinition, {
      operation: 'physical-special-runtime-copy',
      intent: 'special',
    });
  }
  addBridge('special-settle', specialDefinition, animationDefinitions.idle, {
    operation: 'special-to-idle-registration-bridge',
    intent: 'special',
    bridge_frames: 8,
    bridge_from_sequence: derivedSpecialFallback ? 'special-motion' : 'special-source',
  });

  const lowMotion = LOW_MOTION_VARIANTS.has(identity);
  let derivedSleepState = null;
  let derivedWakeState = null;
  if (lowMotion) {
    const restDefinition = animationDefinitions.rest;
    const restFiles = filesFor(restDefinition);
    const powerDownTransforms = [0, 0.2, 0.4, 0.6, 0.8, 1].map((progress) => ({
      scaleX: 1 + 0.035 * progress,
      scaleY: 1 - 0.18 * progress,
      y: Math.round(7 * progress),
      brightness: 1 - 0.38 * progress,
    }));
    add('rest', restDefinition, restFiles, powerDownTransforms, {
      operation: 'power-down-lower-and-dim',
      intent: 'power-down',
      opticalMidpoint: true,
    });
    add('sleep', restDefinition, [restFiles.at(-1)], phases(8, (_progress, index) => {
      const pulse = Math.sin(index * Math.PI * 2 / 8);
      return {
        scaleX: 1.035 + pulse * 0.004,
        scaleY: 0.82 + pulse * 0.006,
        y: 7 - Math.round(Math.max(0, pulse)),
        brightness: 0.62 + pulse * 0.025,
      };
    }), { operation: 'powered-down-status-pulse-loop', intent: 'sleep-standby' });
    derivedSleepState = 'sleep';
    derivedWakeState = 'rest';
    addBridge('rest-settle', restDefinition, restDefinition, {
      operation: 'power-down-to-standby-registration-bridge',
      intent: 'rest',
      bridge_frames: 8,
      bridge_from_sequence: 'rest',
      bridge_to_sequence: 'sleep',
    });
    addBridge('wake-settle', restDefinition, animationDefinitions.idle, {
      operation: 'power-up-to-idle-registration-bridge',
      intent: 'wake',
      bridge_frames: 8,
      bridge_from_sequence: 'rest',
      bridge_from_endpoint: 'first',
    });
  } else {
    const sleepDefinition = animationDefinitions.sleep;
    const sleepFiles = filesFor(sleepDefinition);
    const sleepUniqueFrames = await uniquePixelFrameCount(sleepFiles, 3);
    if (sleepUniqueFrames < 3) {
      const restingFrame = await mostVisibleFile(sleepFiles);
      const sleepFrameCount = 8;
      add('sleep-continuous', sleepDefinition, [restingFrame], phases(sleepFrameCount, (_progress, index) => {
        const angle = index * Math.PI * 2 / sleepFrameCount;
        return {
          scaleX: 1 + Math.cos(angle) * 0.006,
          scaleY: 1 + Math.sin(angle) * 0.01,
          x: Math.round(Math.sin(angle)),
          y: -Math.round(Math.max(0, Math.sin(angle))),
          brightness: 0.985 + Math.cos(angle) * 0.025,
        };
      }), {
        operation: 'sparse-source-sleep-breath-loop',
        intent: 'sleep',
        source_unique_frames: sleepUniqueFrames,
      });
      derivedSleepState = 'sleep-continuous';
      add('wake-transition', sleepDefinition, sleepFiles.slice().reverse(), phases(8, (progress, index) => ({
        scaleX: 0.98 + 0.02 * progress,
        scaleY: 0.96 + 0.04 * progress,
        x: Math.round(Math.sin(index * Math.PI / 4)),
        y: Math.round(3 * (1 - progress)),
        brightness: 0.92 + 0.08 * progress,
      })), {
        operation: 'sparse-source-eight-phase-wake-rise',
        intent: 'wake',
        source_unique_frames: sleepUniqueFrames,
      });
      derivedWakeState = 'wake-transition';
    }
  }
  if (!lowMotion) {
    addCopy('rest-source', animationDefinitions.rest, {
      operation: 'physical-rest-runtime-copy',
      intent: 'rest',
    });
    addBridge('rest-settle', animationDefinitions.rest, animationDefinitions.sleep, {
      operation: 'rest-to-sleep-registration-bridge',
      intent: 'rest',
      bridge_frames: 8,
      bridge_from_sequence: 'rest-source',
      bridge_to_sequence: derivedSleepState,
    });
    if (!derivedWakeState) {
      addCopy('wake-source', animationDefinitions.wake, {
        operation: 'physical-wake-runtime-copy',
        intent: 'wake',
      });
    }
    addBridge('wake-settle', animationDefinitions.wake, animationDefinitions.idle, {
      operation: 'wake-to-idle-registration-bridge',
      intent: 'wake',
      bridge_frames: 8,
      bridge_from_sequence: derivedWakeState || 'wake-source',
    });
  }

  // Exit is optional and only a handful of source sets expose it. Preserve the
  // complete variant-local physical animation, then bring its actual last
  // frame back to the same variant's idle registration. This is deliberately
  // represented as pixels in the derived atlas: `next: idle` must not hide a
  // pose/position teleport at the state boundary.
  if (animationDefinitions.exit) {
    addCopy('exit-source', animationDefinitions.exit, {
      operation: 'physical-exit-runtime-copy',
      intent: 'exit',
    });
    addBridge('exit-settle', animationDefinitions.exit, animationDefinitions.idle, {
      operation: 'exit-to-idle-registration-bridge',
      intent: 'exit',
      bridge_frames: 8,
      bridge_from_sequence: 'exit-source',
    });
  }

  const frames = [];
  const sequenceMetadata = [];
  const sequenceFrames = new Map();
  for (const sequence of sequences) {
    const start = frames.length;
    let produced = [];
    if (sequence.bridge) {
      const fromFrames = sequence.bridge.fromSequence ? sequenceFrames.get(sequence.bridge.fromSequence) : null;
      const toFrames = sequence.bridge.toSequence ? sequenceFrames.get(sequence.bridge.toSequence) : null;
      if (sequence.bridge.fromSequence && !fromFrames) {
        throw new Error(`${identity}:${sequence.state}: bridge source sequence ${sequence.bridge.fromSequence} is unavailable`);
      }
      if (sequence.bridge.toSequence && !toFrames) {
        throw new Error(`${identity}:${sequence.state}: bridge target sequence ${sequence.bridge.toSequence} is unavailable`);
      }
      const from = fromFrames
        ? fromFrames[sequence.bridge.fromEndpoint === 'first' ? 0 : fromFrames.length - 1]
        : await rawFrame(sequence.bridge.from, frameWidth, frameHeight);
      const to = toFrames
        ? toFrames[sequence.bridge.toEndpoint === 'last' ? toFrames.length - 1 : 0]
        : await rawFrame(sequence.bridge.to, frameWidth, frameHeight);
      produced = await transitionBridge(from, to, frameWidth, frameHeight, sequence.bridge.count);
    }
    for (let index = 0; index < sequence.transforms.length; index++) {
      let frame = await transformedFrame(sequence.files[index], frameWidth, frameHeight, sequence.transforms[index]);
      if (!frame.visible) {
        const alternatives = sequence.files
          .map((file, candidate) => ({ file, distance: Math.abs(candidate - index) }))
          .sort((a, b) => a.distance - b.distance);
        for (const alternative of alternatives) {
          frame = await transformedFrame(alternative.file, frameWidth, frameHeight, sequence.transforms[index]);
          if (frame.visible) break;
        }
      }
      if (!frame.visible) throw new Error(`${identity}:${sequence.state}: source sequence is fully transparent`);
      produced.push(frame);
    }
    let generatedFrame = null;
    if (sequence.opticalMidpoint) {
      const powerDownDir = path.join(generatedDir, 'power-down');
      const sourceA = path.join(powerDownDir, 'source-a.png');
      const sourceB = path.join(powerDownDir, 'source-b.png');
      generatedFrame = path.join(powerDownDir, 'optical-midpoint.png');
      await Promise.all([
        writeRawPng(sourceA, produced[2], frameWidth, frameHeight),
        writeRawPng(sourceB, produced[3], frameWidth, frameHeight),
      ]);
      await run(process.execPath, [
        path.join(root, 'shared/image-processing/interpolate-frame.mjs'),
        sourceA,
        sourceB,
        generatedFrame,
      ]);
      const midpoint = await sharp(generatedFrame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      cleanTransparentRgb(midpoint.data);
      produced.splice(3, 0, {
        buffer: midpoint.data,
        hitbox: alphaBounds(midpoint.data, frameWidth, frameHeight),
        generatedFrame,
      });
    }
    sequenceFrames.set(sequence.state, produced);
    frames.push(...produced);
    const indexes = Array.from({ length: produced.length }, (_, index) => start + index);
    sequenceMetadata.push({
      id: `${sequence.state}-${sequence.intent}`,
      state: sequence.state,
      intent: sequence.intent,
      origin: generatedFrame ? 'generated' : 'derived',
      operation: sequence.operation,
      source_animation: sequence.source,
      source_unique_frames: sequence.source_unique_frames ?? null,
      source_frames: sequence.files.map((file) => relative(root, file)),
      atlas_frames: indexes,
      generated_frame: generatedFrame ? relative(root, generatedFrame) : null,
      bridge_style: sequence.bridge ? 'single-silhouette-endpoint-transform' : null,
      bridge_frames: sequence.bridge?.count ?? null,
    });
  }

  const columns = Math.min(MAX_COLUMNS, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const atlas = path.join(generatedDir, 'motion-atlas.png');
  await fs.mkdir(generatedDir, { recursive: true });
  await sharp({
    create: {
      width: columns * frameWidth,
      height: rows * frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(frames.map((frame, index) => ({
    input: frame.buffer,
    raw: { width: frameWidth, height: frameHeight, channels: 4 },
    left: (index % columns) * frameWidth,
    top: Math.floor(index / columns) * frameHeight,
  }))).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(atlas);
  await fs.copyFile(atlas, path.join(runtimeDir, 'derived-motion.png'));

  const source = {
    sheet: 'derived-motion.png',
    frames: frames.length,
    sourceFrames: 0,
    generatedFrames: frames.filter((frame) => frame.generatedFrame).length,
    columns,
    rows,
    hitboxes: frames.map((frame) => ({
      x: frame.hitbox.x,
      y: frame.hitbox.y,
      width: frame.hitbox.width,
      height: frame.hitbox.height,
    })),
    origin: lowMotion ? 'generated' : 'derived',
    generatedAsset: relative(root, atlas),
  };
  const animations = {};
  const appendSequence = (state, metadata, { prepend = false } = {}) => {
    const existing = animations[state];
    if (!existing) return false;
    const combined = prepend
      ? [...metadata.atlas_frames, ...existing.frameOrder]
      : [...existing.frameOrder, ...metadata.atlas_frames];
    animations[state] = {
      ...existing,
      source: 'derived-motion',
      sheet: 'derived-motion.png',
      frameOrder: combined,
      origin: existing.origin === 'generated' ? 'generated' : 'derived',
      provenanceId: metadata.id,
      transitionFromProvenanceId: existing.provenanceId,
      transitionBridge: metadata.id,
    };
    return true;
  };
  for (const metadata of sequenceMetadata) {
    const common = {
      source: 'derived-motion',
      sheet: 'derived-motion.png',
      frameOrder: metadata.atlas_frames,
      mirror: false,
      holdLast: false,
      generatedFrames: metadata.generated_frame
        ? [metadata.atlas_frames[Math.floor(metadata.atlas_frames.length / 2)]]
        : [],
      origin: metadata.origin,
      provenanceId: metadata.id,
      generatedSequence: metadata.generated_frame ? `${identity}:power-down-midpoint` : null,
    };
    if (metadata.state === 'walk') {
      animations['walk-left'] = { ...common, fps: 12, loop: true, mirror: true, next: null };
      animations['walk-right'] = { ...common, fps: 12, loop: true, next: null };
    } else if (metadata.state === 'run') {
      animations['run-left'] = { ...common, fps: 18, loop: true, mirror: true, next: null };
      animations['run-right'] = { ...common, fps: 18, loop: true, next: null };
    } else if (metadata.state === 'picked-up') {
      animations['picked-up'] = { ...common, fps: 12, loop: false, next: 'dragging' };
    } else if (metadata.state === 'dragging') {
      animations.dragging = { ...common, fps: 8, loop: true, next: null };
    } else if (metadata.state === 'dropped-motion') {
      animations.dropped = { ...common, fps: 14, loop: false, next: 'idle' };
    } else if (metadata.state === 'dropped-settle') {
      appendSequence('dropped', metadata);
    } else if (metadata.state === 'special-motion') {
      animations.special = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'special-source') {
      animations.special = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'special-settle') {
      if (!appendSequence('special', metadata)) animations.special = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'rest') {
      animations.rest = { ...common, fps: 8, loop: false, holdLast: true, next: 'sleep' };
      if (metadata.generated_frame) animations.wake = {
        ...common,
        frameOrder: metadata.atlas_frames.slice().reverse(),
        fps: 12,
        loop: false,
        next: 'idle',
        provenanceId: `${metadata.id}-reverse-wake`,
        intentionalReverseOf: 'rest',
      };
    } else if (metadata.state === 'sleep') {
      animations.sleep = { ...common, fps: 8, loop: true, next: null };
    } else if (metadata.state === 'sleep-continuous') {
      animations.sleep = { ...common, fps: 8, loop: true, next: null };
    } else if (metadata.state === 'wake-transition') {
      animations.wake = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'rest-source') {
      animations.rest = { ...common, fps: 8, loop: false, holdLast: true, next: 'sleep' };
    } else if (metadata.state === 'rest-settle') {
      appendSequence('rest', metadata);
    } else if (metadata.state === 'wake-source') {
      animations.wake = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'wake-settle') {
      appendSequence('wake', metadata);
    } else if (metadata.state === 'exit-source') {
      animations.exit = { ...common, fps: 12, loop: false, next: 'idle' };
    } else if (metadata.state === 'exit-settle') {
      appendSequence('exit', metadata);
    }
  }
  const generatedProvenance = [];
  const powerDown = sequenceMetadata.find((sequence) => sequence.generated_frame);
  if (powerDown) {
    const frame = powerDown.atlas_frames[Math.floor(powerDown.atlas_frames.length / 2)];
    generatedProvenance.push({
      source: 'derived-motion',
      frame,
      file: powerDown.generated_frame,
      sequence: 'power-down-midpoint',
      states: ['rest', 'wake'],
    });
  }
  const motionManifest = {
    schema_version: 1,
    character,
    variant,
    frame_size: { width: frameWidth, height: frameHeight },
    atlas: relative(root, atlas),
    atlas_columns: columns,
    atlas_rows: rows,
    profile: lowMotion ? 'non-human-power-down' : 'character-local-desktop-motion',
    sequences: sequenceMetadata,
  };
  await fs.writeFile(path.join(generatedDir, 'motion-manifest.json'), `${JSON.stringify(motionManifest, null, 2)}\n`);
  return {
    source,
    animations,
    provenance: {
      derivedAnimations: sequenceMetadata,
      generatedFrames: generatedProvenance,
    },
    lowMotion,
  };
}

export { LOW_MOTION_VARIANTS };
