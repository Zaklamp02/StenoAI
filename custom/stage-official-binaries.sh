#!/bin/bash
# Fill bin/ with the prebuilt native helpers from an installed official StenoAI.
#
# Our changes are Python and JavaScript only, so instead of compiling the Swift
# helpers (steno-diarize needs Swift 6) and downloading Ollama/ffmpeg, reuse the
# binaries Steno Labs already built for the same release. stenoai.spec then
# bundles them exactly as the release workflow does.
#
#   custom/stage-official-binaries.sh [/path/to/official/StenoAI.app]
set -euo pipefail

OFFICIAL="${1:-$HOME/code/stenoai-official/StenoAI.app}"
INTERNAL="$OFFICIAL/Contents/Resources/stenoai/_internal"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin"

if [ ! -d "$INTERNAL/ollama" ]; then
  echo "No official StenoAI bundle at $OFFICIAL" >&2
  exit 1
fi

rm -rf "$BIN"
mkdir -p "$BIN"
# Ollama + its runners and mic-monitor live under _internal/ollama in the bundle
cp -R "$INTERNAL/ollama/." "$BIN/"
for f in ffmpeg steno-diarize steno-audio-encode; do
  cp "$INTERNAL/$f" "$BIN/$f"
done

official_version=$(defaults read "$OFFICIAL/Contents/Info" CFBundleShortVersionString)
echo "$official_version" > "$BIN/.official-version"
echo "Staged binaries from official StenoAI $official_version:"
ls -la "$BIN"
