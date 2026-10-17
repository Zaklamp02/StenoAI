#!/bin/bash
# Build the custom StenoAI app from this checkout.
#
# Only the Python backend and the Electron app are built here. The native
# helpers (Swift sidecars, Ollama, ffmpeg) are taken from the matching official
# release, so no Swift 6 / Xcode toolchain is needed.
#
#   custom/build.sh [/path/to/official/StenoAI.app]
#
# Output: app/dist/mac-arm64/StenoAI.app (locally certificate-signed). Install it with
# custom/install.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OFFICIAL="${1:-$HOME/code/stenoai-official/StenoAI.app}"
PYTHON311="${PYTHON311:-$HOME/anaconda3/bin/python3.11}"
cd "$ROOT"

echo "==> Staging native binaries from $OFFICIAL"
custom/stage-official-binaries.sh "$OFFICIAL"

echo "==> Python environment"
if [ ! -x .venv/bin/python ]; then
  "$PYTHON311" -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
fi
.venv/bin/pip install -q -r requirements.txt -c custom/constraints.txt pyinstaller

echo "==> Backend (PyInstaller)"
rm -rf build dist
.venv/bin/pyinstaller stenoai.spec --noconfirm > custom/.pyinstaller.log 2>&1 \
  || { tail -30 custom/.pyinstaller.log; exit 1; }
test -x dist/stenoai/stenoai
test -x dist/stenoai/_internal/steno-diarize
test -x dist/stenoai/_internal/steno-audio-encode
.venv/bin/python scripts/verify_mlx_bundle.py

echo "==> Calendar helper (EventKit)"
mkdir -p bin-custom
swiftc -O -target arm64-apple-macos14.0 custom/calendar-helper/steno-calendar.swift \
  -o bin-custom/steno-calendar

echo "==> Electron app"
custom/package.sh

APP="$ROOT/app/dist/mac-arm64/StenoAI.app"
codesign --verify --deep --strict "$APP"
echo "==> Built $APP"
echo "    based on official $(cat "$ROOT/bin/.official-version"), branch $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$ROOT" rev-parse --short HEAD)"
