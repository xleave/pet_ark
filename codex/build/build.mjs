import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCharacter } from './atlas/build-character.mjs';
import { buildContactSheets } from './contact-sheet/build.mjs';
import { findCharacter, loadRegistry } from '../characters/load.mjs';
import { CHARACTER_DATA_DIR, CODEX_DIST_DIR } from '../paths.mjs';

function parseArgs(argv) {
  const options = { all: false, character: null, concurrency: 2, frameConcurrency: 4 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--all') options.all = true;
    else if (argument === '--character') options.character = argv[++index];
    else if (argument.startsWith('--character=')) options.character = argument.slice('--character='.length);
    else if (argument === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (argument === '--frame-concurrency') options.frameConcurrency = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.all && options.character) throw new Error('Use either --all or --character, not both');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) throw new Error('--concurrency must be an integer from 1 to 8');
  if (!Number.isInteger(options.frameConcurrency) || options.frameConcurrency < 1 || options.frameConcurrency > 8) throw new Error('--frame-concurrency must be an integer from 1 to 8');
  return options;
}

async function buildBounded(definitions, concurrency, frameConcurrency) {
  let cursor = 0;
  let complete = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, definitions.length) }, async () => {
    while (cursor < definitions.length) {
      const definition = definitions[cursor++];
      await buildCharacter(definition, { frameConcurrency });
      complete++;
      if (definitions.length === 1 || complete % 10 === 0 || complete === definitions.length) console.log(`built ${complete}/${definitions.length}: ${definition.id}`);
    }
  }));
}

async function writeAggregateFiles(definitions, contactSheets) {
  const sources = JSON.parse(await fs.readFile(path.join(CHARACTER_DATA_DIR, 'codex-sources.json'), 'utf8'));
  const entries = definitions.map((definition) => ({
    id: definition.id,
    display_name: definition.display_name,
    localized_name: definition.localized_name,
    output_path: `${definition.id}/`,
    validation_state: 'pending',
  }));
  const implemented = definitions.filter((definition) => definition.status === 'implemented' && definition.renderer && typeof definition.renderFrame === 'function');
  const missing = definitions.filter((definition) => !implemented.includes(definition)).map((definition) => definition.id);
  const coverage = {
    source_retrieved_at: sources.retrieved_at,
    expected_characters: definitions.length,
    implemented_characters: implemented.length,
    validated_characters: 0,
    missing_characters: missing.length,
    missing,
  };
  await Promise.all([
    fs.writeFile(path.join(CODEX_DIST_DIR, 'index.json'), `${JSON.stringify({ sources, characters: entries, contact_sheets: contactSheets }, null, 2)}\n`),
    fs.writeFile(path.join(CODEX_DIST_DIR, 'coverage-manifest.json'), `${JSON.stringify(coverage, null, 2)}\n`),
  ]);
}

const options = parseArgs(process.argv.slice(2));
const registry = await loadRegistry();
const definitions = options.all ? registry : [options.character ? await findCharacter(options.character) : await findCharacter('priestess')];
await buildBounded(definitions, options.concurrency, options.frameConcurrency);
if (options.all) {
  const contactSheets = await buildContactSheets(definitions);
  await writeAggregateFiles(definitions, contactSheets);
  console.log(`built contact sheets: ${contactSheets.length}`);
}
