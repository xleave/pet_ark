#!/usr/bin/env python3
"""Encode transparent lossless WebP while preserving zeroed hidden RGB."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


if len(sys.argv) not in (3, 4):
    raise SystemExit("usage: encode-webp-exact.py INPUT_PNG OUTPUT_WEBP [METHOD]")

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
method = int(sys.argv[3]) if len(sys.argv) == 4 else 0
if method < 0 or method > 6:
    raise SystemExit("METHOD must be from 0 to 6")

with Image.open(source) as opened:
    rgba = opened.convert("RGBA")

pixels = bytearray(rgba.tobytes())
for index in range(0, len(pixels), 4):
    if pixels[index + 3] == 0:
        pixels[index] = pixels[index + 1] = pixels[index + 2] = 0

clean = Image.frombytes("RGBA", rgba.size, bytes(pixels))
destination.parent.mkdir(parents=True, exist_ok=True)
clean.save(
    destination,
    format="WEBP",
    lossless=True,
    quality=100,
    method=method,
    exact=True,
)
