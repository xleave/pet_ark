import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { priestess } from '../characters/priestess.mjs';
import { renderGenericFrame } from '../renderer/generic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = path.join(ROOT, 'characters', 'registry', 'operators.json');

let cached;

export async function loadRegistry() {
  if (cached) return cached;
  const operators = JSON.parse(await fs.readFile(registryPath, 'utf8')).map((definition) => Object.freeze({
    ...definition,
    renderFrame: (state, frame) => renderGenericFrame(definition, state, frame),
  }));
  cached = Object.freeze([priestess, ...operators]);
  return cached;
}

export async function findCharacter(query) {
  const registry = await loadRegistry();
  const normalized = query.toLocaleLowerCase();
  const found = registry.find((definition) => {
    const aliases = [
      definition.id,
      definition.id.replace(/-chibi$/, ''),
      definition.display_name,
      definition.localized_name,
      definition.source_name,
      definition.source_id,
      definition.game_key,
    ].filter(Boolean).map((value) => value.toLocaleLowerCase());
    return aliases.includes(normalized);
  });
  if (!found) throw new Error(`Unknown character "${query}"`);
  return found;
}

export { ROOT };
