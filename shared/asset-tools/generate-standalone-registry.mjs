#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(await fs.readFile(path.join(root, 'standalone/characters/registry.json'), 'utf8'));
const output = [];
const characterSymbols = [];
const quote = (value) => value === null ? 'NULL' : JSON.stringify(String(value));
const symbol = (value) => value.replace(/[^a-z0-9]+/gi, '_').replace(/^\d/, '_$&').toLocaleLowerCase();
const float = (value) => `${Number.isInteger(Number(value)) ? Number(value).toFixed(1) : Number(value)}f`;

output.push('#include "character.h"', '', '#include <stddef.h>', '');
for (const entry of registry.characters) {
  const runtime = JSON.parse(await fs.readFile(path.join(root, entry.assets, 'manifest.json'), 'utf8'));
  const characterSymbol = symbol(entry.id);
  characterSymbols.push({ entry, runtime, characterSymbol });
  for (const [sourceId, source] of Object.entries(runtime.sources)) {
    const sourceSymbol = `${characterSymbol}_${symbol(sourceId)}`;
    output.push(`static const PetHitbox ${sourceSymbol}_hitboxes[] = {`);
    for (const hitbox of source.hitboxes) output.push(`  { ${hitbox.x}, ${hitbox.y}, ${hitbox.width}, ${hitbox.height} },`);
    output.push('};');
    output.push(`static const PetAnimationSource ${sourceSymbol}_source = {`);
    output.push(`  ${quote(sourceId)}, ${quote(`${entry.id}/${source.sheet}`)}, ${source.frames}, ${source.columns}, ${source.rows}, ${sourceSymbol}_hitboxes`);
    output.push('};', '');
  }
  for (const [animationId, animation] of Object.entries(runtime.animations)) {
    const orderSymbol = `${characterSymbol}_${symbol(animationId)}_order`;
    output.push(`static const int ${orderSymbol}[] = { ${animation.frameOrder.join(', ')} };`);
  }
  output.push('', `static const PetAnimationDefinition ${characterSymbol}_animations[] = {`);
  for (const [animationId, animation] of Object.entries(runtime.animations)) {
    output.push(`  { ${quote(animationId)}, &${characterSymbol}_${symbol(animation.source)}_source, ${characterSymbol}_${symbol(animationId)}_order, ${animation.frameOrder.length}, ${animation.fps}, ${animation.loop}, ${animation.mirror}, ${animation.holdLast}, ${quote(animation.next)} },`);
  }
  output.push('};', '');
}

output.push('const PetCharacter PET_CHARACTERS[] = {');
for (const { entry, runtime, characterSymbol } of characterSymbols) {
  const movement = runtime.character.movement;
  output.push('  {');
  output.push(`    ${quote(entry.id)}, ${quote(entry.name)}, ${quote(entry.localized_name)}, ${float(entry.defaultScale)},`);
  output.push(`    ${float(movement.walkPixelsPerSecond)}, ${float(movement.runPixelsPerSecond)}, ${float(movement.idleMinSeconds)}, ${float(movement.idleMaxSeconds)}, ${float(movement.restAfterSeconds)},`);
  output.push(`    ${runtime.character.mirrorRules.canMirror}, ${characterSymbol}_animations, sizeof(${characterSymbol}_animations) / sizeof(${characterSymbol}_animations[0])`);
  output.push('  },');
}
output.push('};');
output.push('const size_t PET_CHARACTER_COUNT = sizeof(PET_CHARACTERS) / sizeof(PET_CHARACTERS[0]);', '');
await fs.writeFile(path.join(root, 'standalone/characters/generated_registry.c'), output.join('\n'));
console.log(`generated C registry for ${registry.characters.length} standalone character(s)`);
