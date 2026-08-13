#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROSTER_PATH = path.join(REPO_ROOT, 'shared/character-data/standalone-roster.json');
const RUNTIME_MAP_URL = 'https://static.prts.wiki/widgets/production/SpineViewer.DzdEWlBa.js.map';
const roster = JSON.parse(await fs.readFile(ROSTER_PATH, 'utf8'));
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

async function loadPrtsRuntime() {
  const cacheDir = path.join(REPO_ROOT, '.cache', 'prts-spine');
  const runtimePath = path.join(cacheDir, 'spine-webgl.mjs');
  try {
    await fs.access(runtimePath);
  } catch {
    const response = await fetch(RUNTIME_MAP_URL);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${RUNTIME_MAP_URL}`);
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

function affine(source, destination) {
  const [[x1, y1], [x2, y2], [x3, y3]] = source;
  const [[X1, Y1], [X2, Y2], [X3, Y3]] = destination;
  const denominator = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
  if (Math.abs(denominator) < 0.00001) return null;
  const solve = (q1, q2, q3) => [
    (q1 * (y2 - y3) + q2 * (y3 - y1) + q3 * (y1 - y2)) / denominator,
    (q1 * (x3 - x2) + q2 * (x1 - x3) + q3 * (x2 - x1)) / denominator,
    (q1 * (x2 * y3 - x3 * y2) + q2 * (x3 * y1 - x1 * y3) + q3 * (x1 * y2 - x2 * y1)) / denominator,
  ];
  const [a, c, e] = solve(X1, X2, X3);
  const [b, d, f] = solve(Y1, Y2, Y3);
  return [a, b, c, d, e, f];
}

const rounded = (value) => Number(value.toFixed(5));
const point = ([x, y]) => `${rounded(x)},${rounded(y)}`;

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

function measureSkeleton(spine, skeletonData) {
  const skeleton = new spine.Skeleton(skeletonData);
  const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  applyAnimation(skeleton, state, null, 0);
  extendBounds(bounds, visibleGeometry(spine, skeleton));
  for (const animation of skeletonData.animations) {
    const sampleCount = animation.duration === 0 ? 1 : Math.max(2, Math.min(6, Math.ceil(animation.duration * 3)));
    for (let sample = 0; sample < sampleCount; sample++) {
      const time = sampleCount === 1 ? 0 : animation.duration * sample / sampleCount;
      applyAnimation(skeleton, state, animation.name, time);
      extendBounds(bounds, visibleGeometry(spine, skeleton));
    }
  }
  if (!Object.values(bounds).every(Number.isFinite)) {
    return { minX: -160, maxX: 160, minY: 0, maxY: 480 };
  }
  return bounds;
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

function textureDefinitions(texturePages) {
  const definitions = [];
  for (const page of new Set(texturePages.values())) {
    definitions.push(`<image id="${page.svgId}" href="data:image/png;base64,${page.data}" width="${page.width}" height="${page.height}"/>`);
  }
  return definitions;
}

function renderFrameElements(spine, skeleton, texturePages, width, transform, frame, firstTriangleId) {
  const project = (x, y) => [
    frame * width + transform.xOffset + x * transform.scale,
    transform.yOffset - y * transform.scale,
  ];
  const definitions = [];
  const layers = [];
  let triangleId = firstTriangleId;

  for (const { slot, attachment, vertices, uvs, triangles } of visibleGeometry(spine, skeleton)) {
    const pageName = attachment.region?.page?.name;
    const page = texturePages.get(pageName) ?? texturePages.values().next().value;
    if (!page) continue;
    const opacity = Math.max(0, Math.min(1, skeleton.color.a * slot.color.a * attachment.color.a));
    for (let index = 0; index < triangles.length; index += 3) {
      const indices = [triangles[index], triangles[index + 1], triangles[index + 2]];
      const source = indices.map((vertex) => [uvs[vertex * 2] * page.width, uvs[vertex * 2 + 1] * page.height]);
      const destination = indices.map((vertex) => project(vertices[vertex * 2], vertices[vertex * 2 + 1]));
      const matrix = affine(source, destination);
      if (!matrix || destination.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      const clipId = `triangle-${triangleId++}`;
      definitions.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${destination.map(point).join(' ')}"/></clipPath>`);
      layers.push(`<g clip-path="url(#${clipId})"><use href="#${page.svgId}" transform="matrix(${matrix.map(rounded).join(' ')})" opacity="${rounded(opacity)}"/></g>`);
    }
  }
  return { definitions, layers, nextTriangleId: triangleId };
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
  return manifest?.canvas?.width === config.width
    && manifest?.canvas?.height === config.height
    && manifest?.sampling?.fps === config.fps
    && manifest?.sampling?.maximum_frames === config.maxFrames;
}

