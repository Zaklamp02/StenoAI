#!/bin/bash
# Obtain the pinned upstream helpers without rebasing or changing Git history.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(cat "$ROOT/custom/BASE")"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid custom/BASE' >&2; exit 1; }
DEST="${1:-$ROOT/.local/official/StenoAI.app}"
if [ ! -d "$DEST" ]; then
  TMP="$(mktemp -d)"
  MOUNT="$TMP/mount"
  cleanup() { hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
  trap cleanup EXIT
  mkdir -p "$MOUNT" "$(dirname "$DEST")"
  curl --fail --location --retry 3 --output "$TMP/official.dmg" \
    "https://github.com/stenolabs/stenoai/releases/download/$TAG/stenoAI-macos-${TAG#v}-arm64.dmg"
  hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$TMP/official.dmg" >/dev/null
  codesign --verify --deep --strict "$MOUNT/StenoAI.app"
  DETAILS="$(codesign -dv "$MOUNT/StenoAI.app" 2>&1)"
  grep -Fq 'TeamIdentifier=HSDX294RG4' <<< "$DETAILS"
  spctl --assess --type execute "$MOUNT/StenoAI.app"
  ditto "$MOUNT/StenoAI.app" "$DEST"
fi
codesign --verify --deep --strict "$DEST"
DETAILS="$(codesign -dv "$DEST" 2>&1)"
grep -Fq 'TeamIdentifier=HSDX294RG4' <<< "$DETAILS"
[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/Contents/Info.plist")" = "${TAG#v}" ] \
  || { echo "Expected upstream $TAG at $DEST" >&2; exit 1; }
echo "Verified upstream $TAG helpers at $DEST"
