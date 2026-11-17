#!/bin/bash
# Build the custom StenoAI app from this checkout.
#
# Only the Python backend and the Electron app are built here. The native
# helpers (Swift sidecars, Ollama, ffmpeg) are taken from the matching official
# release. Xcode Command Line Tools compile this fork's Calendar helper.
#
#   custom/build.sh [/path/to/official/StenoAI.app]
#
# Output: app/dist/mac-arm64/StenoAI.app (locally certificate-signed). Install it with
# custom/install.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OFFICIAL="${1:-$ROOT/.local/official/StenoAI.app}"
PYTHON311="${PYTHON311:-$(command -v python3.11 || true)}"
cd "$ROOT"
if [ ! -x .venv/bin/python ] && [ -z "$PYTHON311" ]; then
  echo 'Python 3.11 is required. Run custom/bootstrap.sh for prerequisite checks.' >&2
  exit 1
fi

echo "==> Staging native binaries from $OFFICIAL"
custom/stage-official-binaries.sh "$OFFICIAL"

echo "==> Python environment"
if [ ! -x .venv/bin/python ]; then
  "$PYTHON311" -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
fi
.venv/bin/pip install -q -r requirements.txt -c custom/constraints.txt pyinstaller
# pip takes the wheel for the newest macOS it can, so on a macOS 26+ Mac mlx
# comes as a macosx_26_0 build that will not load on the app's 14.4 floor.
# Swap in the macosx_14_0 build of the same version (custom/check-macos-floor.py
# is the release gate that catches anything else like it).
MLX_PINS="$(.venv/bin/python -c 'from importlib.metadata import version as v; print(" ".join(p + "==" + v(p) for p in ("mlx", "mlx-metal")))')"
MLX_WHEELS="$(mktemp -d)"
# shellcheck disable=SC2086
.venv/bin/pip download -q --no-deps --only-binary=:all: --platform macosx_14_0_arm64 \
  --python-version 3.11 --implementation cp --abi cp311 --abi none -d "$MLX_WHEELS" $MLX_PINS
.venv/bin/pip install -q --no-deps --force-reinstall "$MLX_WHEELS"/*.whl
rm -rf "$MLX_WHEELS"

echo "==> Backend (PyInstaller)"
rm -rf build dist
.venv/bin/pyinstaller stenoai.spec --noconfirm > custom/.pyinstaller.log 2>&1 \
  || { tail -30 custom/.pyinstaller.log; exit 1; }
test -x dist/stenoai/stenoai
test -x dist/stenoai/_internal/steno-diarize
test -x dist/stenoai/_internal/steno-audio-encode
# The ffmpeg that ships must be the pinned, patched one (F03), never a copy
# of the official helper that a staging step brought back.
expected_ffmpeg="$(sed -n 's/^FFMPEG_VERSION="\(.*\)"$/\1/p' scripts/build-ffmpeg-minimal.sh)"
bundled_ffmpeg="$(find dist/stenoai -maxdepth 2 -name ffmpeg -type f -perm -u+x | head -1)"
if ! "$bundled_ffmpeg" -hide_banner -version | head -1 | grep -q "^ffmpeg version $expected_ffmpeg "; then
  echo "Bundled ffmpeg is not the pinned $expected_ffmpeg: $("$bundled_ffmpeg" -hide_banner -version | head -1)" >&2
  exit 1
fi
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
BUILD_BRANCH="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || echo source-archive)"
BUILD_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo uncommitted-source)"
echo "    based on official $(cat "$ROOT/bin/.official-version"), branch $BUILD_BRANCH @ $BUILD_COMMIT"
