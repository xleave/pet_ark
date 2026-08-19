#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_RUNTIME_ROOT = path.join(REPO_ROOT, 'standalone', 'assets', 'runtime');
const DEFAULT_ROSTER_PATH = path.join(REPO_ROOT, 'shared', 'character-data', 'standalone-roster.json');
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, 'standalone', 'dist', 'contact-sheets');
const DEFAULT_CONCURRENCY = 4;
const HEADER_HEIGHT = 64;
const MIN_HEADER_VISIBLE_RATIO = 0.005;
const MAX_HEADER_VISIBLE_RATIO = 0.2;

const COVERAGE_STATES = [
  { label: 'idle', candidates: ['idle'] },
  { label: 'move', candidates: ['walk-right', 'walk-left', 'run-right', 'run-left'] },
  { label: 'interaction', candidates: ['clicked', 'interaction', 'interact'] },
  { label: 'rest/sleep', candidates: ['sleep', 'rest'] },
  { label: 'special', candidates: ['special'] },
];
const COVERAGE_LABELS = COVERAGE_STATES.map((state) => state.label);

function option(args, name, fallback = null) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function usage() {
  console.log(`Usage: node shared/image-processing/validate-standalone-contact-sheets.mjs [options]

Options:
  --runtime-root <dir> Runtime asset tree (default: standalone/assets/runtime)
  --roster <file>      Expected character/variant roster
  --output <dir>       Contact-sheet root (default: standalone/dist/contact-sheets)
  --index <file>       Contact-sheet index (default: <output>/index.json)
  --concurrency <n>    WebP decode workers (default: ${DEFAULT_CONCURRENCY})
  --help               Show this help`);
}

