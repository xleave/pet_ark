#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { rasterizeTexturedTriangles } from '../image-processing/triangle-rasterizer.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROSTER_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-roster.json');
const INTENTIONAL_BLANKS_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-intentional-blanks.json');
const RENDER_REVISION = 3;
const BLANK_POLICY_REVISION = 1;
const PLACEMENT_REVISION = 3;
const CORE_PLACEMENT_ANIMATIONS = new Set(['default', 'idle', 'relax', 'move', 'run', 'sit', 'sleep']);
const roster = JSON.parse(await fs.readFile(ROSTER_PATH, 'utf8'));
const intentionalBlanks = JSON.parse(await fs.readFile(INTENTIONAL_BLANKS_PATH, 'utf8'));
const args = process.argv.slice(2);

function argument(name, fallback = null) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positiveInteger(name, fallback, maximum) {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function matchingVariant(character, selector) {
  if (!selector) return character.variants.find((variant) => variant.variant_id === character.default_variant_id);
  const lowered = selector.toLocaleLowerCase();
  return character.variants.find((variant) => [
    variant.variant_id,
    variant.id,
    variant.skin_id,
    variant.skin_name,
    variant.name,
  ].filter(Boolean).some((value) => String(value).toLocaleLowerCase() === lowered));
}

function selectedJobs() {
  const all = args.includes('--all');
  const characterId = argument('--character', all ? null : 'amiya');
  const selector = argument('--variant', argument('--skin'));
  const characters = characterId
    ? roster.characters.filter((character) => character.character_id === characterId)
    : roster.characters;
  if (!characters.length) throw new Error(`Unknown standalone character: ${characterId}`);

  const jobs = [];
  for (const character of characters) {
    const variants = all && !selector
      ? character.variants
      : [matchingVariant(character, selector)].filter(Boolean);
    if (!variants.length && characterId) {
      throw new Error(`Unknown standalone variant for ${character.character_id}: ${selector}`);
    }
    for (const variant of variants) {
      if (variant.status !== 'source-available') continue;
      jobs.push({ character, variant });
    }
  }
  if (!jobs.length) throw new Error('No source-available standalone variants matched the selection');
  return jobs;
}

async function mapBounded(values, concurrency, work) {
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        await work(values[index], index);
      } catch (error) {
        failures.push({ value: values[index], error });
        console.error(`FAILED ${values[index].character.character_id}/${values[index].variant.variant_id}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return failures;
}

async function removeVariantPartials({ character, variant }) {
  const outputDir = path.join(
    REPO_ROOT,
    'standalone/assets/cleaned',
    character.character_id,
    variant.variant_id,
  );
  let entries;
  try {
    entries = await fs.readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.includes('.partial-'))
    .map((entry) => fs.rm(path.join(outputDir, entry.name), { recursive: true, force: true })));
}

function workerArguments(job, config, attempt) {
  const childArgs = [
    fileURLToPath(import.meta.url),
    '--worker',
    '--character', characterId(job),
    '--variant', job.variant.variant_id,
    '--width', String(config.width),
    '--height', String(config.height),
    '--fps', String(config.fps),
    '--max-frames', String(config.maxFrames),
  ];
  const animation = argument('--animation');
  if (animation) childArgs.push('--animation', animation);
  if (args.includes('--inspect')) childArgs.push('--inspect');
  // A retry resumes already completed atomic animation directories.
  if (attempt === 1 && args.includes('--force')) childArgs.push('--force');
  return childArgs;
}

function characterId(job) {
  return job.character.character_id;
}

function intentionalBlankFrames(character, variant, state) {
  return intentionalBlanks.declarations.find((entry) =>
    entry.character === character && entry.variant === variant && entry.state === state)?.frames || [];
}

function hasVisibleAlpha(data) {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 0) return true;
  }
  return false;
}

function spawnWorker(job, config, attempt, children) {
  return new Promise((resolve, reject) => {
    const label = `${characterId(job)}/${job.variant.variant_id}`;
    const child = spawn(process.execPath, workerArguments(job, config, attempt), {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        UV_THREADPOOL_SIZE: '1',
        VIPS_CONCURRENCY: '1',
      },
    });
    children.add(child);
    child.once('error', (error) => {
      children.delete(child);
      reject(new Error(`${label} worker could not start: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${label} worker exited ${signal ? `on ${signal}` : `with code ${code}`}`));
    });
  });
}

async function supervise(jobs, config, concurrency) {
  const retries = positiveInteger('--retries', 2, 5);
  const children = new Set();
  const failures = [];
  let cursor = 0;
  let completed = 0;

  const stopChildren = (signal) => {
    for (const child of children) child.kill(signal);
  };
  const onInterrupt = () => stopChildren('SIGTERM');
  const onTerminate = () => stopChildren('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  async function supervisorWorker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const label = `${characterId(job)}/${job.variant.variant_id}`;
      let lastError;
      await removeVariantPartials(job);
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
          console.log(`[worker ${attempt}/${retries + 1}] ${label}`);
          await spawnWorker(job, config, attempt, children);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await removeVariantPartials(job);
          console.error(`worker failure ${attempt}/${retries + 1}: ${error.message}`);
        }
      }
      if (lastError) failures.push({
        character: characterId(job),
        variant: job.variant.variant_id,
        reason: lastError.message,
      });
      completed++;
      console.log(`supervisor progress ${completed}/${jobs.length}, failures=${failures.length}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, supervisorWorker));
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);

  const reportPath = path.join(REPO_ROOT, '.cache/prts-spine/last-export-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    requested_variants: jobs.length,
    completed_variants: jobs.length - failures.length,
    failed_variants: failures.length,
    concurrency,
    retries,
    failures,
  }, null, 2)}\n`);
  return failures;
}

async function discoverRuntimeMap(discoveryUrl) {
  const pageResponse = await fetch(discoveryUrl);
  if (!pageResponse.ok) {
    throw new Error(`${pageResponse.status} ${pageResponse.statusText}: ${discoveryUrl}`);
  }
  const html = await pageResponse.text();
  const scriptUrl = html.match(/https:\/\/static\.prts\.wiki\/widgets\/production\/SpineViewer\.[a-zA-Z0-9_-]+\.js/)?.[0];
  if (!scriptUrl) throw new Error(`PRTS page does not advertise a SpineViewer runtime: ${discoveryUrl}`);
  const scriptResponse = await fetch(scriptUrl);
  if (!scriptResponse.ok) {
    throw new Error(`${scriptResponse.status} ${scriptResponse.statusText}: ${scriptUrl}`);
  }
  const script = await scriptResponse.text();
  const advertisedMap = script.match(/sourceMappingURL=(https:\/\/static\.prts\.wiki\/widgets\/production\/SpineViewer\.[a-zA-Z0-9_-]+\.js\.map)/)?.[1];
  return advertisedMap ?? `${scriptUrl}.map`;
}

async function loadPrtsRuntime(discoveryUrl) {
  const cacheDir = path.join(REPO_ROOT, '.cache', 'prts-spine');
  const runtimePath = path.join(cacheDir, 'spine-webgl.mjs');
  try {
    await fs.access(runtimePath);
  } catch {
    const runtimeMapUrl = await discoverRuntimeMap(discoveryUrl);
    const response = await fetch(runtimeMapUrl);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${runtimeMapUrl}`);
    const sourceMap = await response.json();
    const index = sourceMap.sources.findIndex((source) => source.endsWith('/spine-webgl.js'));
    if (index < 0 || !sourceMap.sourcesContent[index]) {
      throw new Error('PRTS source map does not contain spine-webgl.js');
    }
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(runtimePath, sourceMap.sourcesContent[index]);
  }
  return (await import(`${pathToFileURL(runtimePath).href}?v=2`)).default;
}

