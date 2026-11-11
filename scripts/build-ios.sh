#!/usr/bin/env bash
# Copy the Ledgerbay web build into the xtool package and build an iOS .ipa.
#
# Usage:
#   scripts/build-ios.sh [web-dir]
#
# Default web dir is ./app (the 1.13.22 store build).
# Unsigned by default: `xtool dev build --ipa` (no Apple ID).
# XTOOL_SIGN=1 adds --sign, which needs `xtool auth` on this machine.
# XTOOL_CONFIGURATION=release|debug (default release).
# IOS_REFRESH_ICON=1 rebuilds ios/Resources/AppIcon.png from the web icon.
#
# Never pass personal/, backups, secrets, or signing material.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SRC="${1:-$ROOT/app}"
IOS="$ROOT/ios"
DEST="$IOS/Sources/Ledgerbay/Web"
ICON_OUT="$IOS/Resources/AppIcon.png"
XTOOL="${XTOOL:-xtool}"
CONFIG="${XTOOL_CONFIGURATION:-release}"

if [[ ! -d "$WEB_SRC" || ! -f "$WEB_SRC/index.html" ]]; then
  echo "No index.html in web dir: $WEB_SRC" >&2
  exit 2
fi
case "$WEB_SRC" in
  */personal|*/personal/*|*backups*|*secrets*)
    echo "Refusing private path: $WEB_SRC" >&2
    exit 2 ;;
esac
if [[ -f "$WEB_SRC/ledgerbay-mydata-backup.json" || -f "$WEB_SRC/personal-seed.json" ]]; then
  echo "Refusing web dir with a personal backup or seed" >&2
  exit 2
fi
if [[ -f "$WEB_SRC/build-config.js" ]] && grep -q 'VARIANT: *"personal"' "$WEB_SRC/build-config.js"; then
  echo "Refusing a personal-variant web build" >&2
  exit 2
fi

bash "$ROOT/scripts/privacy-scan.sh" "$ROOT"

python3 - "$WEB_SRC" "$DEST" <<'PY'
import shutil
import sys
from pathlib import Path

src = Path(sys.argv[1]).resolve()
dest = Path(sys.argv[2]).resolve()
skip_names = {
    "package.json",
    "package-lock.json",
    "server.mjs",
    "start-sync.bat",
    "README.md",
    "personal-seed.json",
    "ledgerbay-mydata-backup.json",
}
skip_dirs = {"node_modules", "sync-data", "personal", ".git"}

def skip(name: str) -> bool:
    if name in skip_names or name in skip_dirs:
        return True
    if name.startswith("sync-data-test"):
        return True
    lower = name.lower()
    if lower.endswith(".jks") or lower.endswith(".keystore") or lower == "keystore.properties":
        return True
    return False

def ignore(directory, names):
    return [name for name in names if skip(name)]

if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
for child in src.iterdir():
    if skip(child.name):
        continue
    target = dest / child.name
    if child.is_dir():
        shutil.copytree(child, target, ignore=ignore)
    elif child.is_file():
        shutil.copy2(child, target)
(dest / ".gitkeep").write_text("", encoding="utf-8")
index = dest / "index.html"
if not index.is_file():
    raise SystemExit("copy failed: index.html missing")
print(f"web -> {dest}")
PY

python3 - "$DEST/index.html" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
viewport = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=3, viewport-fit=cover"
updated, count = re.subn(
    r'(<meta\s+name="viewport"\s+content=")[^"]*(")',
    lambda match: match.group(1) + viewport + match.group(2),
    html,
    count=1,
)
if count != 1:
    raise SystemExit("viewport meta tag not found in index.html")
path.write_text(updated, encoding="utf-8")
print("viewport: pinch zoom 1x-3x, viewport-fit=cover (iOS copy only)")
PY

python3 - "$WEB_SRC/build-config.js" "$IOS/Info.plist" <<'PY'
import pathlib
import re
import sys

config = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
version = re.search(r'VERSION:\s*"([^"]+)"', config)
code = re.search(r'VERSION_CODE:\s*(\d+)', config)
if not version or not code:
    raise SystemExit("build-config.js is missing VERSION or VERSION_CODE")
plist_path = pathlib.Path(sys.argv[2])
plist = plist_path.read_text(encoding="utf-8")
plist2, n1 = re.subn(
    r"(<key>CFBundleShortVersionString</key>\s*<string>)[^<]+",
    r"\g<1>" + version.group(1),
    plist,
    count=1,
)
plist2, n2 = re.subn(
    r"(<key>CFBundleVersion</key>\s*<string>)[^<]+",
    r"\g<1>" + code.group(1),
    plist2,
    count=1,
)
if n1 != 1 or n2 != 1:
    raise SystemExit("Info.plist is missing version keys")
plist_path.write_text(plist2, encoding="utf-8")
print(f"version {version.group(1)} ({code.group(1)})")
PY

if [[ ! -f "$ICON_OUT" || "${IOS_REFRESH_ICON:-}" == "1" ]]; then
  ICON_SRC="$WEB_SRC/icons/icon-512-maskable.png"
  if [[ ! -f "$ICON_SRC" ]]; then
    ICON_SRC="$WEB_SRC/icons/play-icon-512.png"
  fi
  if [[ ! -f "$ICON_SRC" ]]; then
    ICON_SRC="$WEB_SRC/icons/icon-512.png"
  fi
  [[ -f "$ICON_SRC" ]] || { echo "No app icon under $WEB_SRC/icons" >&2; exit 2; }
  mkdir -p "$(dirname "$ICON_OUT")"
  if python3 -c "import PIL" >/dev/null 2>&1; then
    python3 - "$ICON_SRC" "$ICON_OUT" <<'PY'
import sys
from PIL import Image
image = Image.open(sys.argv[1]).convert("RGBA")
image = image.resize((1024, 1024), Image.Resampling.LANCZOS)
image.save(sys.argv[2], format="PNG")
print("icon 1024", sys.argv[2])
PY
  elif command -v sips >/dev/null 2>&1; then
    sips -z 1024 1024 "$ICON_SRC" --out "$ICON_OUT" >/dev/null
    echo "icon 1024 via sips"
  else
    cp -f "$ICON_SRC" "$ICON_OUT"
    echo "icon copied at source size (install Pillow or use macOS sips for 1024)"
  fi
fi

if ! command -v "$XTOOL" >/dev/null 2>&1; then
  echo "xtool is not on PATH. Install it, then re-run scripts/build-ios.sh." >&2
  echo "Linux/WSL: https://github.com/xtool-org/xtool/blob/main/Documentation/xtool.docc/Installation-Linux.md" >&2
  echo "macOS:     https://github.com/xtool-org/xtool/blob/main/Documentation/xtool.docc/Installation-macOS.md" >&2
  echo "The web bundle is staged at ios/Sources/Ledgerbay/Web. An .ipa was not built." >&2
  exit 2
fi

echo "== xtool dev build --configuration $CONFIG --ipa =="
(
  cd "$IOS"
  if [[ "${XTOOL_SIGN:-}" == "1" ]]; then
    "$XTOOL" dev build --configuration "$CONFIG" --ipa --sign
  else
    "$XTOOL" dev build --configuration "$CONFIG" --ipa
  fi
)

IPA="$(find "$IOS/xtool" -maxdepth 1 -name '*.ipa' -print | head -n 1)"
if [[ -z "$IPA" ]]; then
  echo "xtool finished without writing an .ipa under ios/xtool" >&2
  exit 1
fi

VERSION="$(python3 - "$IOS/Info.plist" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
match = re.search(r"<key>CFBundleShortVersionString</key>\s*<string>([^<]+)", text)
print(match.group(1) if match else "unknown")
PY
)"
mkdir -p "$ROOT/dist/ios"
OUT="$ROOT/dist/ios/Ledgerbay-${VERSION}-unsigned.ipa"
if [[ "${XTOOL_SIGN:-}" == "1" ]]; then
  OUT="$ROOT/dist/ios/Ledgerbay-${VERSION}-devsigned.ipa"
fi
cp -f "$IPA" "$OUT"

python3 - "$OUT" <<'PY'
import sys
import zipfile

path = sys.argv[1]
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
html = [name for name in names if name.endswith("Web/index.html")]
if not html:
    raise SystemExit("ipa is missing Web/index.html")
print(f"ipa ok ({len(names)} entries), includes {html[0]}")
PY

echo "Wrote $OUT"
ls -lh "$OUT"
