#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_RUNTIME_ROOT = path.join(REPO_ROOT, 'standalone', 'assets', 'runtime');
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, 'standalone', 'dist', 'contact-sheets');
const EXACT_WEBP_ENCODER = path.join(REPO_ROOT, 'shared', 'image-processing', 'encode-webp-exact.py');
const execFileAsync = promisify(execFile);

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 112;
const COVERAGE_THUMB_WIDTH = 64;
const COVERAGE_THUMB_HEIGHT = Math.round(THUMB_HEIGHT * COVERAGE_THUMB_WIDTH / THUMB_WIDTH);
const COVERAGE_SLOT_WIDTH = 72;
const COVERAGE_PREVIEW_LEFT = 12;
const COVERAGE_PREVIEW_TOP = 66;
const COVERAGE_LABEL_TOP = 150;
const COVERAGE_COLUMNS = 4;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_CONCURRENCY = 4;
const COVERAGE_TILE_WIDTH = 384;
const COVERAGE_TILE_HEIGHT = 250;
const COVERAGE_MARGIN = 24;
const COVERAGE_GAP = 12;
const COVERAGE_HEADER_HEIGHT = 68;
const STRIP_WIDTH = 1320;
const STRIP_HEADER_HEIGHT = 76;
const STRIP_ROW_HEIGHT = 132;
const STRIP_LABEL_WIDTH = 316;
const STRIP_FRAME_GAP = 6;

const COVERAGE_STATES = [
  { label: 'idle', candidates: ['idle'] },
  { label: 'move', candidates: ['walk-right', 'walk-left', 'run-right', 'run-left'] },
  { label: 'interaction', candidates: ['clicked', 'interaction', 'interact'] },
  { label: 'rest/sleep', candidates: ['sleep', 'rest'] },
  { label: 'special', candidates: ['special'] },
];

