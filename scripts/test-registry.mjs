import fs from 'node:fs/promises';
import path from 'node:path';
import { STATES } from './config.mjs';
import { loadRegistry, ROOT } from './registry/load.mjs';

const registry = await loadRegistry();
const sources = JSON.parse(await fs.readFile(path.join(ROOT, 'characters', 'registry', 'sources.json'), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(registry.length === sources.normalization.expected_total, `registry has ${registry.length}, source scope expects ${sources.normalization.expected_total}`);
assert(new Set(registry.map((definition) => definition.id)).size === registry.length, 'character ids must be unique');
assert(new Set(registry.map((definition) => definition.source_id)).size === registry.length, 'source ids must be unique');

const idleSvgs = new Set();
const hairShapes = new Set();
const outfitTypes = new Set();
const equipmentTypes = new Set();
for (const definition of registry) {
  assert(definition.status === 'implemented', `${definition.id}: not implemented`);
  assert(!/placeholder|generic operator|todo/i.test(JSON.stringify(definition)), `${definition.id}: placeholder language detected`);
  assert(definition.visual_signature.length >= 5, `${definition.id}: insufficient visual signature`);
  hairShapes.add(definition.hair.shape);
  outfitTypes.add(definition.outfit.type);
  equipmentTypes.add(definition.weapon.type);
  for (const state of STATES) {
    const svg = definition.renderFrame(state.id, 0);
    assert(svg.includes('width="192"') && svg.includes('height="208"'), `${definition.id}:${state.id}: invalid SVG frame size`);
  }
  const idle = definition.renderFrame('idle', 0);
  assert(!idleSvgs.has(idle), `${definition.id}: duplicate idle renderer output`);
  idleSvgs.add(idle);
}
assert(hairShapes.size >= 5, 'renderer needs at least five distinct hair silhouettes');
assert(outfitTypes.size >= 6, 'renderer needs at least six outfit structures');
assert(equipmentTypes.size >= 10, 'renderer needs at least ten equipment structures');
console.log(`OK: registry=${registry.length}, hair=${hairShapes.size}, outfits=${outfitTypes.size}, equipment=${equipmentTypes.size}, states=${STATES.length}`);
