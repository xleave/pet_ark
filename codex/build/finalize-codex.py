#!/usr/bin/env python3
"""Re-finalize one or more already-rendered Codex WebP atlases."""
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image

CELL_W, CELL_H = 192, 208
ACTIVE = (6, 8, 8, 4, 5, 8, 6, 6, 6)


def finalize(sheet: Path) -> None:
    with Image.open(sheet) as opened:
        atlas = opened.convert('RGBA')
    if atlas.size != (1536, 1872):
        raise SystemExit(f'{sheet}: expected 1536x1872, got {atlas.width}x{atlas.height}')
    for row, active in enumerate(ACTIVE):
        for column in range(active, 8):
            atlas.paste((0, 0, 0, 0), (column * CELL_W, row * CELL_H, (column + 1) * CELL_W, (row + 1) * CELL_H))
    data = bytearray(atlas.tobytes())
    for index in range(0, len(data), 4):
        if data[index + 3] == 0:
            data[index] = data[index + 1] = data[index + 2] = 0
    clean = Image.frombytes('RGBA', atlas.size, bytes(data))
    clean.save(sheet, format='WEBP', lossless=True, quality=100, method=6, exact=True)
    print(f'finalized {sheet}')


parser = argparse.ArgumentParser()
parser.add_argument('spritesheets', type=Path, nargs='+')
arguments = parser.parse_args()
for spritesheet in arguments.spritesheets:
    finalize(spritesheet)
