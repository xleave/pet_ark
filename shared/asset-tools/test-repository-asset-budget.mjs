#!/usr/bin/env node

import assert from 'node:assert/strict';

import { parseGitObjectStorage } from './validate-repository-asset-budget.mjs';

const output = [
  'count: 12',
  'size: 1024',
  'in-pack: 34',
  'packs: 1',
  'size-pack: 2048',
  'prune-packable: 0',
  'garbage: 1',
  'size-garbage: 512',
  '',
].join('\n');

assert.equal(parseGitObjectStorage(output), (1024 + 2048 + 512) * 1024);
assert.equal(parseGitObjectStorage('size: 0\nsize-pack: 1\n'), 1024);
assert.throws(() => parseGitObjectStorage('size: 1\n'), /did not report size-pack/);
assert.throws(() => parseGitObjectStorage('size: nope\nsize-pack: 1\n'), /unexpected git count-objects output/);

console.log('repository asset budget parser tests passed');