function option(args, name, fallback = null) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function usage() {
  console.log(`Usage: node shared/image-processing/generate-standalone-contact-sheets.mjs [options]

Options:
  --character <id>     Render only one character
  --variant/--skin <id> Render only one variant (requires --character)
  --batch-size <n>     Variants per coverage page (default: ${DEFAULT_BATCH_SIZE})
  --concurrency <n>    Strip pages rendered concurrently (default: ${DEFAULT_CONCURRENCY})
  --runtime-root <dir> Runtime asset tree (default: standalone/assets/runtime)
  --output <dir>       Output directory (filtered runs default below contact-sheets/selections/)
  --no-clean           Keep unrelated files already present in the output directory
  --help               Show this help

Outputs:
  coverage/*.webp                 Five-state representative frames, batched
  animation-strips/<id>/*.webp    Every logical animation frame sequence
  index.json                      Machine-readable page and QA manifest`);
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safePart(value) {
  return String(value).normalize('NFKC').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'variant';
}

function relativePosix(from, target) {
  return path.relative(from, target).split(path.sep).join('/');
}

function sameOrAncestor(candidate, target) {
  const relative = path.relative(candidate, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeCleanTarget(outputRoot, runtimeRoot) {
  const protectedRoots = [path.parse(outputRoot).root, os.tmpdir(), REPO_ROOT, runtimeRoot, process.cwd()]
    .map((entry) => path.resolve(entry));
  if (protectedRoots.includes(outputRoot) ||
      sameOrAncestor(outputRoot, runtimeRoot) || sameOrAncestor(runtimeRoot, outputRoot) ||
      sameOrAncestor(outputRoot, REPO_ROOT)) {
    throw new Error(`refusing to recursively clean unsafe contact-sheet output: ${outputRoot}`);
  }
}

async function variantLocalAsset(variantRoot, value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(`${label}: source sheet must be a relative path inside its variant directory`);
  }
  const resolved = path.resolve(variantRoot, value);
  if (!resolved.startsWith(`${variantRoot}${path.sep}`)) {
    throw new Error(`${label}: source sheet leaves its variant directory`);
  }
  const [canonicalRoot, canonicalAsset] = await Promise.all([
    fs.realpath(variantRoot),
    fs.realpath(resolved),
  ]);
  if (!canonicalAsset.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`${label}: source sheet resolves outside its variant directory`);
  }
  return resolved;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, file)}: ${error.message}`);
  }
}

async function discoverVariants(runtimeRoot, characterFilter, variantFilter) {
  if (variantFilter && !characterFilter) throw new Error('--variant requires --character');
  const characterEntries = await fs.readdir(runtimeRoot, { withFileTypes: true });
  const variants = [];
  for (const characterEntry of characterEntries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (characterFilter && characterEntry.name !== characterFilter) continue;
    const characterRoot = path.join(runtimeRoot, characterEntry.name);
    const variantEntries = await fs.readdir(characterRoot, { withFileTypes: true });
    for (const variantEntry of variantEntries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const root = path.join(characterRoot, variantEntry.name);
      const manifestPath = path.join(root, 'manifest.json');
      const manifest = await readJson(manifestPath);
      const characterId = manifest.character?.id;
      const variantId = manifest.variant?.id || 'default';
      if (characterId !== characterEntry.name || variantId !== variantEntry.name) {
        throw new Error(`${relativePosix(REPO_ROOT, manifestPath)}: path and manifest identity differ`);
      }
      if (variantFilter && ![
        variantId,
        manifest.variant?.skinId,
        manifest.variant?.name,
        manifest.variant?.localizedName,
      ].includes(variantFilter)) continue;
      variants.push({ characterId, variantId, root, manifestPath, manifest });
    }
  }
  if (variantFilter && variants.length > 1) {
    throw new Error(`${characterFilter}: variant/skin selector ${variantFilter} is ambiguous`);
  }
  if (characterFilter && variants.length === 0) {
    throw new Error(`No runtime variants matched ${characterFilter}${variantFilter ? `/${variantFilter}` : ''}`);
  }
  return variants;
}

function rawFrame(atlas, frameIndex, frameWidth = THUMB_WIDTH, frameHeight = THUMB_HEIGHT) {
  const columns = atlas.columns;
  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  if (frameIndex < 0 || column >= columns || row >= atlas.rows) {
    throw new Error(`${atlas.label}: frame ${frameIndex} is outside ${columns}x${atlas.rows} atlas`);
  }
  const output = Buffer.allocUnsafe(frameWidth * frameHeight * 4);
  const sourceX = column * frameWidth;
  const sourceY = row * frameHeight;
  for (let y = 0; y < frameHeight; y++) {
    const sourceOffset = ((sourceY + y) * atlas.width + sourceX) * 4;
    const outputOffset = y * frameWidth * 4;
    atlas.data.copy(output, outputOffset, sourceOffset, sourceOffset + frameWidth * 4);
  }
  return output;
}

function flopRaw(input, width = THUMB_WIDTH, height = THUMB_HEIGHT) {
  const output = Buffer.allocUnsafe(input.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const destination = (y * width + (width - x - 1)) * 4;
      input.copy(output, destination, source, source + 4);
    }
  }
  return output;
}

async function loadAtlases(variant, qa) {
  const atlases = new Map();
  const { width: frameWidth, height: frameHeight } = variant.manifest.frameSize || {};
  if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth < 1 || frameHeight < 1) {
    throw new Error(`${relativePosix(REPO_ROOT, variant.manifestPath)}: invalid frameSize`);
  }
  for (const [sourceName, source] of Object.entries(variant.manifest.sources || {})) {
    const columns = Number(source.columns);
    const rows = Number(source.rows);
    const frames = Number(source.frames);
    if (![columns, rows, frames].every((value) => Number.isInteger(value) && value > 0) || frames > columns * rows) {
      throw new Error(`${variant.characterId}/${variant.variantId}:${sourceName}: invalid atlas layout`);
    }
    const sheetPath = await variantLocalAsset(
      variant.root,
      source.sheet,
      `${variant.characterId}/${variant.variantId}:${sourceName}`,
    );
    const metadata = await sharp(sheetPath).metadata();
    const expectedWidth = columns * frameWidth;
    const expectedHeight = rows * frameHeight;
    qa.source_atlases_checked++;
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      qa.crop_violations++;
      throw new Error(`${relativePosix(REPO_ROOT, sheetPath)}: ${metadata.width}x${metadata.height}, expected ${expectedWidth}x${expectedHeight}`);
    }
    if (!metadata.hasAlpha) {
      qa.alpha_violations++;
      throw new Error(`${relativePosix(REPO_ROOT, sheetPath)}: atlas has no alpha channel`);
    }
    const resizedWidth = columns * THUMB_WIDTH;
    const resizedHeight = rows * THUMB_HEIGHT;
    const { data, info } = await sharp(sheetPath)
      .ensureAlpha()
      .resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    atlases.set(sourceName, {
      label: `${variant.characterId}/${variant.variantId}:${sourceName}`,
      data,
      width: info.width,
      height: info.height,
      columns,
      rows,
      frames,
    });
  }
  return atlases;
}

function resolveAnimation(variant, candidates) {
  for (const candidate of candidates) {
    if (variant.manifest.animations?.[candidate]) return [candidate, variant.manifest.animations[candidate]];
  }
  return null;
}

function animationFrames(variant, atlases, animationName, animation) {
  const atlas = atlases.get(animation.source);
  if (!atlas) throw new Error(`${variant.characterId}/${variant.variantId}:${animationName}: unknown source ${animation.source}`);
  if (!Array.isArray(animation.frameOrder) || animation.frameOrder.length === 0) {
    throw new Error(`${variant.characterId}/${variant.variantId}:${animationName}: empty frameOrder`);
  }
  return animation.frameOrder.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= atlas.frames) {
      throw new Error(`${variant.characterId}/${variant.variantId}:${animationName}: frame ${index} is outside source frame count ${atlas.frames}`);
    }
    const frame = rawFrame(atlas, index);
    return animation.mirror ? flopRaw(frame) : frame;
  });
}

function panelSvg(width, height, title, subtitle = '') {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="12" fill="#10151de8" stroke="#3b4657" stroke-width="1"/>
    <text x="14" y="24" fill="#f4f7fb" font-family="DejaVu Sans" font-size="16" font-weight="700">${xml(title)}</text>
    ${subtitle ? `<text x="14" y="44" fill="#aeb8c8" font-family="DejaVu Sans" font-size="11">${xml(subtitle)}</text>` : ''}
  </svg>`);
}

