#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME_MAP_URL = 'https://static.prts.wiki/widgets/production/SpineViewer.DzdEWlBa.js.map';
const registry = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'standalone/characters/registry.json'), 'utf8'));

function argument(name, fallback = null) {
  const match = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (match) return match.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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
    if (index < 0 || !sourceMap.sourcesContent[index]) throw new Error('PRTS source map does not contain spine-webgl.js');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(runtimePath, sourceMap.sourcesContent[index]);
  }
  return (await import(`${pathToFileURL(runtimePath).href}?v=1`)).default;
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

const number = (value) => Number(value.toFixed(5));
const point = ([x, y]) => `${number(x)},${number(y)}`;

function renderFrameSvg(spine, skeleton, textureData, textureWidth, textureHeight) {
  const width = 384;
  const height = 448;
  const scale = 0.82;
  const project = (x, y) => [width / 2 + x * scale, height - 22 - y * scale];
  const definitions = [`<image id="texture" href="data:image/png;base64,${textureData}" width="${textureWidth}" height="${textureHeight}"/>`];
  const layers = [];
  let triangleId = 0;

  for (const slot of skeleton.drawOrder) {
    const attachment = slot.getAttachment();
    if (!attachment || slot.color.a <= 0.001) continue;
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
      continue;
    }
    const opacity = Math.max(0, Math.min(1, skeleton.color.a * slot.color.a * attachment.color.a));
    for (let index = 0; index < triangles.length; index += 3) {
      const indices = [triangles[index], triangles[index + 1], triangles[index + 2]];
      const source = indices.map((vertex) => [uvs[vertex * 2] * textureWidth, uvs[vertex * 2 + 1] * textureHeight]);
      const destination = indices.map((vertex) => project(vertices[vertex * 2], vertices[vertex * 2 + 1]));
      const matrix = affine(source, destination);
      if (!matrix || destination.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      const clipId = `triangle-${triangleId++}`;
      definitions.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${destination.map(point).join(' ')}"/></clipPath>`);
      layers.push(`<g clip-path="url(#${clipId})"><use href="#texture" transform="matrix(${matrix.map(number).join(' ')})" opacity="${number(opacity)}"/></g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${definitions.join('')}</defs>${layers.join('')}</svg>`;
}

async function cleanHiddenRgb(png) {
  const image = sharp(png).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] === 0) data[offset] = data[offset + 1] = data[offset + 2] = 0;
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

const characterId = argument('--character', 'amiya');
const animationFilter = argument('--animation');
const character = registry.characters.find((entry) => entry.id === characterId);
if (!character) throw new Error(`Unknown standalone character: ${characterId}`);
const sourceDir = path.join(REPO_ROOT, 'standalone/assets/source', character.id);
const baseName = path.basename(character.source.model);
const atlasPath = path.join(sourceDir, `${baseName}.atlas`);
const skeletonPath = path.join(sourceDir, `${baseName}.skel`);
const atlasText = await fs.readFile(atlasPath, 'utf8');
const textureName = atlasText.split(/\r?\n/).find((line) => line.trim().endsWith('.png'))?.trim();
if (!textureName) throw new Error(`No texture page found in ${atlasPath}`);
const texturePath = path.join(sourceDir, textureName);
const texture = await fs.readFile(texturePath);
const textureMeta = await sharp(texture).metadata();
const spine = await loadPrtsRuntime();
const atlas = new spine.TextureAtlas(atlasText, () => new spine.FakeTexture({ width: textureMeta.width, height: textureMeta.height }));
const binary = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas));
const skeletonData = binary.readSkeletonData(new Uint8Array(await fs.readFile(skeletonPath)));
const animations = skeletonData.animations.map((animation) => ({ name: animation.name, duration: animation.duration }));
console.log(JSON.stringify({ character: character.id, spine_version: skeletonData.version, animations }, null, 2));

if (!process.argv.includes('--inspect')) {
  const outputDir = path.join(REPO_ROOT, 'standalone/assets/cleaned', character.id);
  await fs.mkdir(outputDir, { recursive: true });
  const skeleton = new spine.Skeleton(skeletonData);
  const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
  const textureData = texture.toString('base64');
  const exported = {};
  const selectedAnimations = animationFilter
    ? skeletonData.animations.filter((animation) => animation.name.toLocaleLowerCase() === animationFilter.toLocaleLowerCase())
    : skeletonData.animations;
  if (!selectedAnimations.length) throw new Error(`Unknown source animation: ${animationFilter}`);
  for (const animation of selectedAnimations) {
    const safeName = animation.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const frameCount = animation.duration === 0 ? 1 : Math.max(2, Math.min(30, Math.ceil(animation.duration * 12)));
    const animationDir = path.join(outputDir, safeName);
    await fs.mkdir(animationDir, { recursive: true });
    for (let frame = 0; frame < frameCount; frame++) {
      const time = frameCount === 1 ? 0 : animation.duration * frame / frameCount;
      skeleton.setToSetupPose();
      state.clearTracks();
      state.setAnimation(0, animation.name, false);
      state.update(time);
      state.apply(skeleton);
      skeleton.updateWorldTransform();
      const svg = renderFrameSvg(spine, skeleton, textureData, textureMeta.width, textureMeta.height);
      const rendered = await sharp(Buffer.from(svg)).png().toBuffer();
      await fs.writeFile(path.join(animationDir, `${String(frame).padStart(3, '0')}.png`), await cleanHiddenRgb(rendered));
    }
    exported[safeName] = { source_animation: animation.name, duration: animation.duration, fps: 12, frames: frameCount };
    console.log(`rendered ${character.id}:${animation.name} (${frameCount} frames)`);
  }
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify({
    character: character.id,
    source: path.relative(REPO_ROOT, sourceDir),
    renderer: 'PRTS Spine 3.8 runtime data with deterministic CPU triangle composition',
    animations: exported,
  }, null, 2)}\n`);
}
