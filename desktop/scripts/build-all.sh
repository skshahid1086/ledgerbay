#!/usr/bin/env bash
# Usage: scripts/build-all.sh <web-build-dir> <version> <productName> <appId>
# Env: BUILD_TARGETS=all|win|linux|appx|msix (default all; appx separate — not in "all")
# NEVER pass personal/, backups, secrets, or Android keystore paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCRIPTS="$ROOT/scripts"

WEB_SRC="${1:-}"
VERSION="${2:-}"
PRODUCT="${3:-}"
APP_ID="${4:-}"

if [[ -z "$WEB_SRC" || -z "$VERSION" || -z "$PRODUCT" || -z "$APP_ID" ]]; then
  echo "Usage: $0 <web-build-dir> <version> <productName> <appId>" >&2
  exit 2
fi
[[ -d "$WEB_SRC" ]] || { echo "Missing web dir: $WEB_SRC" >&2; exit 2; }
[[ -f "$WEB_SRC/index.html" ]] || { echo "No index.html in $WEB_SRC" >&2; exit 2; }

case "$WEB_SRC" in
  */personal|*/personal/*|*ledgerbay-v21/personal*|*backups*|*secrets*)
    echo "REFUSING private path: $WEB_SRC" >&2; exit 2 ;;
esac
if [[ -f "$WEB_SRC/ledgerbay-mydata-backup.json" || -f "$WEB_SRC/personal-seed.json" ]]; then
  echo "REFUSING web dir with personal backup/seed" >&2; exit 2
fi

SLUG=$(echo "$PRODUCT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | sed 's/^-*//;s/-*$//')
[[ -z "$SLUG" ]] && SLUG="ledgerbay"
SCHEME=$(echo "$SLUG" | tr -cd 'a-z0-9' | head -c 16)
[[ -z "$SCHEME" ]] && SCHEME="ledgerbay"
export SLUG VERSION PRODUCT APP_ID SCHEME

echo "== build-all =="
echo "  web=$WEB_SRC version=$VERSION product=$PRODUCT appId=$APP_ID scheme=${SCHEME}://"

rm -rf "$ROOT/web"
mkdir -p "$ROOT/web"
cp -a "$WEB_SRC"/. "$ROOT/web"/
rm -rf "$ROOT/web/sync-data" "$ROOT/web/node_modules" \
  "$ROOT/web/personal-seed.json" "$ROOT/web/ledgerbay-mydata-backup.json" 2>/dev/null || true
rm -rf "$ROOT/web"/sync-data-test-* 2>/dev/null || true

if [[ -f "$ROOT/electron/desktop-bridge.js" ]]; then
  cp -f "$ROOT/electron/desktop-bridge.js" "$ROOT/web/desktop-bridge.js"
fi

python3 "$SCRIPTS/write-build-config.py" "$ROOT/web"
python3 "$SCRIPTS/patch-legacy-seed.py" "$ROOT/web/app.js"

python3 - "$ROOT/web/index.html" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
html = p.read_text(encoding="utf-8")
if "build-config.js" not in html:
    html = html.replace('<script src="app.js"></script>',
                        '<script src="build-config.js"></script>\n  <script src="app.js"></script>', 1)
if "desktop-bridge.js" not in html:
    html = html.replace("</body>", '  <script src="desktop-bridge.js"></script>\n</body>', 1)
p.write_text(html, encoding="utf-8")
print("index.html ok")
PY

mkdir -p "$ROOT/build"
[[ -f "$ROOT/web/icons/icon-512.png" ]] && cp -f "$ROOT/web/icons/icon-512.png" "$ROOT/build/icon.png" || true
for s in 16 32 48 64 128 256; do
  [[ -f "$ROOT/web/icons/icon-${s}.png" ]] && cp -f "$ROOT/web/icons/icon-${s}.png" "$ROOT/build/icon-${s}.png" || true