function pageTitleSvg(width, title, subtitle) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="64">
    <text x="24" y="30" fill="#f4f7fb" font-family="DejaVu Sans" font-size="24" font-weight="700">${xml(title)}</text>
    <text x="24" y="52" fill="#aeb8c8" font-family="DejaVu Sans" font-size="13">${xml(subtitle)}</text>
  </svg>`);
}

async function renderPngBuffer(width, height, composites) {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

async function renderSvgPng(input) {
  return sharp(input).png().toBuffer();
}

async function writeWebp(width, height, composites, output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Keep composition and WebP encoding in separate libvips pipelines. Directly
  // encoding a tall page with many overlays can corrupt the small SVG title
  // region on some libvips builds even though every individual layer is valid.
  const composedPage = await renderPngBuffer(width, height, composites);
  const { data: rgba, info: rawInfo } = await sharp(composedPage)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // SVG/PNG compositing can leave color values behind fully transparent pixels.
  // Clear those values before encoding so viewers never expose white stripes or
  // glyph-shaped garbage while handling unpremultiplied transparent WebP.
  for (let index = 0; index < rgba.length; index += rawInfo.channels) {
    if (rgba[index + 3] === 0) {
      rgba[index] = 0;
      rgba[index + 1] = 0;
      rgba[index + 2] = 0;
    }
  }
  const exactInput = `${output}.partial-${process.pid}.png`;
  try {
    await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(exactInput);
    await execFileAsync(process.env.PYTHON || 'python3', [EXACT_WEBP_ENCODER, exactInput, output, '0']);
  } finally {
    await fs.rm(exactInput, { force: true });
  }
  const metadata = await sharp(output).metadata();
  if (metadata.width !== width || metadata.height !== height || !metadata.hasAlpha) {
    throw new Error(`${relativePosix(REPO_ROOT, output)}: output dimensions/alpha validation failed`);
  }
  const { data, info } = await sharp(output)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  let hiddenRgb = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const pixel = index / info.channels;
    if (pixel < width * Math.min(64, height) && data[index + 3] !== 0) visible++;
    if (data[index + 3] === 0 && (data[index] !== 0 || data[index + 1] !== 0 || data[index + 2] !== 0)) hiddenRgb++;
  }
  if (hiddenRgb !== 0) {
    throw new Error(`${relativePosix(REPO_ROOT, output)}: ${hiddenRgb} transparent pixels contain hidden RGB`);
  }
  const visibleRatio = visible / (width * Math.min(64, height));
  if (visibleRatio < 0.005 || visibleRatio > 0.2) {
    throw new Error(`${relativePosix(REPO_ROOT, output)}: corrupted or missing page title (${visibleRatio.toFixed(3)} visible header ratio)`);
  }
}

async function renderCoveragePage(batch, pageNumber, pageCount, outputRoot, atlasCache) {
  const rows = Math.ceil(batch.length / COVERAGE_COLUMNS);
  const width = COVERAGE_MARGIN * 2 + COVERAGE_COLUMNS * COVERAGE_TILE_WIDTH + (COVERAGE_COLUMNS - 1) * COVERAGE_GAP;
  const height = COVERAGE_HEADER_HEIGHT + COVERAGE_MARGIN + rows * COVERAGE_TILE_HEIGHT + Math.max(0, rows - 1) * COVERAGE_GAP + COVERAGE_MARGIN;
  const composites = [{ input: await renderSvgPng(pageTitleSvg(width, 'Standalone variant coverage', `page ${pageNumber}/${pageCount} · idle · move · interaction · rest/sleep · special`)), left: 0, top: 0 }];
  const entries = [];
  for (let index = 0; index < batch.length; index++) {
    const variant = batch[index];
    const atlases = atlasCache.get(`${variant.characterId}/${variant.variantId}`);
    const column = index % COVERAGE_COLUMNS;
    const row = Math.floor(index / COVERAGE_COLUMNS);
    const left = COVERAGE_MARGIN + column * (COVERAGE_TILE_WIDTH + COVERAGE_GAP);
    const top = COVERAGE_HEADER_HEIGHT + COVERAGE_MARGIN + row * (COVERAGE_TILE_HEIGHT + COVERAGE_GAP);
    const characterName = variant.manifest.character?.name || variant.characterId;
    const tileComposites = [{
      input: panelSvg(COVERAGE_TILE_WIDTH, COVERAGE_TILE_HEIGHT, `${characterName} · ${variant.variantId}`, `character: ${variant.characterId} · skin: ${variant.variantId}`),
      left: 0,
      top: 0,
    }];
    const states = [];
    for (let stateIndex = 0; stateIndex < COVERAGE_STATES.length; stateIndex++) {
      const state = COVERAGE_STATES[stateIndex];
      const resolved = resolveAnimation(variant, state.candidates);
      if (!resolved) throw new Error(`${variant.characterId}/${variant.variantId}: missing coverage state ${state.label}`);
      const [animationName, animation] = resolved;
      const frames = animationFrames(variant, atlases, animationName, animation);
      const representative = frames[Math.floor((frames.length - 1) / 2)];
      const preview = await sharp(representative, {
        raw: { width: THUMB_WIDTH, height: THUMB_HEIGHT, channels: 4 },
      }).resize(COVERAGE_THUMB_WIDTH, COVERAGE_THUMB_HEIGHT, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      }).raw().toBuffer();
      const slotLeft = COVERAGE_PREVIEW_LEFT + stateIndex * COVERAGE_SLOT_WIDTH;
      const previewLeft = slotLeft + Math.floor((COVERAGE_SLOT_WIDTH - COVERAGE_THUMB_WIDTH) / 2);
      tileComposites.push({
        input: preview,
        raw: { width: COVERAGE_THUMB_WIDTH, height: COVERAGE_THUMB_HEIGHT, channels: 4 },
        left: previewLeft,
        top: COVERAGE_PREVIEW_TOP,
      });
      tileComposites.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${COVERAGE_SLOT_WIDTH}" height="26"><text x="${COVERAGE_SLOT_WIDTH / 2}" y="17" text-anchor="middle" fill="#c7d0dc" font-family="DejaVu Sans" font-size="10">${xml(state.label)}</text></svg>`),
        left: slotLeft,
        top: COVERAGE_LABEL_TOP,
      });
      states.push({ label: state.label, animation: animationName, source: animation.source, frame: animation.frameOrder[Math.floor((animation.frameOrder.length - 1) / 2)] });
    }
    composites.push({
      input: await renderPngBuffer(COVERAGE_TILE_WIDTH, COVERAGE_TILE_HEIGHT, tileComposites),
      left,
      top,
    });
    entries.push({ character_id: variant.characterId, variant_id: variant.variantId, states });
  }
  const output = path.join(outputRoot, 'coverage', `${String(pageNumber).padStart(3, '0')}.webp`);
  await writeWebp(width, height, composites, output);
  return { path: relativePosix(outputRoot, output), width, height, variants: entries };
}

