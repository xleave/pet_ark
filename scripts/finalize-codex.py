#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'priestess-chibi'
SHEET = OUT / 'spritesheet.webp'
CELL_W, CELL_H = 192, 208
STATES = [
    ('idle', 6),
    ('running-right', 8),
    ('running-left', 8),
    ('waving', 4),
    ('jumping', 5),
    ('failed', 8),
    ('waiting', 6),
    ('running', 6),
    ('review', 6),
]

with Image.open(SHEET) as opened:
    atlas = opened.convert('RGBA')

if atlas.size != (1536, 1872):
    raise SystemExit(f'expected 1536x1872 atlas, got {atlas.size[0]}x{atlas.size[1]}')

# Codex currently plays a fixed number of frames per row. Clear every unused cell.
for row, (_state, active) in enumerate(STATES):
    for col in range(active, 8):
        atlas.paste((0, 0, 0, 0), (col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))

# Preserve the hatch-pet invariant: alpha=0 implies RGB=(0,0,0).
data = bytearray(atlas.tobytes())
for i in range(0, len(data), 4):
    if data[i + 3] == 0:
        data[i] = data[i + 1] = data[i + 2] = 0
atlas = Image.frombytes('RGBA', atlas.size, bytes(data))
atlas.save(SHEET, format='WEBP', lossless=True, quality=100, method=6, exact=True)

pet = {
    'id': 'priestess-chibi',
    'displayName': '普瑞赛斯·Q版',
    'description': '以《明日方舟》普瑞赛斯为灵感设计的 Q 版 Codex 桌宠，按 Codex 官方行帧数制作。',
    'spritesheetPath': 'spritesheet.webp',
}
(OUT / 'pet.json').write_text(json.dumps(pet, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

manifest = {
    'atlas': {'columns': 8, 'rows': 9, 'cellWidth': 192, 'cellHeight': 208, 'width': 1536, 'height': 1872},
    'states': [{'id': state, 'row': row, 'frames': frames} for row, (state, frames) in enumerate(STATES)],
    'style': 'hand-authored chibi vector, rendered to lossless WebP',
}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Finalized Codex frame contract: 6/8/8/4/5/8/6/6/6 (57 active frames)')
