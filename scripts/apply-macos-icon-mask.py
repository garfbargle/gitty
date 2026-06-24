#!/usr/bin/env python3
"""Prepare a macOS app icon: crop glyph, inset, and apply a squircle mask."""

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


def content_bounds(image: Image.Image, threshold: int = 18) -> tuple[int, int, int, int]:
    pixels = image.load()
    width, height = image.size
    min_x, min_y = width, height
    max_x, max_y = -1, -1

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            if max(r, g, b) > threshold:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)

    if max_x < min_x:
        return (0, 0, width, height)

    pad = max(16, round(max(width, height) * 0.06))
    return (
        max(0, min_x - pad),
        max(0, min_y - pad),
        min(width, max_x + pad + 1),
        min(height, max_y + pad + 1),
    )


def strip_dark_background(image: Image.Image, threshold: int = 24) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            if max(r, g, b) <= threshold:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def fit_glyph(image: Image.Image, size: int, art_scale: float) -> Image.Image:
    cropped = strip_dark_background(image.crop(content_bounds(image)))
    bounds = content_bounds(cropped, threshold=1)
    glyph = cropped.crop(bounds)

    art_size = max(1, round(size * art_scale))
    glyph = glyph.resize((art_size, art_size), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = (size - art_size) // 2
    canvas.paste(glyph, (offset, offset), glyph)
    return canvas


def apply_macos_squircle(
    src: Path,
    dst: Path,
    size: int = 1024,
    art_scale: float = 0.42,
    squircle_n: float = 3.8,
    background: tuple[int, int, int, int] = (0, 0, 0, 255),
) -> None:
    source = Image.open(src).convert("RGBA")
    glyph_layer = fit_glyph(source, size, art_scale)

    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(glyph_layer)

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
        default=0.42,
        help="Glyph scale relative to canvas after crop (default: 0.42)",
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


if __name__ == "__main__":
    main()
