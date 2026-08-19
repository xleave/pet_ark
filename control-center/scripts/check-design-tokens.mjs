#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const tokenFile = path.join(sourceRoot, 'design-tokens.css');
const rawColor = /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/i;
const rawDuration = /(?:^|[^\w.-])(?:\d*\.?\d+)(?:ms|s)\b/i;

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && /\.(?:css|svelte)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

const failures = [];
for (const file of await sourceFiles(sourceRoot)) {
  if (file === tokenFile) continue;
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (rawColor.test(line)) failures.push(`${path.relative(root, file)}:${index + 1}: raw color must be a semantic design token`);
    if (rawDuration.test(line)) failures.push(`${path.relative(root, file)}:${index + 1}: raw duration must be a motion design token`);
  });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('design-token contract: OK');
}
