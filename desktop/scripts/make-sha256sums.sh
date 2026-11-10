#!/usr/bin/env bash
# Write SHA256SUMS.txt for every package in a directory (default: dist/).
set -euo pipefail
DIR="${1:-dist}"
OUT="${2:-$DIR/SHA256SUMS.txt}"
cd "$DIR"
# shellcheck disable=SC2035
sha256sum *.exe *.zip *.deb *.AppImage *.apk 2>/dev/null | sort > "$(basename "$OUT")" || true
# If OUT is inside DIR, we wrote basename; move if needed
if [[ "$(basename "$OUT")" != "SHA256SUMS.txt" ]] || [[ "$OUT" != "$DIR/SHA256SUMS.txt" && "$OUT" != "./SHA256SUMS.txt" ]]; then
  mv -f SHA256SUMS.txt "$OUT" 2>/dev/null || true
fi
echo "Wrote checksums:"
cat "${OUT##*/}" 2>/dev/null || cat "$OUT"
