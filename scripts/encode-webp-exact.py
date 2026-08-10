#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from PIL import Image

if len(sys.argv) != 3:
    raise SystemExit('usage: encode-webp-exact.py INPUT_PNG OUTPUT_WEBP')

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
with Image.open(src) as opened:
    rgba = opened.convert('RGBA')

data = bytearray(rgba.tobytes())
for i in range(0, len(data), 4):
    if data[i + 3] == 0:
        data[i] = data[i + 1] = data[i + 2] = 0
clean = Image.frombytes('RGBA', rgba.size, bytes(data))
dst.parent.mkdir(parents=True, exist_ok=True)
clean.save(dst, format='WEBP', lossless=True, quality=100, method=6, exact=True)