done
[[ -f "$ROOT/web/icons/icon.ico" ]] && cp -f "$ROOT/web/icons/icon.ico" "$ROOT/build/icon.ico" || true
# Web builds no longer ship icons/icon.ico: make one from the 512px PNG for NSIS / Windows exe.
if [[ ! -f "$ROOT/build/icon.ico" && -f "$ROOT/build/icon.png" ]]; then
  python3 - "$ROOT/build/icon.png" "$ROOT/build/icon.ico" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).convert("RGBA").save(sys.argv[2], sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("build/icon.ico generated")
PY
fi

python3 "$SCRIPTS/write-branding.py" "$ROOT"
python3 "$SCRIPTS/write-package-json.py" "$ROOT"
python3 "$SCRIPTS/write-installer-nsi.py" "$ROOT"
python3 "$SCRIPTS/make-ms-store-assets.py" "$ROOT" || true

bash "$SCRIPTS/privacy-scan.sh" "$ROOT"

export CSC_IDENTITY_AUTO_DISCOVERY=false
unset ANDROID_KEYSTORE ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD || true
unset CSC_LINK CSC_KEY_PASSWORD WIN_CSC_LINK || true

[[ -d node_modules/electron ]] || npm install

rm -rf dist
mkdir -p dist
TARGETS="${BUILD_TARGETS:-all}"

if [[ "$TARGETS" == "all" || "$TARGETS" == "win" || "$TARGETS" == "windows" ]]; then
  if [[ "${BUILD_SKIP_ZIP:-0}" == "1" ]]; then
    echo "== Windows portable (no zip) =="
    ./node_modules/.bin/electron-builder --win portable --x64
  else
    echo "== Windows portable + zip =="
    ./node_modules/.bin/electron-builder --win portable zip --x64
  fi
  echo "== Windows NSIS =="
  [[ -d dist/win-unpacked ]] || ./node_modules/.bin/electron-builder --win --dir --x64
  MAKENSIS="$(command -v makensis || true)"
  if [[ -z "$MAKENSIS" ]]; then
    for cand in       "/c/Program Files (x86)/NSIS/makensis.exe"       "/c/Program Files/NSIS/makensis.exe"       "C:/Program Files (x86)/NSIS/makensis.exe"       "C:/Program Files/NSIS/makensis.exe"; do
      if [[ -f "$cand" ]]; then MAKENSIS="$cand"; break; fi
    done
  fi
  if [[ -z "$MAKENSIS" ]]; then
    echo "ERROR: makensis not found. Install NSIS and add it to PATH." >&2
    exit 1
  fi
  echo "using makensis: $MAKENSIS"
  ( cd build && "$MAKENSIS" -V2 installer.nsi )
fi

if [[ "$TARGETS" == "all" || "$TARGETS" == "linux" ]]; then
  echo "== Linux AppImage + deb =="
  ./node_modules/.bin/electron-builder --linux AppImage deb --x64
fi

if [[ "$TARGETS" == "appx" || "$TARGETS" == "msix" ]]; then
  echo "== Windows AppX / MSIX (unsigned Store package) =="
  python3 "$SCRIPTS/make-ms-store-assets.py" "$ROOT"
  # Needs Windows tooling (makeappx). On Linux electron-builder uses wine.
  ./node_modules/.bin/electron-builder --win appx --x64
fi

echo "== Artifacts =="
python3 - <<'PY'
from pathlib import Path
for p in sorted(Path("dist").iterdir()):
    if p.is_file() and (p.suffix.lower() in {".exe",".zip",".deb",".appx",".msix"} or p.name.endswith(".AppImage")):
        print(f"{p.name:50s} {p.stat().st_size/1024/1024:8.1f} MB")
PY
echo "== DONE $PRODUCT $VERSION =="
echo "Data folder slug: $SLUG  (Linux ~/.config/$SLUG , Windows %APPDATA%\\\\$SLUG)"