const rounded = (value) => Number(value.toFixed(5));

function geometryForAttachment(spine, slot, attachment) {
  let vertices;
  let uvs;
  let triangles;
  if (attachment instanceof spine.RegionAttachment) {
    vertices = new Float32Array(8);
    attachment.computeWorldVertices(slot.bone, vertices, 0, 2);
    uvs = attachment.uvs;
    triangles = [0, 1, 2, 2, 3, 0];
  } else if (attachment instanceof spine.MeshAttachment) {
    vertices = new Float32Array(attachment.worldVerticesLength);
    attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2);
    uvs = attachment.uvs;
    triangles = attachment.triangles;
  } else {
    return null;
  }
  return { vertices, uvs, triangles };
}

function visibleGeometry(spine, skeleton) {
  const geometries = [];
  for (const slot of skeleton.drawOrder) {
    const attachment = slot.getAttachment();
    if (!attachment || slot.color.a <= 0.001) continue;
    const geometry = geometryForAttachment(spine, slot, attachment);
    if (geometry) geometries.push({ slot, attachment, ...geometry });
  }
  return geometries;
}

function extendBounds(bounds, geometries) {
  for (const { vertices } of geometries) {
    for (let index = 0; index < vertices.length; index += 2) {
      const x = vertices[index];
      const y = vertices[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
}

function emptyBounds() {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

function validBounds(bounds) {
  return Object.values(bounds).every(Number.isFinite);
}

function geometryBounds(geometry) {
  const bounds = emptyBounds();
  extendBounds(bounds, [geometry]);
  return bounds;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clusteredGeometryBounds(geometries) {
  const records = geometries.map((geometry) => {
    const bounds = geometryBounds(geometry);
    return {
      geometry,
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
    };
  }).filter((record) => Number.isFinite(record.centerX) && Number.isFinite(record.centerY));
  if (!records.length) return { bounds: emptyBounds(), retained: 0, total: 0 };
  const centerX = median(records.map((record) => record.centerX));
  const centerY = median(records.map((record) => record.centerY));
  const deviationX = median(records.map((record) => Math.abs(record.centerX - centerX)));
  const deviationY = median(records.map((record) => Math.abs(record.centerY - centerY)));
  const radiusX = Math.max(256, deviationX * 8);
  const radiusY = Math.max(384, deviationY * 8);
  const retained = records.filter((record) =>
    Math.abs(record.centerX - centerX) <= radiusX
    && Math.abs(record.centerY - centerY) <= radiusY);
  const bounds = emptyBounds();
  extendBounds(bounds, retained.map((record) => record.geometry));
  return { bounds, retained: retained.length, total: records.length, centerX, centerY, radiusX, radiusY };
}

function anchoredGeometryBounds(geometries, anchor) {
  const radiusX = Math.max(256, anchor.radiusX * 1.25);
  const radiusY = Math.max(384, anchor.radiusY * 1.25);
  const retained = geometries.filter((geometry) => {
    const bounds = geometryBounds(geometry);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return Number.isFinite(centerX) && Number.isFinite(centerY)
      && Math.abs(centerX - anchor.centerX) <= radiusX
      && Math.abs(centerY - anchor.centerY) <= radiusY;
  });
  const bounds = emptyBounds();
  extendBounds(bounds, retained);
  return {
    bounds,
    retained: retained.length,
    total: geometries.length,
    centerX: anchor.centerX,
    centerY: anchor.centerY,
    radiusX,
    radiusY,
  };
}

function applyAnimation(skeleton, state, animationName, time) {
  skeleton.setToSetupPose();
  state.clearTracks();
  if (animationName) {
    state.setAnimation(0, animationName, false);
    state.update(time);
    state.apply(skeleton);
  }
  skeleton.updateWorldTransform();
}

function measureSkeleton(spine, skeletonData, config) {
  const skeleton = new spine.Skeleton(skeletonData);
  const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
  const fullBounds = emptyBounds();
  const coreGeometry = [];
  applyAnimation(skeleton, state, null, 0);
  const setupGeometry = visibleGeometry(spine, skeleton);
  const setupCluster = clusteredGeometryBounds(setupGeometry);
  extendBounds(fullBounds, setupGeometry);
  coreGeometry.push(...setupGeometry);
  for (const animation of skeletonData.animations) {
    const contributesToCore = CORE_PLACEMENT_ANIMATIONS.has(safeAnimationName(animation.name));
    const frameCount = animation.duration === 0
      ? 1
      : Math.max(2, Math.min(config.maxFrames, Math.ceil(animation.duration * config.fps)));
    for (let frame = 0; frame < frameCount; frame++) {
      const time = frameCount === 1 ? 0 : animation.duration * frame / frameCount;
      applyAnimation(skeleton, state, animation.name, time);
      const geometry = visibleGeometry(spine, skeleton);
      extendBounds(fullBounds, geometry);
      if (contributesToCore) coreGeometry.push(...geometry);
    }
  }
  if (!validBounds(fullBounds)) {
    const fallback = { minX: -160, maxX: 160, minY: 0, maxY: 480 };
    return { bounds: fallback, fullBounds: fallback, policy: 'fallback' };
  }
  const cluster = validBounds(setupCluster.bounds)
    ? anchoredGeometryBounds(coreGeometry, setupCluster)
    : clusteredGeometryBounds(coreGeometry);
  const coreBounds = cluster.bounds;
  if (!validBounds(coreBounds)) {
    return { bounds: fullBounds, fullBounds, policy: 'full-animation-envelope' };
  }
  const fullScale = renderTransform(fullBounds, config.width, config.height).scale;
  const coreScale = renderTransform(coreBounds, config.width, config.height).scale;
  const useCoreBounds = fullScale < coreScale * 0.78;
  return {
    bounds: useCoreBounds ? coreBounds : fullBounds,
    fullBounds,
    coreBounds,
    cluster: {
      retained: cluster.retained,
      total: cluster.total,
      centerX: rounded(cluster.centerX),
      centerY: rounded(cluster.centerY),
      radiusX: rounded(cluster.radiusX),
      radiusY: rounded(cluster.radiusY),
    },
    policy: useCoreBounds ? 'core-character-envelope' : 'full-animation-envelope',
  };
}

function renderTransform(bounds, width, height) {
  const padding = Math.max(8, Math.round(Math.min(width, height) * 0.035));
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fitScale = Math.min(
    (width - padding * 2) / sourceWidth,
    (height - padding * 2) / sourceHeight,
  );
  const naturalScale = Math.min(width / 384, height / 448) * 0.82;
  const scale = Math.min(naturalScale, fitScale);
  return {
    scale,
    xOffset: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale,
    yOffset: height - padding + bounds.minY * scale,
    padding,
  };
}

function visiblePixelBounds(data, width, height) {
  const bounds = { minX: width, maxX: -1, minY: height, maxY: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return null;
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
  };
}

function densityCorrectedTransform(spine, skeletonData, texturePages, transform, config) {
  const probeAnimation = skeletonData.animations.find((animation) => safeAnimationName(animation.name) === 'relax')
    ?? skeletonData.animations.find((animation) => safeAnimationName(animation.name) === 'default')
    ?? skeletonData.animations.find((animation) => safeAnimationName(animation.name) === 'sit')
    ?? skeletonData.animations[0];
  if (!probeAnimation) return { transform, probe: null };
  const skeleton = new spine.Skeleton(skeletonData);
  const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
  applyAnimation(skeleton, state, probeAnimation.name, 0);
  const layers = renderFrameLayers(spine, skeleton, texturePages, transform);
  const { data } = rasterizeTexturedTriangles({
    width: config.width,
    height: config.height,
    layers,
    sampleGrid: 2,
  });
  const visible = visiblePixelBounds(data, config.width, config.height);
  if (!visible) return { transform, probe: { animation: probeAnimation.name, transparent: true } };
  const desiredWidth = config.width * 0.375;
  const desiredHeight = config.height * 0.625;
  const naturalScale = Math.min(config.width / 384, config.height / 448) * 0.82;
  const requestedZoom = Math.max(1, desiredWidth / visible.width, desiredHeight / visible.height);
  const maximumZoom = Math.min(
    (config.width - 16) / visible.width,
    (config.height - 16) / visible.height,
    naturalScale / transform.scale,
  );
  const zoom = Math.min(requestedZoom, maximumZoom);
  const probe = {
    animation: probeAnimation.name,
    visible_width: visible.width,
    visible_height: visible.height,
    density_zoom: rounded(zoom),
  };
  if (!(zoom >= 1.2)) return { transform, probe };
  const centerX = (visible.minX + visible.maxX) / 2;
  const bottom = visible.maxY;
  return {
    transform: {
      ...transform,
      scale: transform.scale * zoom,
      xOffset: config.width / 2 - (centerX - transform.xOffset) * zoom,
      yOffset: config.height - transform.padding + (transform.yOffset - bottom) * zoom,
    },
    probe,
  };
}

function renderFrameLayers(spine, skeleton, texturePages, transform) {
  const project = (x, y) => [
    transform.xOffset + x * transform.scale,
    transform.yOffset - y * transform.scale,
  ];
  const layers = [];

  for (const { slot, attachment, vertices, uvs, triangles } of visibleGeometry(spine, skeleton)) {
    const pageName = attachment.region?.page?.name;
    const page = texturePages.get(pageName) ?? texturePages.values().next().value;
    if (!page) continue;
    const opacity = Math.max(0, Math.min(1, skeleton.color.a * slot.color.a * attachment.color.a));
    const projectedVertices = new Float64Array(vertices.length);
    for (let index = 0; index < vertices.length; index += 2) {
      [projectedVertices[index], projectedVertices[index + 1]] = project(vertices[index], vertices[index + 1]);
    }
    layers.push({
      vertices: projectedVertices,
      uvs,
      triangles,
      texture: page,
      opacity,
    });
  }
  return layers;
}

async function encodeCleanFrame(data, width, height, channels) {
  for (let offset = 0; offset < data.length; offset += channels) {
    if (data[offset + 3] === 0) data[offset] = data[offset + 1] = data[offset + 2] = 0;
  }
  return sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}

function safeAnimationName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLocaleLowerCase() || 'animation';
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function animationIsComplete(directory, frames) {
  try {
    const files = new Set(await fs.readdir(directory));
    const pngFiles = [...files].filter((file) => /^\d{3}\.png$/.test(file));
    if (pngFiles.length !== frames) return false;
    for (let frame = 0; frame < frames; frame++) {
      if (!files.has(`${String(frame).padStart(3, '0')}.png`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sameRenderConfig(manifest, config) {
  return manifest?.render_revision === RENDER_REVISION
    && manifest?.blank_policy_revision === BLANK_POLICY_REVISION
    && manifest?.placement_revision === PLACEMENT_REVISION
    && manifest?.canvas?.width === config.width
    && manifest?.canvas?.height === config.height
    && manifest?.sampling?.fps === config.fps
    && manifest?.sampling?.maximum_frames === config.maxFrames;
}

async function loadTexturePages(spine, atlasText, retrieval) {
  const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', retrieval.character_id, retrieval.variant_id);
  const files = retrieval.files.textures;
  const pages = new Map();
  for (const file of files) {
    const texturePath = path.join(REPO_ROOT, file.path);
    const buffer = await fs.readFile(texturePath);
    const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!decoded.info.width || !decoded.info.height || decoded.info.channels !== 4) {
      throw new Error(`Invalid source texture: ${texturePath}`);
    }
    const atlasName = path.relative(sourceDir, texturePath).replaceAll(path.sep, '/');
    const page = {
      name: atlasName,
      width: decoded.info.width,
      height: decoded.info.height,
      data: decoded.data,
    };
    pages.set(atlasName, page);
    pages.set(path.basename(atlasName), page);
  }
  const atlas = new spine.TextureAtlas(atlasText, (name) => {
    const page = pages.get(name.trim()) ?? pages.get(path.basename(name.trim()));
    if (!page) throw new Error(`Atlas texture was not acquired: ${name}`);
    return new spine.FakeTexture({ width: page.width, height: page.height });
  });
  return { atlas, pages };
}

async function exportVariant(spine, { character, variant }, config) {
  const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', character.character_id, variant.variant_id);
  const retrievalPath = path.join(sourceDir, 'retrieval.json');
  const retrieval = await readJsonIfPresent(retrievalPath);
  if (!retrieval) {
    throw new Error(`Missing source retrieval; run acquire-prts-spine first: ${path.relative(REPO_ROOT, retrievalPath)}`);
  }

  const atlasPath = path.join(REPO_ROOT, retrieval.files.atlas);
  const skeletonPath = path.join(REPO_ROOT, retrieval.files.skeleton);
  const atlasText = await fs.readFile(atlasPath, 'utf8');
  const { atlas, pages } = await loadTexturePages(spine, atlasText, retrieval);
  const skeletonBytes = await fs.readFile(skeletonPath);
  const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);
  const skeletonData = skeletonBytes[0] === 0x7b
    ? new spine.SkeletonJson(attachmentLoader).readSkeletonData(JSON.parse(skeletonBytes.toString('utf8')))
    : new spine.SkeletonBinary(attachmentLoader).readSkeletonData(new Uint8Array(skeletonBytes));
  const sourceAnimations = skeletonData.animations.map((animation) => ({
    name: animation.name,
    duration: animation.duration,
  }));

  if (args.includes('--inspect')) {
    const measurement = measureSkeleton(spine, skeletonData, config);
    const initialTransform = renderTransform(measurement.bounds, config.width, config.height);
    const { transform, probe } = densityCorrectedTransform(spine, skeletonData, pages, initialTransform, config);
    const densityCorrected = probe?.density_zoom >= 1.2;
    console.log(JSON.stringify({
      character: character.character_id,
      variant: variant.variant_id,
      spine_version: skeletonData.version,
      animations: sourceAnimations,
      placement: {
        bounds_policy: densityCorrected ? 'pixel-density-corrected-envelope' : measurement.policy,
        source_bounds: measurement.bounds,
        full_source_bounds: measurement.fullBounds,
        core_source_bounds: measurement.coreBounds,
        cluster: measurement.cluster,
        pixel_probe: probe,
        scale: rounded(transform.scale),
      },
    }, null, 2));
    return;
  }

  const animationFilter = argument('--animation');
  const selectedAnimations = animationFilter
    ? skeletonData.animations.filter((animation) => {
      const wanted = animationFilter.toLocaleLowerCase();
      return animation.name.toLocaleLowerCase() === wanted || safeAnimationName(animation.name) === wanted;
    })
    : skeletonData.animations;
  if (!selectedAnimations.length) throw new Error(`Unknown source animation: ${animationFilter}`);

  const safeNames = new Set();
  for (const animation of skeletonData.animations) {
    const safeName = safeAnimationName(animation.name);
    if (safeNames.has(safeName)) throw new Error(`Animation filename collision: ${safeName}`);
    safeNames.add(safeName);
  }

  const outputDir = path.join(REPO_ROOT, 'standalone/assets/cleaned', character.character_id, variant.variant_id);
  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.mkdir(outputDir, { recursive: true });
  const previous = await readJsonIfPresent(manifestPath);
  const measurement = measureSkeleton(spine, skeletonData, config);
  const bounds = measurement.bounds;
  const initialTransform = renderTransform(bounds, config.width, config.height);
  const { transform, probe } = densityCorrectedTransform(spine, skeletonData, pages, initialTransform, config);
  const densityCorrected = probe?.density_zoom >= 1.2;
  const manifest = {
    schema_version: 2,
    render_revision: RENDER_REVISION,
    blank_policy_revision: BLANK_POLICY_REVISION,
    placement_revision: PLACEMENT_REVISION,
    character: character.character_id,
    character_name: character.character_name,
    localized_name: character.localized_name,
    variant: variant.variant_id,
    variant_type: variant.variant_type,
    variant_name: variant.name,
    skin_id: variant.skin_id,
    skin_name: variant.skin_name,
    source: path.relative(REPO_ROOT, sourceDir),
    source_page: character.source_page,
    source_asset_set: variant.source_asset_set,
    retrieval_date: retrieval.retrieval_date,
    spine_version: skeletonData.version,
    original_animation_states: sourceAnimations,
    processed_states: sameRenderConfig(previous, config) ? (previous.processed_states ?? {}) : {},
    renderer: 'PRTS Spine 3.8 runtime data with deterministic CPU triangle composition',
    canvas: {
      width: config.width,
      height: config.height,
      transparent_background: true,
      hidden_rgb_zeroed: true,
      ground_aligned: true,
    },
    sampling: {
      fps: config.fps,
      maximum_frames: config.maxFrames,
    },
    placement: {
      bounds_policy: densityCorrected ? 'pixel-density-corrected-envelope' : measurement.policy,
      source_bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, rounded(value)])),
      full_source_bounds: Object.fromEntries(Object.entries(measurement.fullBounds).map(([key, value]) => [key, rounded(value)])),
      ...(measurement.coreBounds ? {
        core_source_bounds: Object.fromEntries(Object.entries(measurement.coreBounds).map(([key, value]) => [key, rounded(value)])),
        cluster: measurement.cluster,
      } : {}),
      pixel_probe: probe,
      scale: rounded(transform.scale),
      x_offset: rounded(transform.xOffset),
      y_offset: rounded(transform.yOffset),
      padding: transform.padding,
    },
    exported_at: new Date().toISOString(),
  };

  const skeleton = new spine.Skeleton(skeletonData);
  const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
  for (const animation of selectedAnimations) {
    const safeName = safeAnimationName(animation.name);
    const frameCount = animation.duration === 0
      ? 1
      : Math.max(2, Math.min(config.maxFrames, Math.ceil(animation.duration * config.fps)));
    const animationDir = path.join(outputDir, safeName);
    const declaredBlankFrames = [
      ...intentionalBlankFrames(character.character_id, variant.variant_id, safeName),
      ...(manifest.processed_states[safeName]?.intentional_blank_frames ?? []),
    ].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.frame === entry.frame) === index);
    const observedBlankFrames = [];
    const oldEntry = manifest.processed_states[safeName];
    const canResume = !args.includes('--force')
      && oldEntry?.source_animation === animation.name
      && oldEntry?.frames === frameCount
      && await animationIsComplete(animationDir, frameCount);

    if (!canResume) {
      const temporaryDir = await fs.mkdtemp(`${animationDir}.partial-`);
      try {
        for (let frame = 0; frame < frameCount; frame++) {
          const time = frameCount === 1 ? 0 : animation.duration * frame / frameCount;
          applyAnimation(skeleton, state, animation.name, time);
          const layers = renderFrameLayers(
            spine,
            skeleton,
            pages,
            transform,
          );
          let data;
          try {
            ({ data } = rasterizeTexturedTriangles({
              width: config.width,
              height: config.height,
              layers,
              sampleGrid: 2,
            }));
          } catch (error) {
            throw new Error(`${animation.name} frame ${frame}: ${error.message}`);
          }
          if (!hasVisibleAlpha(data) && !declaredBlankFrames.some((entry) => entry.frame === frame)) {
            if (safeName !== 'special' && safeName !== 'interact') {
              throw new Error(`${animation.name} frame ${frame}: canonical core animation rendered fully transparent`);
            }
            observedBlankFrames.push({
              frame,
              reason: `The deterministic Spine ${animation.name} sample contains no visible pixels in the canonical character envelope; retained explicitly as a source-authored transition beat.`,
              observed_by: `blank-policy-revision-${BLANK_POLICY_REVISION}`,
            });
          }
          const destination = path.join(temporaryDir, `${String(frame).padStart(3, '0')}.png`);
          await fs.writeFile(destination, await encodeCleanFrame(
            data,
            config.width,
            config.height,
            4,
          ));
        }
        await fs.rm(animationDir, { recursive: true, force: true });
        await fs.rename(temporaryDir, animationDir);
      } catch (error) {
        await fs.rm(temporaryDir, { recursive: true, force: true });
        throw error;
      }
      console.log(`rendered ${character.character_id}/${variant.variant_id}:${animation.name} (${frameCount} frames)`);
    } else {
      console.log(`resumed ${character.character_id}/${variant.variant_id}:${animation.name} (${frameCount} frames)`);
    }

    const blankFrames = [...declaredBlankFrames, ...observedBlankFrames]
      .sort((left, right) => left.frame - right.frame);
    manifest.processed_states[safeName] = {
      source_animation: animation.name,
      duration: animation.duration,
      fps: config.fps,
      frames: frameCount,
      path: path.relative(REPO_ROOT, animationDir),
      ...(blankFrames.length ? {
        intentional_blank_frames: blankFrames,
      } : {}),
    };
    manifest.exported_at = new Date().toISOString();
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(`ready ${character.character_id}/${variant.variant_id}`);
}

const jobs = selectedJobs();
const config = {
  width: positiveInteger('--width', 192, 1024),
  height: positiveInteger('--height', 224, 1024),
  fps: positiveInteger('--fps', 8, 60),
  maxFrames: positiveInteger('--max-frames', 8, 120),
};
const concurrency = positiveInteger('--concurrency', 2, 8);
if (!args.includes('--worker') && jobs.length > 1) {
  console.log(`supervising ${jobs.length} isolated variant worker(s), concurrency=${concurrency}, canvas=${config.width}x${config.height}`);
  const failures = await supervise(jobs, config, concurrency);
  console.log(`Spine export complete: ${jobs.length - failures.length}/${jobs.length}`);
  if (failures.length) process.exitCode = 1;
} else {
  if (jobs.length !== 1) throw new Error('An isolated export worker must select exactly one variant');
  sharp.cache({ memory: 32, files: 0, items: 16 });
  sharp.concurrency(1);
  const spine = await loadPrtsRuntime(jobs[0].character.source_page);
  console.log(`exporting ${jobs.length} standalone variant(s), isolated=${args.includes('--worker')}, canvas=${config.width}x${config.height}`);
  const failures = await mapBounded(jobs, 1, (job) => exportVariant(spine, job, config));
  console.log(`Spine export complete: ${jobs.length - failures.length}/${jobs.length}`);
  if (failures.length) process.exitCode = 1;
}
