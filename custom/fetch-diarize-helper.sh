#!/bin/bash
# Put the pinned steno-diarize from custom/DIARIZE_HELPER in .local/helpers/,
# verified against its sha256. Prints the helper's path.
#
# The copy in .local/ is kept, so this works offline and after the CI
# artifact expires; only a missing or mismatched copy is downloaded again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="$ROOT/custom/DIARIZE_HELPER"
DEST="$ROOT/.local/helpers/steno-diarize"
field() { sed -n "s/^$1=//p" "$PIN"; }
RUN="$(field run)"
ARTIFACT="$(field artifact)"
SHA="$(field sha256)"

matches() { [ -f "$DEST" ] && [ "$(shasum -a 256 "$DEST" | cut -d' ' -f1)" = "$SHA" ]; }

if ! matches; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  gh run download "$RUN" -R stenolabs/stenoai -n "$ARTIFACT" -D "$TMP" >&2 \
    || { echo "Could not download $ARTIFACT from run $RUN (artifacts expire after a few days)." >&2
         echo "Pin a newer upstream e2e-backend-macos artifact in custom/DIARIZE_HELPER." >&2
         exit 1; }
  mkdir -p "$(dirname "$DEST")"
  cp "$TMP/_internal/steno-diarize" "$DEST"
  chmod 755 "$DEST"
  matches || { echo "Downloaded steno-diarize does not match the pinned sha256" >&2; rm -f "$DEST"; exit 1; }
fi
echo "$DEST"