async function renderAnimationStripPage(variant, outputRoot, atlases) {
  const animations = Object.entries(variant.manifest.animations || {});
  if (animations.length === 0) throw new Error(`${variant.characterId}/${variant.variantId}: no animations`);
  const height = STRIP_HEADER_HEIGHT + animations.length * STRIP_ROW_HEIGHT + 20;
  const characterName = variant.manifest.character?.name || variant.characterId;
  const variantName = variant.manifest.variant?.name || variant.variantId;
  const composites = [{ input: await renderSvgPng(pageTitleSvg(STRIP_WIDTH, `${characterName} · ${variant.variantId}`, `character: ${variant.characterId} · skin: ${variant.variantId} · ${animations.length} animation sequences`)), left: 0, top: 0 }];
  const animationEntries = [];
  for (let row = 0; row < animations.length; row++) {
    const [animationName, animation] = animations[row];
    const top = STRIP_HEADER_HEIGHT + row * STRIP_ROW_HEIGHT;
    const frames = animationFrames(variant, atlases, animationName, animation);
    const provenance = animation.generatedFrames?.length ? 'generated/derived' : 'source/derived';
    const rowComposites = [{
      input: panelSvg(STRIP_WIDTH - 32, STRIP_ROW_HEIGHT - 6, animationName, `${animation.source} · ${frames.length} frames · ${animation.fps || '?'} fps · ${animation.loop ? 'loop' : 'once'} · ${provenance}`),
      left: 16,
      top: 0,
    }];
    const availableWidth = STRIP_WIDTH - STRIP_LABEL_WIDTH - 32;
    const frameWidth = Math.max(24, Math.min(
      THUMB_WIDTH,
      Math.floor((availableWidth - STRIP_FRAME_GAP * Math.max(0, frames.length - 1)) / frames.length),
    ));
    const frameHeight = Math.max(1, Math.round(THUMB_HEIGHT * frameWidth / THUMB_WIDTH));
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const left = STRIP_LABEL_WIDTH + frameIndex * (frameWidth + STRIP_FRAME_GAP);
      if (left + frameWidth > STRIP_WIDTH - 16) {
        throw new Error(`${variant.characterId}/${variant.variantId}:${animationName}: ${frames.length} frames do not fit the strip page`);
      }
      const top = 7 + Math.floor((THUMB_HEIGHT - frameHeight) / 2);
      const input = frameWidth === THUMB_WIDTH
        ? frames[frameIndex]
        : await sharp(frames[frameIndex], {
          raw: { width: THUMB_WIDTH, height: THUMB_HEIGHT, channels: 4 },
        }).resize(frameWidth, frameHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer();
      rowComposites.push({ input, raw: { width: frameWidth, height: frameHeight, channels: 4 }, left, top });
    }
    composites.push({
      input: await renderPngBuffer(STRIP_WIDTH, STRIP_ROW_HEIGHT, rowComposites),
      left: 0,
      top,
    });
    animationEntries.push({
      animation: animationName,
      source: animation.source,
      sheet: animation.sheet,
      frame_count: frames.length,
      frame_order: animation.frameOrder,
      fps: animation.fps,
      loop: Boolean(animation.loop),
      mirror: Boolean(animation.mirror),
      fallback: animation.fallback || null,
      generated_frames: animation.generatedFrames || [],
    });
  }
  const output = path.join(outputRoot, 'animation-strips', safePart(variant.characterId), `${safePart(variant.variantId)}.webp`);
  await writeWebp(STRIP_WIDTH, height, composites, output);
  return {
    path: relativePosix(outputRoot, output),
    width: STRIP_WIDTH,
    height,
    character_id: variant.characterId,
    character_name: variant.manifest.character?.name || characterName,
    localized_name: variant.manifest.character?.localizedName || characterName,
    variant_id: variant.variantId,
    variant_name: variant.manifest.variant?.name || variantName,
    localized_variant_name: variant.manifest.variant?.localizedName || variantName,
    animations: animationEntries,
  };
}

