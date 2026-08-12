import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CODEX_DIST_DIR } from '../../paths.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

export async function buildContactSheets(definitions, { batchSize = 48 } = {}) {
  const outputDir = path.join(CODEX_DIST_DIR, 'contact-sheets');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const columns = 6;
  const tileWidth = 384;
  const tileHeight = 244;
  const outputs = [];
  for (let offset = 0; offset < definitions.length; offset += batchSize) {
    const batch = definitions.slice(offset, offset + batchSize);
    const rows = Math.ceil(batch.length / columns);
    const composites = [];
    for (let index = 0; index < batch.length; index++) {
      const definition = batch[index];
      const left = (index % columns) * tileWidth;
      const top = Math.floor(index / columns) * tileHeight;
      const label = `${definition.display_name}  ·  ${definition.source_id}`;
      const labelSvg = `<svg width="${tileWidth}" height="36" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#171a20"/><text x="12" y="24" fill="#f4f5f7" font-family="sans-serif" font-size="17">${escapeXml(label)}</text></svg>`;
      composites.push(
        { input: path.join(CODEX_DIST_DIR, definition.id, 'frames', '00-idle-00.png'), left, top: top + 36 },
        { input: path.join(CODEX_DIST_DIR, definition.id, 'frames', '01-running-right-01.png'), left: left + 192, top: top + 36 },
        { input: Buffer.from(labelSvg), left, top },
      );
    }
    const filename = `${String(outputs.length + 1).padStart(3, '0')}.webp`;
    await sharp({ create: { width: columns * tileWidth, height: rows * tileHeight, channels: 4, background: '#101319' } })
      .composite(composites)
      .webp({ lossless: true, effort: 5 })
      .toFile(path.join(outputDir, filename));
    outputs.push(`contact-sheets/${filename}`);
  }
  return outputs;
}
