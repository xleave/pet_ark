import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ACTIVE_FRAME_COUNT, ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT, CELL_WIDTH, COLUMNS, DEFINITION_USAGE, ROWS, STATES } from './config.mjs';
import { findCharacter, loadRegistry, ROOT } from './registry/load.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

function parseArgs(argv) {
  let all = false;
  let character = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--all') all = true;
    else if (argument === '--character') character = argv[++index];
    else if (argument.startsWith('--character=')) character = argument.slice('--character='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (all && character) throw new Error('Use either --all or --character, not both');
  return { all, character };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateDefinition(definition, manifest) {
  for (const field of ['id', 'display_name', 'localized_name', 'source_name', 'status', 'renderer', 'visual_signature', ...DEFINITION_USAGE]) {
    assert(definition[field] !== undefined && definition[field] !== null, `${definition.id}: definition missing ${field}`);
  }
  assert(definition.status === 'implemented', `${definition.id}: status must be implemented`);
  assert(Array.isArray(definition.visual_signature) && definition.visual_signature.length >= 5, `${definition.id}: visual_signature needs at least five concrete traits`);
  assert(new Set(definition.visual_signature).size === definition.visual_signature.length, `${definition.id}: visual_signature contains duplicate traits`);
  for (const field of ['shape', 'color', 'length', 'fringe_count']) assert(definition.hair[field] !== undefined, `${definition.id}: hair missing ${field}`);
  for (const field of ['width', 'height', 'eye_gap', 'eye_width', 'eye_height', 'marking']) assert(definition.face[field] !== undefined, `${definition.id}: face missing ${field}`);
  for (const field of ['type', 'sleeve_style', 'boot_style', 'signature']) assert(definition.outfit[field] !== undefined, `${definition.id}: outfit missing ${field}`);
  for (const field of ['body_kind', 'ears', 'horns', 'halo', 'tail', 'wings']) assert(definition.species_features[field] !== undefined, `${definition.id}: species_features missing ${field}`);
  for (const field of ['primary', 'secondary', 'accent', 'hair', 'eye', 'line', 'skin', 'boot', 'weapon']) assert(/^#[0-9a-f]{6}$/i.test(definition.palette[field]), `${definition.id}: invalid palette.${field}`);
  assert(DEFINITION_USAGE.every((field) => manifest.rendererUses.includes(field)), `${definition.id}: manifest does not prove definition field usage`);
  assert(definition.identifying_features.summary.length > 30, `${definition.id}: identifying-feature summary is not concrete`);
  assert(['safe-mirror', 'fixed-detail-overlay', 'custom-baseline'].includes(definition.directional.strategy), `${definition.id}: invalid directional strategy`);
}

async function validateCharacter(definition) {
  const directory = path.join(ROOT, 'dist', definition.id);
  const sheetPath = path.join(directory, 'spritesheet.webp');
  const [pet, manifest, frameNames] = await Promise.all([
    fs.readFile(path.join(directory, 'pet.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(directory, 'manifest.json'), 'utf8').then(JSON.parse),
    fs.readdir(path.join(directory, 'frames')),
  ]);
  assert(pet.id === definition.id, `${definition.id}: pet.json id mismatch`);
  for (const key of ['id', 'displayName', 'description', 'spritesheetPath']) assert(pet[key], `${definition.id}: pet.json missing ${key}`);
  assert(pet.spritesheetPath === 'spritesheet.webp', `${definition.id}: invalid spritesheetPath`);
  assert(manifest.character.id === definition.id, `${definition.id}: manifest character mismatch`);
  assert(manifest.activeFrameCount === ACTIVE_FRAME_COUNT, `${definition.id}: active frame count mismatch`);
  assert(JSON.stringify(manifest.states) === JSON.stringify(STATES.map((state, row) => ({ id: state.id, row, frames: state.frames }))), `${definition.id}: state contract mismatch`);
  validateDefinition(manifest.character, manifest);
  const pngFrames = frameNames.filter((name) => name.endsWith('.png'));
  assert(pngFrames.length === ACTIVE_FRAME_COUNT, `${definition.id}: expected ${ACTIVE_FRAME_COUNT} frame files, got ${pngFrames.length}`);

  const meta = await sharp(sheetPath).metadata();
  assert(meta.width === ATLAS_WIDTH && meta.height === ATLAS_HEIGHT, `${definition.id}: expected ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, got ${meta.width}x${meta.height}`);
  assert(meta.channels === 4 && meta.hasAlpha, `${definition.id}: spritesheet must have alpha`);
  const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let visible = 0;
  let dirtyTransparentRgb = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] === 0) {
      transparent++;
      if (data[index - 3] || data[index - 2] || data[index - 1]) dirtyTransparentRgb++;
    } else if (data[index] > 8) visible++;
  }
  assert(transparent > 0 && visible > 0, `${definition.id}: expected visible and transparent pixels`);
  assert(dirtyTransparentRgb === 0, `${definition.id}: ${dirtyTransparentRgb} transparent pixels have hidden RGB`);
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      let nonzeroAlpha = 0;
      for (let y = row * CELL_HEIGHT; y < (row + 1) * CELL_HEIGHT; y++) {
        for (let x = column * CELL_WIDTH; x < (column + 1) * CELL_WIDTH; x++) {
          if (data[(y * info.width + x) * info.channels + 3]) nonzeroAlpha++;
        }
      }
      if (column < STATES[row].frames) assert(nonzeroAlpha > 0, `${definition.id}: active cell ${row}:${column} is empty`);
      else assert(nonzeroAlpha === 0, `${definition.id}: unused cell ${row}:${column} is not transparent`);
    }
  }
  const representative = await sharp(path.join(directory, 'frames', '00-idle-00.png')).ensureAlpha().raw().toBuffer();
  return { id: definition.id, transparent, visible, representative };
}

