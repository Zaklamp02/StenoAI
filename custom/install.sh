#!/bin/bash
# Replace /Applications/StenoAI.app with the custom build.
#
# Notes, settings and speaker profiles live in ~/Library/Application Support/
# stenoai and are untouched. The previous app is not kept: roll back to the
# official release or rebuild an earlier commit (see custom/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app/dist/mac-arm64/StenoAI.app"
TARGET=/Applications/StenoAI.app

[ -d "$APP" ] || { echo "No build at $APP — run custom/build.sh first" >&2; exit 1; }
codesign --verify --deep --strict "$APP"

if pgrep -f "$TARGET/Contents/MacOS/StenoAI" >/dev/null; then
  if [ -e "$HOME/Library/Application Support/stenoai/.recording-active" ] \
    || pgrep -f "stenoai/stenoai (record|process-streaming|reprocess|transcribe-stream)" >/dev/null; then
    echo "StenoAI is recording or processing a meeting. Try again when it's done." >&2
    exit 1
  fi
  echo "==> Quitting StenoAI"
  osascript -e 'tell application "StenoAI" to quit' || true
  for _ in $(seq 1 20); do
    pgrep -f "$TARGET/Contents/MacOS/StenoAI" >/dev/null || break
    sleep 1
  done
  if pgrep -f "$TARGET/Contents/MacOS/StenoAI" >/dev/null; then
    echo "StenoAI did not quit; leaving the installed app in place." >&2
    exit 1
  fi
fi

echo "==> Installing $APP"
rm -rf "$TARGET"
ditto "$APP" "$TARGET"
codesign --verify --deep --strict "$TARGET"
open "$TARGET"
echo "==> Installed. After the first launch of a new build, macOS may ask again for"
echo "    microphone / system-audio access and for the 'StenoAI Safe Storage' keychain item."