export async function generateContactSheets({
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  outputRoot = null,
  character = null,
  variant = null,
  batchSize = DEFAULT_BATCH_SIZE,
  concurrency = DEFAULT_CONCURRENCY,
  clean = true,
} = {}) {
  runtimeRoot = path.resolve(runtimeRoot);
  outputRoot = path.resolve(outputRoot || (character
    ? path.join(DEFAULT_OUTPUT_ROOT, 'selections', safePart(character), safePart(variant || 'all'))
    : DEFAULT_OUTPUT_ROOT));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('batchSize must be an integer from 1 to 64');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be an integer from 1 to 16');
  const variants = await discoverVariants(runtimeRoot, character, variant);
  if (variants.length === 0) throw new Error(`No runtime manifests found below ${runtimeRoot}`);
  if (clean) {
    assertSafeCleanTarget(outputRoot, runtimeRoot);
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
  await fs.mkdir(outputRoot, { recursive: true });

  const qa = { source_atlases_checked: 0, crop_violations: 0, alpha_violations: 0 };
  const coveragePages = [];
  const animationStripPages = [];
  const pageCount = Math.ceil(variants.length / batchSize);
  for (let offset = 0; offset < variants.length; offset += batchSize) {
    const batch = variants.slice(offset, offset + batchSize);
    const atlasCache = new Map();
    for (const entry of batch) {
      atlasCache.set(`${entry.characterId}/${entry.variantId}`, await loadAtlases(entry, qa));
    }
    coveragePages.push(await renderCoveragePage(
      batch,
      Math.floor(offset / batchSize) + 1,
      pageCount,
      outputRoot,
      atlasCache,
    ));
    const batchStrips = new Array(batch.length);
    let cursor = 0;
    async function renderWorker() {
      while (cursor < batch.length) {
        const index = cursor++;
        const entry = batch[index];
        batchStrips[index] = await renderAnimationStripPage(
          entry,
          outputRoot,
          atlasCache.get(`${entry.characterId}/${entry.variantId}`),
        );
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, batch.length) },
      () => renderWorker(),
    ));
    animationStripPages.push(...batchStrips);
  }

  const manifest = {
    schema_version: 1,
    generated_from: relativePosix(REPO_ROOT, runtimeRoot),
    selection: { character, variant },
    format: 'webp',
    variants: variants.length,
    coverage: {
      representative_states: COVERAGE_STATES.map((state) => state.label),
      batch_size: batchSize,
      page_count: coveragePages.length,
      pages: coveragePages,
    },
    animation_strips: {
      page_count: animationStripPages.length,
      animation_count: animationStripPages.reduce((sum, page) => sum + page.animations.length, 0),
      pages: animationStripPages,
    },
    quality: {
      ...qa,
      output_pages: coveragePages.length + animationStripPages.length,
      transparent_background: true,
      hidden_rgb_zero: true,
      representative_frame_crop: 'contained-within-96x112-cell',
    },
  };
  await fs.writeFile(path.join(outputRoot, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`OK: standalone contact sheets (${variants.length} variants, ${coveragePages.length} coverage pages, ${animationStripPages.length} animation strip pages)`);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const batchSize = Number(option(args, '--batch-size', String(DEFAULT_BATCH_SIZE)));
  const concurrency = Number(option(args, '--concurrency', String(DEFAULT_CONCURRENCY)));
  if (!Number.isInteger(batchSize)) throw new Error('--batch-size must be an integer');
  if (!Number.isInteger(concurrency)) throw new Error('--concurrency must be an integer');
  const character = option(args, '--character');
  const variant = option(args, '--variant', option(args, '--skin'));
  const requestedOutput = option(args, '--output');
  await generateContactSheets({
    runtimeRoot: option(args, '--runtime-root', DEFAULT_RUNTIME_ROOT),
    outputRoot: requestedOutput || (character
      ? path.join(DEFAULT_OUTPUT_ROOT, 'selections', safePart(character), safePart(variant || 'all'))
      : DEFAULT_OUTPUT_ROOT),
    character,
    variant,
    batchSize,
    concurrency,
    clean: !args.includes('--no-clean'),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`contact-sheets: ${error.message}`);
    process.exitCode = 1;
  });
}
