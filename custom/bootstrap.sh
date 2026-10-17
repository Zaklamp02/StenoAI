#!/bin/bash
# Reproducible Apple Silicon source build. Never installs over a running app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] \
  || { echo 'This bootstrap supports Apple Silicon Macs.' >&2; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22 || a===22&&b<12) process.exit(1)" \
  || { echo 'Use Node 24 LTS (minimum 22.12).' >&2; exit 1; }
export PYTHON311="${PYTHON311:-$(command -v python3.11 || true)}"
[ -n "$PYTHON311" ] && "$PYTHON311" -c 'import sys; assert sys.version_info[:2] == (3,11)' \
  || { echo 'Install Python 3.11 and put python3.11 on PATH, or set PYTHON311.' >&2; exit 1; }
xcrun --find swiftc >/dev/null || { echo 'Install Xcode Command Line Tools: xcode-select --install' >&2; exit 1; }
"$PYTHON311" -c 'import platform; assert tuple(map(int, platform.mac_ver()[0].split(".")[:2])) >= (14,4), "macOS 14.4 or later is required"'
IDENTITY="${STENOAI_SIGNING_IDENTITY:-StenoAI Local Signing}"
IDENTITIES="$(security find-identity -v -p codesigning)"
grep -Fq "\"$IDENTITY\"" <<< "$IDENTITIES" \
  || { echo 'Create your per-Mac signing identity first: custom/setup-signing.sh' >&2; exit 1; }
OFFICIAL="${1:-$ROOT/.local/official/StenoAI.app}"
custom/fetch-official.sh "$OFFICIAL"
(cd app && npm ci --no-audit --no-fund)
custom/build.sh "$OFFICIAL"
