#!/usr/bin/env python3
"""Apply the macOS squircle mask (superellipse n=5) to a square app icon."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw


def superellipse_polygon(size: int, n: float = 5.0, points: int = 720) -> list[tuple[float, float]]:
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


def apply_macos_squircle(src: Path, dst: Path, size: int = 1024) -> None:
    image = Image.open(src).convert("RGBA")
    image = image.resize((size, size), Image.LANCZOS)

    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(superellipse_polygon(big), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.paste(image, (0, 0), mask)
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
    args = parser.parse_args()
    apply_macos_squircle(args.input, args.output, args.size)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
