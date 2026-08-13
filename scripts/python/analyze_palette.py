#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def extract_palette(image_path: Path, color_count: int) -> list[dict[str, str | float]]:
    with Image.open(image_path) as source:
        image = source.convert("RGBA")
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        opaque_pixels = [pixel[:3] for pixel in image.getdata() if pixel[3] >= 32]

    if not opaque_pixels:
        return []

    pixels = Image.new("RGB", (len(opaque_pixels), 1))
    pixels.putdata(opaque_pixels)
    quantized = pixels.quantize(colors=color_count, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette()
    total = len(opaque_pixels)
    colors = []

    for count, palette_index in sorted(quantized.getcolors() or [], reverse=True):
        offset = palette_index * 3
        red, green, blue = palette[offset : offset + 3]
        colors.append({
            "hex": f"#{red:02X}{green:02X}{blue:02X}",
            "percentage": round((count / total) * 100, 2),
        })

    return colors


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract dominant colors from an image.")
    parser.add_argument("image", type=Path)
    parser.add_argument("--colors", type=int, default=10)
    args = parser.parse_args()
    color_count = max(1, min(args.colors, 10))
    print(json.dumps(extract_palette(args.image, color_count)))


if __name__ == "__main__":
    main()