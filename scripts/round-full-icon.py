#!/usr/bin/env python3
"""Round the corners of a full-bleed square icon for macOS, keeping the art full size."""
import argparse
from pathlib import Path
from PIL import Image
import sys
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
mask_mod = import_module("apply-macos-icon-mask")

DEFAULT_TILE_SCALE = 824 / 1024  # Apple HIG keyline

def round_full(src: Path, dst: Path, size=1024, tile_scale=DEFAULT_TILE_SCALE, squircle_n=3.8):
    source = Image.open(src).convert("RGBA")
    tile_size = max(1, round(size * tile_scale))
    tile_offset = (size - tile_size) // 2
    # Use the whole source as the tile art (no glyph re-fit / shrink).
    tile = source.resize((tile_size, tile_size), Image.LANCZOS)
    mask = mask_mod.squircle_mask(tile_size, squircle_n)
    masked = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
    masked.paste(tile, (0, 0), mask)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(masked, (tile_offset, tile_offset), masked)
    out.save(dst, "PNG")

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("-o", "--output", type=Path, default=Path("app-icon.png"))
    p.add_argument("--size", type=int, default=1024)
    p.add_argument("--tile-scale", type=float, default=DEFAULT_TILE_SCALE)
    p.add_argument("--squircle-n", type=float, default=3.8)
    a = p.parse_args()
    round_full(a.input, a.output, a.size, a.tile_scale, a.squircle_n)
    print(f"Wrote {a.output}")
