#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from PIL import Image

if len(sys.argv) not in (3, 4):
    raise SystemExit('usage: encode-webp-exact.py INPUT_PNG OUTPUT_WEBP [METHOD]')

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
method = int(sys.argv[3]) if len(sys.argv) == 4 else 6
if method < 0 or method > 6:
    raise SystemExit('METHOD must be from 0 to 6')
with Image.open(src) as opened:
    rgba = opened.convert('RGBA')

data = bytearray(rgba.tobytes())
for i in range(0, len(data), 4):
    if data[i + 3] == 0:
        data[i] = data[i + 1] = data[i + 2] = 0
clean = Image.frombytes('RGBA', rgba.size, bytes(data))
dst.parent.mkdir(parents=True, exist_ok=True)
clean.save(dst, format='WEBP', lossless=True, quality=100, method=method, exact=True)
