#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cleanedRoot = path.join(root, 'standalone/assets/cleaned');
const runtimeRoot = path.join(root, 'standalone/assets/runtime');
const writeIndex = process.argv.indexOf('--write');
const outputPath = writeIndex >= 0
  ? path.resolve(process.argv[writeIndex + 1])
  : path.join(root, 'standalone/dist/asset-quality.json');

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const characters = await fs.readdir(cleanedRoot, { withFileTypes: true });
const entries = [];
const defaultScales = new Map();

for (const characterEntry of characters.filter((entry) => entry.isDirectory())) {
  const character = characterEntry.name;
  const variants = await fs.readdir(path.join(cleanedRoot, character), { withFileTypes: true });
  for (const variantEntry of variants.filter((entry) => entry.isDirectory())) {
    const variant = variantEntry.name;
    const cleanedPath = path.join(cleanedRoot, character, variant, 'manifest.json');
    const runtimePath = path.join(runtimeRoot, character, variant, 'manifest.json');
    try {
      const [cleaned, runtime] = await Promise.all([readJson(cleanedPath), readJson(runtimePath)]);
      entries.push({ character, variant, cleaned, runtime });
      if (variant === 'default') defaultScales.set(character, cleaned.placement?.scale ?? 1);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

const candidates = [];
for (const { character, variant, cleaned, runtime } of entries) {
  const scale = cleaned.placement?.scale ?? 0;
  const defaultScale = defaultScales.get(character) ?? scale;
  const scaleRatio = defaultScale > 0 ? scale / defaultScale : 1;
  const idleSource = runtime.animations?.idle?.source;
  const hitboxes = runtime.sources?.[idleSource]?.hitboxes ?? [];
  const visibleWidth = Math.max(0, ...hitboxes.map((box) => box.width ?? 0));
  const visibleHeight = Math.max(0, ...hitboxes.map((box) => box.height ?? 0));
  const frameWidth = runtime.frameSize?.width ?? 192;
  const frameHeight = runtime.frameSize?.height ?? 224;
  const widthRatio = visibleWidth / frameWidth;
  const heightRatio = visibleHeight / frameHeight;
  const repaired = cleaned.render_revision >= 3
    && cleaned.placement?.bounds_policy === 'core-character-envelope';
  let score = 0;
  const reasons = [];
  if (scale < 0.06) { score += 60; reasons.push('placement-scale-critical'); }
  else if (scale < 0.08) { score += 40; reasons.push('placement-scale-high'); }
  else if (scale < 0.12) { score += 20; reasons.push('placement-scale-review'); }
  if (widthRatio < 0.3) { score += 60; reasons.push('idle-width-critical'); }
  else if (widthRatio < 0.45) { score += 30; reasons.push('idle-width-low'); }
  if (heightRatio < 0.3) { score += 60; reasons.push('idle-height-critical'); }
  else if (heightRatio < 0.45) { score += 30; reasons.push('idle-height-low'); }
  if (variant !== 'default' && scaleRatio < 0.35) {
    score += 30;
    reasons.push('variant-default-scale-drift');
  }
  if (repaired && widthRatio >= 0.45 && heightRatio >= 0.45) score = 0;
  if (score === 0) continue;
  candidates.push({
    character,
    variant,
    severity: score >= 80 ? 'critical' : score >= 40 ? 'high' : 'review',
    score,
    scale: Number(scale.toFixed(5)),
    scale_ratio: Number(scaleRatio.toFixed(3)),
    idle_visible: { width: visibleWidth, height: visibleHeight },
    placement_policy: cleaned.placement?.bounds_policy ?? 'legacy-full-envelope',
    reasons,
  });
}

candidates.sort((left, right) => right.score - left.score
  || left.character.localeCompare(right.character)
  || left.variant.localeCompare(right.variant));
const counts = { critical: 0, high: 0, review: 0 };
for (const candidate of candidates) counts[candidate.severity]++;
const report = {
  schema_version: 1,
  strategy: 'manifest-and-idle-hitbox-risk-index; rebuild only critical/high candidates',
  thresholds: { scale_review: 0.12, scale_high: 0.08, scale_critical: 0.06, visible_review: 0.45, visible_critical: 0.3 },
  summary: {
    variants: entries.length,
    pass: entries.length - candidates.length,
    candidates: candidates.length,
    ...counts,
  },
  candidates,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`asset quality: ${report.summary.pass}/${report.summary.variants} pass; critical=${counts.critical}, high=${counts.high}, review=${counts.review}`);
console.log(`wrote ${path.relative(root, outputPath)}`);
