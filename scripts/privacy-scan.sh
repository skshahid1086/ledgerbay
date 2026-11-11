#!/usr/bin/env bash
# Fail if private customer data, keystores, LAN IPs, or secrets appear in the
# desktop/repo tree. Allowlist only clearly fake sample GSTINs/phones used in
# demo SOURCE (never ship personal/ or real backups into the repo).
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

ALLOW_GSTIN=(
  "27ABCDE1234F1Z0"
  "29AAACB4321B1ZB"
  "27XYZAB9876C1ZY"
  "27AAACA1111A1ZS"
  "29AAAAA0000A1Z5"   # common fake
  "27AAAAA0000A1Z5"
  "27AABCR1234A1Z2"
  "22AAAAA0000A1Z5"   # party-form placeholder (legacy)
  "22AAAAA0000A1ZC"   # party-form placeholder (valid checksum)
)
ALLOW_PHONE=(
  "9820088990"
  "9820112345"
  "9980267890"
  "9845011223"
  "9819944556"
  "9811099887"
  "9999999999"        # smoke
  "9000000000"
)

EXCLUDE_DIRS=(
  "./node_modules" "./dist" "./.git" "./screens" "./web/vendor"
  "./desktop/node_modules" "./desktop/dist" "./app/vendor"
)

# Build find prune
PRUNE=()
for d in "${EXCLUDE_DIRS[@]}"; do
  PRUNE+=( -path "$d" -o )
done
# drop trailing -o (bash 3.2 on macOS has no negative array subscripts)
if [[ ${#PRUNE[@]} -gt 0 ]]; then
  last=$((${#PRUNE[@]} - 1))
  unset "PRUNE[$last]"
fi

fail=0
hits_file=$(mktemp)

echo "== privacy-scan: root=$ROOT =="

# Forbidden paths / filenames (never in a public repo or desktop package)
while IFS= read -r -d '' f; do
  echo "FORBIDDEN_PATH $f" | tee -a "$hits_file"
  fail=1
done < <(find . \( "${PRUNE[@]}" \) -prune -o \( \
  -iname '*.jks' -o -iname '*.keystore' -o -iname 'keystore.properties' \
  -o -iname '.env' -o -iname '.env.*' -o -iname '*secret*' \
  -o -iname 'ledgerbay-mydata-backup.json' -o -iname 'personal-seed.json' \
  -o -iname 'google-services.json' -o -path '*/personal/*' \
  -o -path '*/sync-data/*' -o -path '*/sync-data-test-*/*' \
  \) -print0 2>/dev/null || true)

# Text scan (skip binaries / huge vendor)
SCAN_FILES=$(find . \( "${PRUNE[@]}" \) -prune -o -type f \
  \( -name '*.js' -o -name '*.mjs' -o -name '*.html' -o -name '*.css' -o -name '*.json' \
     -o -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.sh' -o -name '*.nsi' \
     -o -name '*.txt' -o -name '*.desktop' \) -print 2>/dev/null || true)

is_allow_gstin() {
  local g="$1"
  for a in "${ALLOW_GSTIN[@]}"; do [[ "$g" == "$a" ]] && return 0; done
  return 1
}
is_allow_phone() {
  local p="$1"
  # strip spaces
  p="${p// /}"
  for a in "${ALLOW_PHONE[@]}"; do [[ "$p" == "$a" ]] && return 0; done
  return 1
}

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  # GSTIN-like
  while IFS= read -r g; do
    [[ -z "$g" ]] && continue
    if ! is_allow_gstin "$g"; then
      echo "GSTIN $g in $f" | tee -a "$hits_file"
      fail=1
    fi
  done < <(grep -oE '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9][Z][A-Z0-9]' "$f" 2>/dev/null | sort -u || true)

  # 10-digit phones (avoid matching versions / timestamps loosely)
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if ! is_allow_phone "$p"; then
      # skip obvious non-phones in package-lock hashes etc — only flag in app/web/docs
      case "$f" in
        *package-lock.json|*yarn.lock|*package.json) continue ;;
      esac
      echo "PHONE $p in $f" | tee -a "$hits_file"
      fail=1
    fi
  done < <(grep -oE '[^0-9]([6-9][0-9]{9})[^0-9]' "$f" 2>/dev/null | grep -oE '[6-9][0-9]{9}' | sort -u || true)

  # Private LAN / Tailscale
  if grep -nE '192\.168\.[0-9]+\.[0-9]+|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+' "$f" >/dev/null 2>&1; then
    # allow documented examples in README that use x placeholder
    if grep -nE '192\.168\.[0-9]+\.[0-9]+|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+' "$f" \
      | grep -vE '192\.168\.x\.|192\.168\.\*\.|example|EXAMPLE|placeholder|e\.g\.|eg\.' >/dev/null; then
      echo "LAN_IP in $f:" | tee -a "$hits_file"
      grep -nE '192\.168\.[0-9]+\.[0-9]+|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+' "$f" \
        | grep -vE '192\.168\.x\.|192\.168\.\*\.|example|EXAMPLE|placeholder|e\.g\.' | head -5 | tee -a "$hits_file" || true
      fail=1
    fi
  fi
done <<< "$SCAN_FILES"

if [[ "$fail" -ne 0 ]]; then
  echo "== privacy-scan FAILED =="
  cat "$hits_file"
  rm -f "$hits_file"
  exit 1
fi
rm -f "$hits_file"
echo "== privacy-scan OK =="
