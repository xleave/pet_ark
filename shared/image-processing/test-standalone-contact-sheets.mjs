#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { generateContactSheets } from './generate-standalone-contact-sheets.mjs';
import { validateContactSheets } from './validate-standalone-contact-sheets.mjs';

const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 56;
const SOURCE_NAMES = ['relax', 'move', 'interact', 'sit', 'sleep'];

async function makeAtlas(file, sourceIndex) {
  const frames = [];
  for (let frame = 0; frame < 4; frame++) {
    const color = {
      r: 20 + sourceIndex * 30,
      g: 30 + frame * 40,
      b: 80 + sourceIndex * 20,
      alpha: 255,
    };
    const input = await sharp({
      create: {
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: FRAME_WIDTH - 8,
          height: FRAME_HEIGHT - 8,
          channels: 4,
          background: color,
        },
      },
      left: 4,
      top: 4,
    }]).png().toBuffer();
    frames.push({ input, left: frame * FRAME_WIDTH, top: 0 });
  }
  await sharp({
    create: {
      width: FRAME_WIDTH * 4,
      height: FRAME_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(frames).png().toFile(file);
}

function animation(source, { mirror = false, order = [0, 1, 2, 3], loop = true } = {}) {
  return {
    source,
    sheet: `${source}.png`,
    frameOrder: order,
    fps: 12,
    loop,
    mirror,
    holdLast: false,
    next: null,
    generatedFrames: [],
  };
}

async function makeVariant(runtimeRoot, variantId, variantName) {
  const root = path.join(runtimeRoot, 'fixture-character', variantId);
  await fs.mkdir(root, { recursive: true });
  for (let index = 0; index < SOURCE_NAMES.length; index++) {
    await makeAtlas(path.join(root, `${SOURCE_NAMES[index]}.png`), index);
  }
  const sources = Object.fromEntries(SOURCE_NAMES.map((name) => [name, {
    sheet: `${name}.png`,
    frames: 4,
    sourceFrames: 4,
    generatedFrames: 0,
    columns: 4,
    rows: 1,
    hitboxes: Array.from({ length: 4 }, () => ({ x: 4, y: 4, width: 40, height: 48 })),
  }]));
  const manifest = {
    schemaVersion: 2,
    character: { id: 'fixture-character', name: 'Fixture Character', localizedName: '测试角色' },
    variant: { id: variantId, type: variantId === 'default' ? 'base_form' : 'skin', name: variantName, localizedName: variantName },
    frameSize: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    sources,
    animations: {
      idle: animation('relax'),
      'walk-left': animation('move', { mirror: true }),
      'walk-right': animation('move'),
      clicked: animation('interact', { loop: false }),
      'picked-up': animation('sit', { order: [0, 1, 2], loop: false }),
      dragging: animation('sit', { order: [2, 3] }),
      dropped: animation('sit', { order: [3, 2, 1, 0], loop: false }),
      rest: animation('sit'),
      sleep: animation('sleep', { loop: false }),
      wake: animation('sleep', { order: [3, 2, 1, 0], loop: false }),
      special: animation('interact', { order: [1, 2, 3, 2], loop: false }),
    },
  };
  await fs.writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function assertTransparentWebp(file, width, height) {
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.hasAlpha, true);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, `${path.basename(file)} top-left pixel must stay transparent`);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      assert.deepEqual([...data.subarray(index, index + 3)], [0, 0, 0], `${path.basename(file)} hidden RGB must be zero`);
    }
  }
}

