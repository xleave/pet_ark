import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CODEX_ROOT = path.join(REPO_ROOT, 'codex');
export const CODEX_DIST_DIR = path.join(CODEX_ROOT, 'dist');
export const CHARACTER_DATA_DIR = path.join(REPO_ROOT, 'shared', 'character-data');
