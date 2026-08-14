import fs from 'node:fs/promises';

export const EXPECTED_DIST_MANIFESTS = Object.freeze([
  'coverage-amiya-default.json',
  'registry.json',
  'roster.json',
  'test-coverage.json',
]);

export async function validateDistManifestHygiene(directory) {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
  const expected = [...EXPECTED_DIST_MANIFESTS].sort();
  const missing = expected.filter((name) => !entries.includes(name));
  const unexpected = entries.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length > 0) details.push(`unexpected: ${unexpected.join(', ')}`);
    throw new Error(`standalone dist manifest directory is not clean (${details.join('; ')})`);
  }
  return { manifests: expected };
}
