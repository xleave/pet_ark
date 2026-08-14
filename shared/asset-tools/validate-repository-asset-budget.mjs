#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const MAX_TRACKED_TREE_BYTES = 8 * GIB;
const MAX_GIT_OBJECT_BYTES = 4 * GIB;
const MAX_TRACKED_FILE_BYTES = 50 * MIB;

function formatBytes(bytes) {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * MIB,
  });
  return output.split('\0').filter(Boolean);
}

export function parseGitObjectStorage(output) {
  const values = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([^:]+):\s*(\d+)$/.exec(line.trim());
    if (!match) throw new Error(`unexpected git count-objects output: ${line}`);
    values.set(match[1], Number.parseInt(match[2], 10));
  }

  for (const required of ['size', 'size-pack']) {
    if (!values.has(required)) throw new Error(`git count-objects did not report ${required}`);
  }

  const kibibytes = values.get('size') + values.get('size-pack') + (values.get('size-garbage') || 0);
  if (!Number.isSafeInteger(kibibytes)) throw new Error('git object storage size is not a safe integer');
  return kibibytes * 1024;
}

function gitObjectStorageBytes() {
  const output = execFileSync('git', ['count-objects', '-v'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: MIB,
  });
  return parseGitObjectStorage(output);
}

async function main() {
  const files = trackedFiles();
  const gitObjectBytes = gitObjectStorageBytes();
  let total = 0;
  const missing = [];
  const oversized = [];
  const groups = new Map();

  for (const relativePath of files) {
    let stat;
    try {
      stat = await fs.lstat(path.join(REPO_ROOT, relativePath));
    } catch (error) {
      if (error.code === 'ENOENT') {
        missing.push(relativePath);
        continue;
      }
      throw error;
    }
    total += stat.size;
    const group = relativePath.split('/')[0] || '(root)';
    groups.set(group, (groups.get(group) || 0) + stat.size);
    if (stat.size > MAX_TRACKED_FILE_BYTES) oversized.push([relativePath, stat.size]);
  }

  if (missing.length) {
    throw new Error(
      `asset budget requires a complete checkout; ${missing.length} tracked file(s) are absent ` +
      `(first: ${missing[0]})`,
    );
  }

  console.log(`tracked tree: ${formatBytes(total)} across ${files.length} file(s)`);
  for (const [group, bytes] of [...groups.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${group}: ${formatBytes(bytes)}`);
  }
  console.log(`git object storage: ${formatBytes(gitObjectBytes)}`);
  console.log(
    `budget: ${formatBytes(MAX_TRACKED_TREE_BYTES)} tracked tree, ` +
    `${formatBytes(MAX_GIT_OBJECT_BYTES)} Git objects, ${formatBytes(MAX_TRACKED_FILE_BYTES)} per file`,
  );

  if (total > MAX_TRACKED_TREE_BYTES) {
    throw new Error(`tracked tree exceeds the ${formatBytes(MAX_TRACKED_TREE_BYTES)} repository budget`);
  }
  if (gitObjectBytes > MAX_GIT_OBJECT_BYTES) {
    throw new Error(`Git object storage exceeds the ${formatBytes(MAX_GIT_OBJECT_BYTES)} repository budget`);
  }
  if (oversized.length) {
    const details = oversized
      .sort((left, right) => right[1] - left[1])
      .map(([relativePath, bytes]) => `${relativePath} (${formatBytes(bytes)})`)
      .join(', ');
    throw new Error(`tracked files exceed the ${formatBytes(MAX_TRACKED_FILE_BYTES)} per-file budget: ${details}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`asset-budget: ${error.message}`);
    process.exitCode = 1;
  });
}
