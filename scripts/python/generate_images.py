#!/usr/bin/env python3
"""Generate deterministic PNG summary cards from manifests/assets.json."""

from pathlib import Path
import json
import math
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:
    print("Pillow is required. Install with: pip install -r requirements.txt")
    raise SystemExit(1) from exc

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "manifests" / "assets.json"
OUT_DIR = ROOT / "outputs" / "png"


def load_font(size: int):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
    except OSError:
        return ImageFont.load_default()


def draw_card(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, label: str, source: str):
    border = "#94A3B8"
    fill = "#0F172A"
    text = "#E2E8F0"
    accent = "#22D3EE"

    draw.rounded_rectangle((x, y, x + w, y + h), radius=16, fill=fill, outline=border, width=2)

    cx = x + 56
    cy = y + 56
    draw.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), fill=accent)
    draw.polygon([(cx, cy - 12), (cx + 10, cy), (cx, cy + 12), (cx - 10, cy)], fill="#0F172A")

    title_font = load_font(20)
    body_font = load_font(14)

    draw.text((x + 96, y + 34), label, font=title_font, fill=text)
    draw.text((x + 96, y + 66), source, font=body_font, fill="#94A3B8")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assets = data.get("assets", [])
    if not assets:
        print("No assets found in manifests/assets.json")
        return

    card_w, card_h = 620, 132
    gutter = 20
    cols = 1
    rows = math.ceil(len(assets) / cols)

    width = card_w + gutter * 2
    height = rows * card_h + (rows - 1) * gutter + gutter * 2 + 70

    image = Image.new("RGB", (width, height), "#020617")
    draw = ImageDraw.Draw(image)

    header_font = load_font(28)
    draw.text((gutter, 20), "wm-asset-workflows generated sheet", fill="#E2E8F0", font=header_font)

    for idx, asset in enumerate(assets):
        row = idx // cols
        x = gutter
        y = 70 + gutter + row * (card_h + gutter)
        draw_card(draw, x, y, card_w, card_h, asset.get("label", "Untitled"), asset.get("source", ""))

    out_file = OUT_DIR / "logo-sheet.png"
    image.save(out_file, "PNG")
    print(f"Wrote {out_file}")


if __name__ == "__main__":
    sys.exit(main())