async function loadTexturePages(spine, atlasText, retrieval) {
  const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', retrieval.character_id, retrieval.variant_id);
  const files = retrieval.files.textures;
  const pages = new Map();
  for (const [index, file] of files.entries()) {
    const texturePath = path.join(REPO_ROOT, file.path);
    const buffer = await fs.readFile(texturePath);
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Invalid source texture: ${texturePath}`);
    const atlasName = path.relative(sourceDir, texturePath).replaceAll(path.sep, '/');
    const page = {
      name: atlasName,
      svgId: `texture-page-${index}`,
      width: metadata.width,
      height: metadata.height,
      data: buffer.toString('base64'),
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
  const binary = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas));
  const skeletonData = binary.readSkeletonData(new Uint8Array(await fs.readFile(skeletonPath)));
  const sourceAnimations = skeletonData.animations.map((animation) => ({
    name: animation.name,
    duration: animation.duration,
  }));

  if (args.includes('--inspect')) {
    console.log(JSON.stringify({
      character: character.character_id,
      variant: variant.variant_id,
      spine_version: skeletonData.version,
      animations: sourceAnimations,
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
  const bounds = measureSkeleton(spine, skeletonData);
  const transform = renderTransform(bounds, config.width, config.height);
  const manifest = {
    schema_version: 2,
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
      source_bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, rounded(value)])),
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
    const oldEntry = manifest.processed_states[safeName];
    const canResume = !args.includes('--force')
      && oldEntry?.source_animation === animation.name
      && oldEntry?.frames === frameCount
      && await animationIsComplete(animationDir, frameCount);

    if (!canResume) {
      const temporaryDir = await fs.mkdtemp(`${animationDir}.partial-`);
      for (let frame = 0; frame < frameCount; frame++) {
        const time = frameCount === 1 ? 0 : animation.duration * frame / frameCount;
        applyAnimation(skeleton, state, animation.name, time);
        const elements = renderFrameElements(
          spine,
          skeleton,
          pages,
          config.width,
          transform,
          0,
          0,
        );
        const definitions = [...textureDefinitions(pages), ...elements.definitions];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}"><defs>${definitions.join('')}</defs>${elements.layers.join('')}</svg>`;
        const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (info.width !== config.width || info.height !== config.height || info.channels !== 4) {
          throw new Error(`Unexpected rasterized frame format: ${info.width}x${info.height}x${info.channels}`);
        }
        const destination = path.join(temporaryDir, `${String(frame).padStart(3, '0')}.png`);
        await fs.writeFile(destination, await encodeCleanFrame(
          data,
          config.width,
          config.height,
          info.channels,
        ));
      }
      await fs.rm(animationDir, { recursive: true, force: true });
      await fs.rename(temporaryDir, animationDir);
      console.log(`rendered ${character.character_id}/${variant.variant_id}:${animation.name} (${frameCount} frames)`);
    } else {
      console.log(`resumed ${character.character_id}/${variant.variant_id}:${animation.name} (${frameCount} frames)`);
    }

    manifest.processed_states[safeName] = {
      source_animation: animation.name,
      duration: animation.duration,
      fps: config.fps,
      frames: frameCount,
      path: path.relative(REPO_ROOT, animationDir),
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
const spine = await loadPrtsRuntime();
console.log(`exporting ${jobs.length} standalone variant(s), concurrency=${concurrency}, canvas=${config.width}x${config.height}`);
const failures = await mapBounded(jobs, concurrency, (job) => exportVariant(spine, job, config));
console.log(`Spine export complete: ${jobs.length - failures.length}/${jobs.length}`);
if (failures.length) process.exitCode = 1;
