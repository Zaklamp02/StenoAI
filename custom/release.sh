#!/bin/bash
# Build a tester DMG from a clean checkout of a release tag.
#
#   custom/release.sh test-2026-10-17
#
# The DMG is signed with the local signing identity but NOT notarized (no Apple
# Developer ID yet), so testers confirm it once in System Settings → Privacy &
# Security → Open Anyway. Output: .local/release/StenoAI-<tag>-arm64.dmg plus a
# .sha256 file. Upload both to the GitHub Release for that tag; never commit them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:?usage: custom/release.sh <tag>}"
git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null \
  || { echo "Unknown tag: $TAG" >&2; exit 1; }
IDENTITY="${STENOAI_SIGNING_IDENTITY:-StenoAI Local Signing}"
PYTHON311="${PYTHON311:-/opt/homebrew/bin/python3.11}"
# A Python installed under the home folder (Anaconda, pyenv) writes that path,
# and with it the builder's username, into the bundled libraries.
case "$("$PYTHON311" -c 'import sys; print(sys.base_prefix)')" in
  "$HOME"*) echo "Use a Python 3.11 outside your home folder (brew install python@3.11) or set PYTHON311." >&2; exit 1 ;;
esac

OFFICIAL="$ROOT/.local/official/StenoAI.app"
OUT="$ROOT/.local/release"
WORK="$OUT/build-$TAG"
mkdir -p "$OUT"
git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true
git -C "$ROOT" worktree add --detach "$WORK" "$TAG" >/dev/null
STAGE="$(mktemp -d)"
cleanup() { git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true; rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> Building $TAG from a clean checkout"
(cd "$WORK" && PYTHON311="$PYTHON311" custom/bootstrap.sh "$OFFICIAL")
APP="$WORK/app/dist/mac-arm64/StenoAI.app"
codesign --verify --deep --strict "$APP"

# Refuse to publish an app that carries the builder's username or home path.
if grep -rlaiF "$(id -un)" "$APP" >/dev/null 2>&1; then
  echo "The app contains your username; not packaging it:" >&2
  grep -rlaiF "$(id -un)" "$APP" | sed "s#^$APP/##" | head >&2
  exit 1
fi

echo "==> Packaging DMG"
ditto "$APP" "$STAGE/StenoAI.app"
ln -s /Applications "$STAGE/Applications"
cp "$ROOT/custom/DMG_README.txt" "$STAGE/Read me first.txt"
cp "$WORK/LICENSE" "$STAGE/LICENSE.txt"
DMG="$OUT/StenoAI-$TAG-arm64.dmg"
rm -f "$DMG" "$DMG.sha256"
hdiutil create -quiet -volname "StenoAI $TAG" -srcfolder "$STAGE" -format ULMO "$DMG"
codesign --sign "$IDENTITY" --timestamp=none "$DMG"
codesign --verify "$DMG"
(cd "$OUT" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")
echo "==> $DMG ($(du -h "$DMG" | cut -f1))"
cat "$DMG.sha256"
