#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qualityPath = path.join(root, 'standalone/dist/asset-quality.json');
const planPath = path.join(root, 'standalone/dist/spine-repair-plan.json');
const exporter = path.join(root, 'shared/asset-tools/export-prts-spine.mjs');
const preparer = path.join(root, 'shared/image-processing/prepare-standalone-assets.mjs');
const runtimeRoot = path.join(root, 'standalone/assets/runtime');

function option(name, fallback = null) {
  const inline = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function positiveInteger(name, fallback, maximum = 32) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(root, file)}: ${error.message}`);
  }
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} was terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${path.basename(command)} exited with ${code}${capture ? `: ${Buffer.concat(stderr).toString('utf8').trim()}` : ''}`));
      else resolve(capture ? Buffer.concat(stdout).toString('utf8') : undefined);
    });
  });
}

async function bounded(items, concurrency, operation) {
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await operation(items[index], index);
      completed++;
      if (completed % 25 === 0 || completed === items.length) {
        process.stdout.write(`\rprocessed ${completed}/${items.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function parseInspection(output, identity) {
  const first = output.indexOf('{');
  const last = output.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error(`${identity}: exporter inspection did not return JSON`);
  try {
    return JSON.parse(output.slice(first, last + 1));
  } catch (error) {
    throw new Error(`${identity}: invalid exporter inspection JSON: ${error.message}`);
  }
}

async function createPlan() {
  const quality = await readJson(qualityPath);
  const severities = new Set(option('--severity', 'critical,high,review').split(',').map((value) => value.trim()).filter(Boolean));
  const requestedLimit = Number(option('--limit', 0));
  let candidates = quality.candidates.filter((entry) => severities.has(entry.severity));
  if (requestedLimit > 0) candidates = candidates.slice(0, requestedLimit);
  const concurrency = positiveInteger('--concurrency', 6);
  const entries = new Array(candidates.length);
  console.log(`inspecting ${candidates.length} Spine variants with concurrency ${concurrency}`);
  await bounded(candidates, concurrency, async (candidate, index) => {
    const identity = `${candidate.character}:${candidate.variant}`;
    try {
      const output = await run(process.execPath, [exporter, '--character', candidate.character, '--variant', candidate.variant, '--inspect'], { capture: true });
      const inspection = parseInspection(output, identity);
      const predictedScale = Number(inspection.placement?.scale || 0);
      const scaleGain = candidate.scale > 0 ? predictedScale / candidate.scale : 0;
      const repairable = scaleGain >= 1.2;
      entries[index] = {
        ...candidate,
        predicted_scale: Number(predictedScale.toFixed(5)),
        scale_gain: Number(scaleGain.toFixed(3)),
        predicted_policy: inspection.placement?.bounds_policy ?? 'unknown',
        action: repairable ? 'rebuild' : 'manual-review',
      };
    } catch (error) {
      entries[index] = { ...candidate, action: 'inspection-failed', error: error.message };
    }
  });
  const summary = {
    selected: entries.length,
    rebuild: entries.filter((entry) => entry.action === 'rebuild').length,
    manual_review: entries.filter((entry) => entry.action === 'manual-review').length,
    inspection_failed: entries.filter((entry) => entry.action === 'inspection-failed').length,
  };
  const plan = {
    schema_version: 1,
    source: path.relative(root, qualityPath),
    policy: 'rebuild when the current exporter increases render scale by at least 20%; the selected full/core envelope remains audited in each manifest',
    summary,
    entries,
  };
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`repair plan: rebuild=${summary.rebuild}, manual=${summary.manual_review}, failed=${summary.inspection_failed}`);
  console.log(`wrote ${path.relative(root, planPath)}`);
  return plan;
}

async function replaceDirectory(source, destination) {
  try {
    await fs.access(path.dirname(destination));
  } catch {
    return;
  }
  const temporary = `${destination}.partial-${process.pid}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.cp(source, temporary, { recursive: true, force: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(temporary, destination);
}

async function syncMetadata() {
  await run(process.execPath, [path.join(root, 'shared/image-processing/sync-generated-motion-manifest.mjs')]);
  await run(process.execPath, [path.join(root, 'shared/image-processing/build-runtime-registry.mjs')]);
  await run(process.execPath, [path.join(root, 'shared/asset-tools/generate-standalone-registry.mjs')]);
  const registry = await readJson(path.join(root, 'standalone/characters/registry.json'));
  const packagedRegistry = {
    ...registry,
    characters: registry.characters.map((character) => ({
      ...character,
      variants: character.variants.map((variant) => ({
        ...variant,
        assets: variant.assets.replace(/^standalone\/assets\/runtime\/?/, 'assets/runtime/'),
      })),
    })),
  };
  const copies = [
    ['standalone/characters/registry.json', 'standalone/dist/manifests/registry.json'],
    ['standalone/characters/registry.json', 'standalone/dist/registry/characters.json'],
    ['shared/character-data/standalone-roster.json', 'standalone/dist/manifests/roster.json'],
  ];
  for (const [source, destination] of copies) {
    await fs.mkdir(path.dirname(path.join(root, destination)), { recursive: true });
    await fs.copyFile(path.join(root, source), path.join(root, destination));
  }
  const packagedPath = path.join(root, 'standalone/dist/app/characters/registry.json');
  try {
    await fs.access(path.dirname(packagedPath));
    await fs.writeFile(packagedPath, `${JSON.stringify(packagedRegistry, null, 2)}\n`);
  } catch {
    // The packaged tree is optional in source-only development checkouts.
  }
}

async function applyPlan(plan) {
  let rebuild = plan.entries.filter((entry) => entry.action === 'rebuild');
  const requestedLimit = Number(option('--limit', 0));
  if (requestedLimit > 0) rebuild = rebuild.slice(0, requestedLimit);
  if (!rebuild.length) {
    console.log('repair plan contains no rebuild candidates');
    return;
  }
  const concurrency = positiveInteger('--concurrency', 3);
  const succeeded = [];
  const failures = [];
  console.log(`rebuilding ${rebuild.length} confirmed variants with concurrency ${concurrency}`);
  await bounded(rebuild, concurrency, async (entry) => {
    try {
      await run(process.execPath, [exporter, '--character', entry.character, '--variant', entry.variant], { capture: true });
      await run(process.execPath, [preparer, '--character', entry.character, '--variant', entry.variant], { capture: true });
      const source = path.join(runtimeRoot, entry.character, entry.variant);
      await Promise.all([
        replaceDirectory(source, path.join(root, 'standalone/dist/characters', entry.character, entry.variant)),
        replaceDirectory(source, path.join(root, 'standalone/dist/app/assets/runtime', entry.character, entry.variant)),
      ]);
      succeeded.push({ character: entry.character, variant: entry.variant });
    } catch (error) {
      failures.push({ character: entry.character, variant: entry.variant, error: error.message });
      console.error(`FAILED ${entry.character}:${entry.variant}: ${error.message.split('\n')[0]}`);
    }
  });
  await syncMetadata();
  await run(process.execPath, [path.join(root, 'shared/image-processing/audit-standalone-asset-quality.mjs')]);
  const result = {
    schema_version: 1,
    requested: rebuild.length,
    succeeded: succeeded.length,
    failed: failures.length,
    repaired: succeeded,
    failures,
  };
  await fs.writeFile(path.join(root, 'standalone/dist/spine-repair-results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`repaired ${succeeded.length}/${rebuild.length} Spine variants; failures=${failures.length}`);
  console.log('refreshed runtime registries, quality report, and standalone/dist/spine-repair-results.json');
}

const apply = process.argv.includes('--apply');
const refreshPlan = process.argv.includes('--plan') || !apply;
const plan = refreshPlan ? await createPlan() : await readJson(planPath);
if (apply) await applyPlan(plan);
