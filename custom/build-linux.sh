#!/bin/bash
# Build the Linux AppImage from this checkout (x86_64).
#
#   custom/build-linux.sh              # full build: backend + AppImage
#   custom/build-linux.sh --app-only   # renderer/main-only edits, existing backend
#
# Needs Python 3.11, Node 24 LTS (minimum 22.12) and libportaudio2.
# Output: app/dist/stenoAI-linux-<version>-x86_64.AppImage. Set OUT=dist-new
# to build next to a running AppImage instead of overwriting it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON311="${PYTHON311:-$(command -v python3.11 || true)}"
OUT="${OUT:-dist}"
cd "$ROOT"
[ "$(uname -s)" = Linux ] || { echo 'This script builds the Linux AppImage.' >&2; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22 || a===22&&b<12) process.exit(1)" \
  || { echo 'Use Node 24 LTS (minimum 22.12).' >&2; exit 1; }

if [ "${1:-}" != "--app-only" ]; then
  echo "==> Python environment"
  if [ ! -x .venv/bin/python ]; then
    [ -n "$PYTHON311" ] || { echo 'Install Python 3.11 or set PYTHON311.' >&2; exit 1; }
    "$PYTHON311" -m venv .venv
    .venv/bin/python -m pip install -q --upgrade pip
  fi
  .venv/bin/pip install -q -r requirements.txt -c custom/constraints.txt pyinstaller

  echo "==> Bundled binaries (Ollama, ffmpeg)"
  [ -x bin/ollama ] && [ -x bin/ffmpeg ] || scripts/download-ollama.sh

  echo "==> Backend (PyInstaller)"
  rm -rf build dist
  .venv/bin/pyinstaller stenoai.spec --noconfirm > custom/.pyinstaller.log 2>&1 \
    || { tail -30 custom/.pyinstaller.log; exit 1; }
  # Proves onnxruntime, onnx-asr and sherpa-onnx load from the frozen bundle.
  dist/stenoai/stenoai onnx-selftest
fi
[ -x dist/stenoai/stenoai ] || { echo 'No bundled backend; run without --app-only first.' >&2; exit 1; }

echo "==> Electron app"
cd app
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build:renderer
# package.json packs everything under app/ except dist/, so a second output
# folder (OUT=dist-new) would end up inside the next build. Keep them all out.
mapfile -t FILES < <(node -p "require('./package.json').build.files.concat('!dist-*/**/*').map(f => '-c.files=' + f).join('\\n')")
npx --no-install electron-builder --linux AppImage --publish=never "-c.directories.output=$OUT" "${FILES[@]}"
echo "==> Built $(ls -t "$ROOT/app/$OUT"/*.AppImage | head -1)"
