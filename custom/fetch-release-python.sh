#!/bin/bash
# Put the pinned release-build Python in /Users/Shared/stenoai-build/python3.11,
# verified against its sha256. Prints the interpreter's path.
#
# Release DMGs must load on the app's floor (macOS 14.4). A Homebrew Python is a
# bottle built for the Mac it was poured on, so on a macOS 27 Mac the bundled
# Python needs macOS 27. python-build-standalone targets macOS 11. It lives
# outside the home folder so no username lands in the bundled libraries.
set -euo pipefail

TAG=20261110
ASSET=cpython-3.11.18+$TAG-aarch64-apple-darwin-install_only.tar.gz
SHA=73f1ed14486aa278d331e95f7d6d452f5cfb69d90b418e26e62fd4846d53557d
DEST=/Users/Shared/stenoai-build/python3.11
PY="$DEST/bin/python3.11"
STAMP="$DEST/.stenoai-asset"

if [ ! -x "$PY" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$ASSET" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  gh release download "$TAG" -R astral-sh/python-build-standalone -p "$ASSET" -D "$TMP" >&2
  [ "$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)" = "$SHA" ] \
    || { echo "Downloaded $ASSET does not match the pinned sha256" >&2; exit 1; }
  mkdir -p "$TMP/x" "$(dirname "$DEST")"
  tar -xzf "$TMP/$ASSET" -C "$TMP/x"
  rm -rf "$DEST"
  mv "$TMP/x/python" "$DEST"
  echo "$ASSET" > "$STAMP"
fi
echo "$PY"
