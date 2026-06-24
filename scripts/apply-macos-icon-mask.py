#!/usr/bin/env python3
"""Prepare a macOS app icon: inset artwork and apply a squircle mask."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw


def superellipse_polygon(size: int, n: float, points: int = 720) -> list[tuple[float, float]]:
    cx = cy = size / 2
    radius = size / 2
    polygon: list[tuple[float, float]] = []
    for i in range(points):
        t = 2 * math.pi * i / points
        cos_t, sin_t = math.cos(t), math.sin(t)
        x = radius * math.copysign(abs(cos_t) ** (2 / n), cos_t)
        y = radius * math.copysign(abs(sin_t) ** (2 / n), sin_t)
        polygon.append((cx + x, cy + y))
    return polygon


def squircle_mask(size: int, n: float) -> Image.Image:
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(superellipse_polygon(big, n), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def apply_macos_squircle(
    src: Path,
    dst: Path,
    size: int = 1024,
    art_scale: float = 0.68,
    squircle_n: float = 3.8,
    background: tuple[int, int, int, int] = (0, 0, 0, 255),
) -> None:
    source = Image.open(src).convert("RGBA")
    art_size = max(1, round(size * art_scale))
    art = source.resize((art_size, art_size), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), background)
    offset = (size - art_size) // 2
    canvas.paste(art, (offset, offset), art)

    mask = squircle_mask(size, squircle_n)
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.paste(canvas, (0, 0), mask)
    output.save(dst, "PNG")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Square source icon (PNG/JPEG)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("app-icon.png"),
        help="Output PNG path (default: app-icon.png)",
    )
    parser.add_argument("--size", type=int, default=1024, help="Output size in pixels")
    parser.add_argument(
        "--art-scale",
        type=float,
        default=0.68,
        help="Artwork scale relative to canvas (default: 0.68)",
    )
    parser.add_argument(
        "--squircle-n",
        type=float,
        default=3.8,
        help="Superellipse exponent; lower = rounder corners (default: 3.8)",
    )
    args = parser.parse_args()
    apply_macos_squircle(
        args.input,
        args.output,
        size=args.size,
        art_scale=args.art_scale,
        squircle_n=args.squircle_n,
    )
    print(f"Wrote {args.output}")
