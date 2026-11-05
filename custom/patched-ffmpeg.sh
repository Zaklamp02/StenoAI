#!/bin/bash
# Print the path of a minimal ffmpeg built from the version pinned in
# scripts/build-ffmpeg-minimal.sh, building it once per pin.
#
# The official app's helper is 7.1.1, which lacks AAC decoder and MOV/CAF/WAV
# parser fixes the 2026-11-05 security review asked for (F03). The custom
# build stages the official helpers and then puts this one in place of its
# ffmpeg (custom/stage-official-binaries.sh). The cache key includes the build
# script's hash, so changing the version, checksum or configure flags rebuilds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/scripts/build-ffmpeg-minimal.sh"
VERSION="$(sed -n 's/^FFMPEG_VERSION="\(.*\)"$/\1/p' "$BUILD")"
KEY="$(shasum -a 256 "$BUILD" | cut -c1-12)"
OUT="$ROOT/.local/ffmpeg/$VERSION-$KEY/ffmpeg"

if [ ! -x "$OUT" ]; then
  "$BUILD" "$OUT" >&2
fi
if ! "$OUT" -hide_banner -version | head -1 | grep -q "^ffmpeg version $VERSION "; then
  echo "Built ffmpeg does not report version $VERSION" >&2
  exit 1
fi
echo "$OUT"