async function validateAll(definitions) {
  const representatives = [];
  const definitionSignatures = new Set();
  for (let index = 0; index < definitions.length; index++) {
    const definitionSignature = JSON.stringify(definitions[index].visual_signature);
    assert(!definitionSignatures.has(definitionSignature), `${definitions[index].id}: visual_signature duplicates another character`);
    definitionSignatures.add(definitionSignature);
    const result = await validateCharacter(definitions[index]);
    for (const prior of representatives) {
      assert(!result.representative.equals(prior.representative), `${result.id} is pixel-identical to ${prior.id}`);
      let sameAlphaLayout = true;
      for (let pixel = 3; pixel < result.representative.length; pixel += 4) {
        if (result.representative[pixel] !== prior.representative[pixel]) {
          sameAlphaLayout = false;
          break;
        }
      }
      assert(!sameAlphaLayout, `${result.id} is only a palette swap of ${prior.id} (identical alpha layout)`);
    }
    representatives.push(result);
    if ((index + 1) % 10 === 0 || index + 1 === definitions.length) console.log(`validated ${index + 1}/${definitions.length}: ${result.id}`);
  }
  const indexPath = path.join(ROOT, 'dist', 'index.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert(index.characters.length === definitions.length, 'dist/index.json does not cover the registry');
  for (const entry of index.characters) entry.validation_state = 'validated';
  for (const contactPath of index.contact_sheets) await fs.access(path.join(ROOT, 'dist', contactPath));
  const missing = definitions.filter((definition) => definition.status !== 'implemented' || typeof definition.renderFrame !== 'function').map((definition) => definition.id);
  const coverage = {
    source_retrieved_at: index.sources.retrieved_at,
    expected_characters: definitions.length,
    implemented_characters: definitions.length - missing.length,
    validated_characters: representatives.length,
    missing_characters: missing.length,
    missing,
  };
  await Promise.all([
    fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`),
    fs.writeFile(path.join(ROOT, 'dist', 'coverage-manifest.json'), `${JSON.stringify(coverage, null, 2)}\n`),
  ]);
  return coverage;
}

const options = parseArgs(process.argv.slice(2));
const registry = await loadRegistry();
if (options.all) {
  const coverage = await validateAll(registry);
  console.log(`OK: expected=${coverage.expected_characters}, implemented=${coverage.implemented_characters}, validated=${coverage.validated_characters}, missing=${coverage.missing_characters}`);
} else {
  const definition = options.character ? await findCharacter(options.character) : await findCharacter('priestess');
  const result = await validateCharacter(definition);
  console.log(`OK: ${definition.id}, ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, alpha=yes, hidden-rgb=clean, active=${ACTIVE_FRAME_COUNT}, transparent=${result.transparent}, visible=${result.visible}`);
}