async function assertSparseHeader(file) {
  const { data, info } = await sharp(file)
    .extract({ left: 0, top: 0, width: (await sharp(file).metadata()).width, height: 64 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let index = 3; index < data.length; index += info.channels) if (data[index] !== 0) visible++;
  const ratio = visible / (info.width * info.height);
  assert.ok(ratio > 0.005, `${path.basename(file)} header title must be visible`);
  assert.ok(ratio < 0.2, `${path.basename(file)} header must not become an opaque block (${ratio})`);
}

async function assertCoveragePreviewsDoNotOverlap(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tileLeft = 24;
  const tileTop = 68 + 24;
  const previewTop = tileTop + 66;
  const previewHeight = Math.round(112 * 64 / 96);
  const sampleY = previewTop + Math.floor(previewHeight / 2);
  // Five 64px previews are centered in independent 72px slots. The fixture's
  // opaque body would join neighboring previews at these mid-gap pixels if a
  // full 96px strip thumbnail were composited into every slot.
  for (let gap = 0; gap < 4; gap++) {
    const sampleX = tileLeft + 84 + gap * 72;
    const alpha = data[(sampleY * info.width + sampleX) * info.channels + 3];
    assert.ok(alpha < 250, `coverage previews ${gap} and ${gap + 1} overlap at x=${sampleX}`);
  }
}

async function writeTransparentFixture(file, width, height, { visibleBelowHeader = false } = {}) {
  let image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  if (visibleBelowHeader) {
    image = image.composite([{
      input: {
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 180, g: 40, b: 30, alpha: 255 },
        },
      },
      left: 16,
      top: 80,
    }]);
  }
  await image.webp({ lossless: true, alphaQuality: 100 }).toFile(file);
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-ark-contact-sheets-'));
try {
  const runtimeRoot = path.join(temporary, 'runtime');
  const outputRoot = path.join(temporary, 'output');
  const rosterPath = path.join(temporary, 'roster.json');
  await makeVariant(runtimeRoot, 'default', '默认');
  await makeVariant(runtimeRoot, 'skin-test', '测试皮肤');
  await fs.writeFile(rosterPath, `${JSON.stringify({
    schema_version: 1,
    statistics: { expected_variants: 2 },
    characters: [{
      character_id: 'fixture-character',
      default_variant_id: 'default',
      variants: [
        { variant_id: 'default' },
        { variant_id: 'skin-test' },
      ],
    }],
  }, null, 2)}\n`);

  await assert.rejects(
    generateContactSheets({ runtimeRoot, outputRoot: temporary, batchSize: 1 }),
    /refusing to recursively clean unsafe contact-sheet output/,
  );
  await assert.rejects(
    generateContactSheets({
      runtimeRoot,
      outputRoot: path.join(runtimeRoot, 'fixture-character', 'default', 'contact-output'),
      batchSize: 1,
    }),
    /refusing to recursively clean unsafe contact-sheet output/,
  );

  const result = await generateContactSheets({ runtimeRoot, outputRoot, batchSize: 1 });
  assert.equal(result.variants, 2);
  assert.equal(result.coverage.page_count, 2);
  assert.equal(result.animation_strips.page_count, 2);
  assert.equal(result.animation_strips.animation_count, 22);
  assert.equal(result.quality.source_atlases_checked, 10);
  assert.equal(result.quality.crop_violations, 0);
  assert.equal(result.quality.alpha_violations, 0);
  assert.equal(result.quality.output_pages, 4);

  const index = JSON.parse(await fs.readFile(path.join(outputRoot, 'index.json'), 'utf8'));
  assert.equal(index.schema_version, 1);
  assert.deepEqual(index.coverage.representative_states, ['idle', 'move', 'interaction', 'rest/sleep', 'special']);
  assert.equal(index.coverage.pages[0].variants[0].states[0].frame, 1, 'representative frame must be the actual middle frameOrder entry');

  const expectedPaths = [
    path.join(outputRoot, 'coverage', '001.webp'),
    path.join(outputRoot, 'coverage', '002.webp'),
    path.join(outputRoot, 'animation-strips', 'fixture-character', 'default.webp'),
    path.join(outputRoot, 'animation-strips', 'fixture-character', 'skin-test.webp'),
  ];
  for (const file of expectedPaths) assert.ok((await fs.stat(file)).size > 0, `${file} must exist and be non-empty`);

  const coveragePage = result.coverage.pages[0];
  await assertTransparentWebp(expectedPaths[0], coveragePage.width, coveragePage.height);
  const stripPage = result.animation_strips.pages[0];
  await assertTransparentWebp(expectedPaths[2], stripPage.width, stripPage.height);
  await assertSparseHeader(expectedPaths[0]);
  await assertSparseHeader(expectedPaths[2]);
  await assertCoveragePreviewsDoNotOverlap(expectedPaths[0]);

  // The first coverage preview is idle frameOrder[1]. Its center must retain
  // the fixture's second-frame color, proving atlas extraction is not cropped
  // or accidentally replaced by the first frame.
  const { data, info } = await sharp(expectedPaths[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sampleX = 24 + 48;
  const sampleY = 68 + 24 + 66 + Math.floor(Math.round(112 * 64 / 96) / 2);
  const sample = (sampleY * info.width + sampleX) * 4;
  assert.deepEqual([...data.subarray(sample, sample + 4)], [20, 70, 80, 255]);

  const validation = await validateContactSheets({
    runtimeRoot,
    rosterPath,
    outputRoot,
    concurrency: 2,
  });
  assert.deepEqual(validation, {
    variants: 2,
    coverage_pages: 2,
    animation_strip_pages: 2,
    animation_sequences: 22,
    webp_pages_checked: 4,
    hidden_rgb_violations: 0,
  });

  const originalCoveragePage = await fs.readFile(expectedPaths[0]);
  await writeTransparentFixture(expectedPaths[0], coveragePage.width, coveragePage.height);
  await assert.rejects(
    validateContactSheets({ runtimeRoot, rosterPath, outputRoot, concurrency: 1 }),
    /WebP is fully transparent/,
  );
  await fs.writeFile(expectedPaths[0], originalCoveragePage);

  await writeTransparentFixture(expectedPaths[0], coveragePage.width, coveragePage.height, { visibleBelowHeader: true });
  await assert.rejects(
    validateContactSheets({ runtimeRoot, rosterPath, outputRoot, concurrency: 1 }),
    /WebP has no visible page header/,
  );
  await fs.writeFile(expectedPaths[0], originalCoveragePage);

  index.animation_strips.pages[0].animations[0].frame_count = 99;
  await fs.writeFile(path.join(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  await assert.rejects(
    validateContactSheets({ runtimeRoot, rosterPath, outputRoot }),
    /strip frame_count=99, runtime=4/,
  );
  index.animation_strips.pages[0].animations[0].frame_count = 4;
  await fs.writeFile(path.join(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const orphanedPartial = path.join(outputRoot, 'animation-strips', 'orphaned.partial.png');
  await fs.writeFile(orphanedPartial, originalCoveragePage);
  await assert.rejects(
    validateContactSheets({ runtimeRoot, rosterPath, outputRoot }),
    /unindexed pages \[animation-strips\/orphaned\.partial\.png\]/,
  );
  await fs.rm(orphanedPartial);

  const singleOutput = path.join(temporary, 'selected-output');
  const selected = await generateContactSheets({
    runtimeRoot,
    outputRoot: singleOutput,
    character: 'fixture-character',
    variant: 'skin-test',
  });
  assert.equal(selected.variants, 1);
  assert.equal(selected.animation_strips.pages[0].variant_id, 'skin-test');

  const skinManifestPath = path.join(runtimeRoot, 'fixture-character', 'skin-test', 'manifest.json');
  const skinManifest = JSON.parse(await fs.readFile(skinManifestPath, 'utf8'));
  skinManifest.sources.relax.sheet = '../default/relax.png';
  await fs.writeFile(skinManifestPath, `${JSON.stringify(skinManifest, null, 2)}\n`);
  await assert.rejects(
    generateContactSheets({
      runtimeRoot,
      outputRoot: path.join(temporary, 'cross-variant-output'),
      character: 'fixture-character',
      variant: 'skin-test',
    }),
    /source sheet leaves its variant directory/,
  );

  console.log('OK: standalone contact-sheet generator (paths, dimensions, counts, alpha, representative crop)');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