function relativePosix(from, target) {
  return path.relative(from, target).split(path.sep).join('/');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${relativePosix(REPO_ROOT, file)}: ${error.message}`);
  }
}

function identity(characterId, variantId) {
  return `${characterId}/${variantId}`;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: expected a non-empty string`);
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}: expected a positive integer`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`);
  return value;
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: index and runtime manifest differ`);
  }
}

function collectRosterVariants(roster) {
  const expected = new Map();
  for (const character of requireArray(roster.characters, 'roster.characters')) {
    const characterId = requireString(character.character_id, 'roster character_id');
    for (const variant of requireArray(character.variants, `${characterId}: roster variants`)) {
      if (['source-unavailable', 'source-incomplete', 'authorization-blocked', 'blocked'].includes(variant.status)) continue;
      const variantId = requireString(variant.variant_id, `${characterId}: roster variant_id`);
      const key = identity(characterId, variantId);
      if (expected.has(key)) throw new Error(`roster contains duplicate variant ${key}`);
      expected.set(key, { characterId, variantId });
    }
  }
  const declared = roster.statistics?.source_available_variants ?? roster.statistics?.expected_variants;
  if (declared !== undefined && declared !== expected.size) {
    throw new Error(`roster statistics source_available_variants=${declared}, found ${expected.size}`);
  }
  if (expected.size === 0) throw new Error('roster contains no variants');
  return expected;
}

async function discoverRuntimeVariants(runtimeRoot) {
  const variants = new Map();
  let characterEntries;
  try {
    characterEntries = await fs.readdir(runtimeRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`${relativePosix(REPO_ROOT, runtimeRoot)}: ${error.message}`);
  }
  for (const characterEntry of characterEntries.filter((entry) => entry.isDirectory())) {
    const characterRoot = path.join(runtimeRoot, characterEntry.name);
    const variantEntries = await fs.readdir(characterRoot, { withFileTypes: true });
    for (const variantEntry of variantEntries.filter((entry) => entry.isDirectory())) {
      const manifestPath = path.join(characterRoot, variantEntry.name, 'manifest.json');
      const manifest = await readJson(manifestPath);
      const characterId = requireString(manifest.character?.id, `${relativePosix(REPO_ROOT, manifestPath)} character.id`);
      const variantId = requireString(manifest.variant?.id || 'default', `${relativePosix(REPO_ROOT, manifestPath)} variant.id`);
      if (characterId !== characterEntry.name || variantId !== variantEntry.name) {
        throw new Error(`${relativePosix(REPO_ROOT, manifestPath)}: path and manifest identity differ`);
      }
      const key = identity(characterId, variantId);
      if (variants.has(key)) throw new Error(`runtime contains duplicate variant ${key}`);
      variants.set(key, { characterId, variantId, manifestPath, manifest });
    }
  }
  return variants;
}

function assertSameIdentitySet(actual, expected, label) {
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const extra = [...actual.keys()].filter((key) => !expected.has(key));
  if (missing.length || extra.length) {
    const describe = (items) => items.slice(0, 8).join(', ') + (items.length > 8 ? ` (+${items.length - 8})` : '');
    throw new Error(`${label}: missing [${describe(missing)}], extra [${describe(extra)}]`);
  }
}

function resolveIndexedPath(outputRoot, relativePath, label) {
  requireString(relativePath, `${label}.path`);
  if (path.extname(relativePath).toLowerCase() !== '.webp') throw new Error(`${label}: indexed path is not WebP: ${relativePath}`);
  const resolved = path.resolve(outputRoot, relativePath);
  if (!resolved.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`${label}: indexed path leaves output root: ${relativePath}`);
  return resolved;
}

async function listFiles(root, extension = null) {
  const result = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && (!extension || path.extname(entry.name).toLowerCase() === extension)) result.push(target);
    }
  }
  await visit(root);
  return result;
}

function assertPathSet(actualFiles, indexedFiles, outputRoot, label) {
  const actual = new Set(actualFiles.map((file) => relativePosix(outputRoot, file)));
  const indexed = new Set(indexedFiles.map((file) => relativePosix(outputRoot, file)));
  const missing = [...indexed].filter((file) => !actual.has(file));
  const extra = [...actual].filter((file) => !indexed.has(file));
  if (missing.length || extra.length) {
    throw new Error(`${label}: missing indexed pages [${missing.join(', ')}], unindexed pages [${extra.join(', ')}]`);
  }
}

async function inspectWebp({ file, width, height, label }) {
  requirePositiveInteger(width, `${label}.width`);
  requirePositiveInteger(height, `${label}.height`);
  let encoded;
  let metadata;
  try {
    encoded = await fs.readFile(file);
    metadata = await sharp(encoded).metadata();
  } catch (error) {
    throw new Error(`${label}: cannot decode ${relativePosix(REPO_ROOT, file)} (${error.message})`);
  }
  if (metadata.format !== 'webp') throw new Error(`${label}: ${relativePosix(REPO_ROOT, file)} is ${metadata.format || 'unknown'}, expected WebP`);
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(`${label}: ${metadata.width}x${metadata.height}, index declares ${width}x${height}`);
  }
  if (!metadata.hasAlpha) throw new Error(`${label}: WebP has no alpha channel`);
  const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let visiblePixels = 0;
  let headerVisiblePixels = 0;
  let hiddenRgb = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] !== 0) {
      visiblePixels++;
      if (offset / info.channels < info.width * Math.min(HEADER_HEIGHT, info.height)) headerVisiblePixels++;
    } else {
      transparentPixels++;
      if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0) hiddenRgb++;
    }
  }
  if (visiblePixels === 0) throw new Error(`${label}: WebP is fully transparent`);
  if (transparentPixels === 0) throw new Error(`${label}: WebP contains no transparent background pixels`);
  if (hiddenRgb !== 0) throw new Error(`${label}: ${hiddenRgb} transparent pixels contain hidden RGB`);
  const headerPixels = info.width * Math.min(HEADER_HEIGHT, info.height);
  const headerVisibleRatio = headerVisiblePixels / headerPixels;
  if (headerVisibleRatio < MIN_HEADER_VISIBLE_RATIO) {
    throw new Error(`${label}: WebP has no visible page header (${headerVisibleRatio.toFixed(3)} visible ratio)`);
  }
  if (headerVisibleRatio > MAX_HEADER_VISIBLE_RATIO) {
    throw new Error(`${label}: WebP page header is unexpectedly opaque (${headerVisibleRatio.toFixed(3)} visible ratio)`);
  }
}

async function mapLimit(items, concurrency, worker) {
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
}

export async function validateContactSheets({
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  rosterPath = DEFAULT_ROSTER_PATH,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  indexPath = null,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  runtimeRoot = path.resolve(runtimeRoot);
  rosterPath = path.resolve(rosterPath);
  outputRoot = path.resolve(outputRoot);
  indexPath = path.resolve(indexPath || path.join(outputRoot, 'index.json'));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('concurrency must be an integer from 1 to 16');
  }

  const [roster, index, runtimeVariants] = await Promise.all([
    readJson(rosterPath),
    readJson(indexPath),
    discoverRuntimeVariants(runtimeRoot),
  ]);
  const expectedVariants = collectRosterVariants(roster);
  assertSameIdentitySet(runtimeVariants, expectedVariants, 'runtime/roster variant set');

  if (index.schema_version !== 1) throw new Error(`contact-sheet index schema_version=${index.schema_version}, expected 1`);
  if (index.format !== 'webp') throw new Error(`contact-sheet index format=${index.format}, expected webp`);
  if (index.selection?.character !== null || index.selection?.variant !== null) {
    throw new Error('contact-sheet index is a filtered selection, not the complete roster');
  }
  if (index.variants !== expectedVariants.size) {
    throw new Error(`contact-sheet index variants=${index.variants}, expected ${expectedVariants.size}`);
  }
  const generatedFrom = path.resolve(REPO_ROOT, requireString(index.generated_from, 'index.generated_from'));
  if (generatedFrom !== runtimeRoot) {
    throw new Error(`contact-sheet index generated_from resolves to ${generatedFrom}, expected ${runtimeRoot}`);
  }
  assertJsonEqual(index.coverage?.representative_states, COVERAGE_LABELS, 'coverage representative_states');
  const batchSize = requirePositiveInteger(index.coverage?.batch_size, 'coverage.batch_size');
  const coveragePages = requireArray(index.coverage?.pages, 'coverage.pages');
  if (index.coverage?.page_count !== coveragePages.length) {
    throw new Error(`coverage page_count=${index.coverage?.page_count}, pages=${coveragePages.length}`);
  }
  const expectedCoveragePages = Math.ceil(expectedVariants.size / batchSize);
  if (coveragePages.length !== expectedCoveragePages) {
    throw new Error(`coverage pages=${coveragePages.length}, expected ${expectedCoveragePages} for ${expectedVariants.size} variants at batch_size ${batchSize}`);
  }

  const indexedPaths = new Set();
  const imageJobs = [];
  const coverageIdentities = new Map();
  const coverageFiles = [];
  for (let pageIndex = 0; pageIndex < coveragePages.length; pageIndex++) {
    const page = coveragePages[pageIndex];
    const label = `coverage.pages[${pageIndex}]`;
    const file = resolveIndexedPath(outputRoot, page.path, label);
    if (!relativePosix(outputRoot, file).startsWith('coverage/')) throw new Error(`${label}: path must be below coverage/`);
    if (indexedPaths.has(file)) throw new Error(`${label}: duplicate indexed path ${page.path}`);
    indexedPaths.add(file);
    coverageFiles.push(file);
    imageJobs.push({ file, width: page.width, height: page.height, label });
    const variants = requireArray(page.variants, `${label}.variants`);
    if (variants.length < 1 || variants.length > batchSize) throw new Error(`${label}: invalid variant count ${variants.length}`);
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
      const entry = variants[variantIndex];
      const key = identity(
        requireString(entry.character_id, `${label}.variants[${variantIndex}].character_id`),
        requireString(entry.variant_id, `${label}.variants[${variantIndex}].variant_id`),
      );
      if (coverageIdentities.has(key)) throw new Error(`coverage repeats variant ${key}`);
      const runtime = runtimeVariants.get(key);
      if (!runtime) throw new Error(`coverage contains unknown variant ${key}`);
      const states = requireArray(entry.states, `${key}: coverage states`);
      assertJsonEqual(states.map((state) => state.label), COVERAGE_LABELS, `${key}: coverage state labels`);
      for (let stateIndex = 0; stateIndex < COVERAGE_STATES.length; stateIndex++) {
        const state = states[stateIndex];
        const expectedState = COVERAGE_STATES[stateIndex];
        if (!expectedState.candidates.includes(state.animation)) {
          throw new Error(`${key}:${state.label}: unexpected representative animation ${state.animation}`);
        }
        const animation = runtime.manifest.animations?.[state.animation];
        if (!animation) throw new Error(`${key}:${state.label}: runtime animation ${state.animation} is missing`);
        if (state.source !== animation.source) throw new Error(`${key}:${state.label}: source differs from runtime manifest`);
        const frameOrder = requireArray(animation.frameOrder, `${key}:${state.animation}.frameOrder`);
        if (frameOrder.length === 0) throw new Error(`${key}:${state.animation}: empty frameOrder`);
        const representative = frameOrder[Math.floor((frameOrder.length - 1) / 2)];
        if (state.frame !== representative) throw new Error(`${key}:${state.label}: representative frame=${state.frame}, expected ${representative}`);
      }
      coverageIdentities.set(key, entry);
    }
  }
  assertSameIdentitySet(coverageIdentities, expectedVariants, 'coverage/roster variant set');

  const stripPages = requireArray(index.animation_strips?.pages, 'animation_strips.pages');
  if (index.animation_strips?.page_count !== stripPages.length) {
    throw new Error(`animation_strips page_count=${index.animation_strips?.page_count}, pages=${stripPages.length}`);
  }
  if (stripPages.length !== expectedVariants.size) {
    throw new Error(`animation strip pages=${stripPages.length}, expected ${expectedVariants.size}`);
  }
  const stripIdentities = new Map();
  const stripFiles = [];
  let animationCount = 0;
  for (let pageIndex = 0; pageIndex < stripPages.length; pageIndex++) {
    const page = stripPages[pageIndex];
    const label = `animation_strips.pages[${pageIndex}]`;
    const file = resolveIndexedPath(outputRoot, page.path, label);
    if (!relativePosix(outputRoot, file).startsWith('animation-strips/')) throw new Error(`${label}: path must be below animation-strips/`);
    if (indexedPaths.has(file)) throw new Error(`${label}: duplicate indexed path ${page.path}`);
    indexedPaths.add(file);
    stripFiles.push(file);
    imageJobs.push({ file, width: page.width, height: page.height, label });
    const key = identity(
      requireString(page.character_id, `${label}.character_id`),
      requireString(page.variant_id, `${label}.variant_id`),
    );
    if (stripIdentities.has(key)) throw new Error(`animation strips repeat variant ${key}`);
    const runtime = runtimeVariants.get(key);
    if (!runtime) throw new Error(`animation strips contain unknown variant ${key}`);
    const indexedAnimations = requireArray(page.animations, `${key}: strip animations`);
    const runtimeAnimations = runtime.manifest.animations || {};
    if (indexedAnimations.length !== Object.keys(runtimeAnimations).length) {
      throw new Error(`${key}: strip animation count=${indexedAnimations.length}, runtime=${Object.keys(runtimeAnimations).length}`);
    }
    const seenAnimations = new Set();
    for (let animationIndex = 0; animationIndex < indexedAnimations.length; animationIndex++) {
      const indexed = indexedAnimations[animationIndex];
      const animationName = requireString(indexed.animation, `${key}: strip animation name`);
      if (seenAnimations.has(animationName)) throw new Error(`${key}: strip repeats animation ${animationName}`);
      seenAnimations.add(animationName);
      const runtimeAnimation = runtimeAnimations[animationName];
      if (!runtimeAnimation) throw new Error(`${key}: strip contains unknown animation ${animationName}`);
      const runtimeFrameOrder = requireArray(runtimeAnimation.frameOrder, `${key}:${animationName}.frameOrder`);
      if (indexed.frame_count !== runtimeFrameOrder.length) {
        throw new Error(`${key}:${animationName}: strip frame_count=${indexed.frame_count}, runtime=${runtimeFrameOrder.length}`);
      }
      if (indexed.source !== runtimeAnimation.source) throw new Error(`${key}:${animationName}: source differs from runtime manifest`);
      if (indexed.sheet !== runtimeAnimation.sheet) throw new Error(`${key}:${animationName}: sheet differs from runtime manifest`);
      assertJsonEqual(indexed.frame_order, runtimeFrameOrder, `${key}:${animationName}.frame_order`);
      if (indexed.fps !== runtimeAnimation.fps) throw new Error(`${key}:${animationName}: fps differs from runtime manifest`);
      if (indexed.loop !== Boolean(runtimeAnimation.loop)) throw new Error(`${key}:${animationName}: loop differs from runtime manifest`);
      if (indexed.mirror !== Boolean(runtimeAnimation.mirror)) throw new Error(`${key}:${animationName}: mirror differs from runtime manifest`);
      if (indexed.fallback !== (runtimeAnimation.fallback || null)) throw new Error(`${key}:${animationName}: fallback differs from runtime manifest`);
      assertJsonEqual(indexed.generated_frames, runtimeAnimation.generatedFrames || [], `${key}:${animationName}.generated_frames`);
    }
    animationCount += indexedAnimations.length;
    stripIdentities.set(key, page);
  }
  assertSameIdentitySet(stripIdentities, expectedVariants, 'animation-strips/roster variant set');
  if (index.animation_strips?.animation_count !== animationCount) {
    throw new Error(`animation_strips animation_count=${index.animation_strips?.animation_count}, indexed=${animationCount}`);
  }

  if (index.quality?.output_pages !== imageJobs.length) {
    throw new Error(`quality.output_pages=${index.quality?.output_pages}, indexed=${imageJobs.length}`);
  }
  if (index.quality?.transparent_background !== true || index.quality?.hidden_rgb_zero !== true) {
    throw new Error('contact-sheet index quality must declare transparent_background and hidden_rgb_zero');
  }
  const [actualCoverageFiles, actualStripFiles] = await Promise.all([
    listFiles(path.join(outputRoot, 'coverage'), '.webp'),
    listFiles(path.join(outputRoot, 'animation-strips'), '.webp'),
  ]);
  assertPathSet(actualCoverageFiles, coverageFiles, outputRoot, 'coverage WebP set');
  assertPathSet(actualStripFiles, stripFiles, outputRoot, 'animation strip WebP set');
  const actualOutputFiles = await listFiles(outputRoot);
  const expectedOutputFiles = [indexPath, ...imageJobs.map((job) => job.file)];
  assertPathSet(actualOutputFiles, expectedOutputFiles, outputRoot, 'contact-sheet output file set');

  await mapLimit(imageJobs, concurrency, inspectWebp);
  const summary = {
    variants: expectedVariants.size,
    coverage_pages: coveragePages.length,
    animation_strip_pages: stripPages.length,
    animation_sequences: animationCount,
    webp_pages_checked: imageJobs.length,
    hidden_rgb_violations: 0,
  };
  console.log(`OK: standalone contact sheets validated (${summary.variants} variants, ${summary.coverage_pages} coverage pages, ${summary.animation_strip_pages} strips, ${summary.animation_sequences} animations)`);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const concurrency = Number(option(args, '--concurrency', String(DEFAULT_CONCURRENCY)));
  if (!Number.isInteger(concurrency)) throw new Error('--concurrency must be an integer');
  const outputRoot = path.resolve(option(args, '--output', DEFAULT_OUTPUT_ROOT));
  await validateContactSheets({
    runtimeRoot: option(args, '--runtime-root', DEFAULT_RUNTIME_ROOT),
    rosterPath: option(args, '--roster', DEFAULT_ROSTER_PATH),
    outputRoot,
    indexPath: option(args, '--index', path.join(outputRoot, 'index.json')),
    concurrency,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`contact-sheet validation: ${error.message}`);
    process.exitCode = 1;
  });
}
