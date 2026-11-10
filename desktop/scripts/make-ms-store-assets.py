#!/usr/bin/env python3
"""Generate Microsoft Store / AppX tile logos from build/icon.png into build/appx/.

Required by electron-builder AppX:
  StoreLogo.png (50), Square44x44Logo.png, Square150x150Logo.png, Wide310x150Logo.png
Optional extras used when present:
  SmallTile.png (71), LargeTile.png (310), SplashScreen.png (620x300), BadgeLogo.png (24)
"""
from __future__ import annotations
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "pillow"])
    from PIL import Image

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
SRC = ROOT / "build" / "icon.png"
if not SRC.exists():
    for cand in (ROOT / "build" / "icon-256.png", ROOT / "web" / "icons" / "icon-512.png"):
        if cand.exists():
            SRC = cand
            break
if not SRC.exists():
    print(f"No icon found under {ROOT}/build", file=sys.stderr)
    sys.exit(1)

out = ROOT / "build" / "appx"
out.mkdir(parents=True, exist_ok=True)
base = Image.open(SRC).convert("RGBA")

def square(size: int, name: str) -> None:
    img = base.resize((size, size), Image.Resampling.LANCZOS)
    img.save(out / name, "PNG")
    print(f"  {name} {size}x{size}")

def wide(w: int, h: int, name: str) -> None:
    # Letterbox icon on transparent canvas (Store prefers full-bleed branding; keep mark centered)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    side = min(h, w)
    mark = base.resize((side, side), Image.Resampling.LANCZOS)
    canvas.paste(mark, ((w - side) // 2, (h - side) // 2), mark)
    canvas.save(out / name, "PNG")
    print(f"  {name} {w}x{h}")

print(f"make-ms-store-assets from {SRC}")
square(50, "StoreLogo.png")
square(44, "Square44x44Logo.png")
square(150, "Square150x150Logo.png")
wide(310, 150, "Wide310x150Logo.png")
square(71, "SmallTile.png")
square(310, "LargeTile.png")
wide(620, 300, "SplashScreen.png")
square(24, "BadgeLogo.png")
print(f"wrote {out}")
