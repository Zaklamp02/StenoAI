#!/bin/bash
# Build a tester DMG from a clean checkout of a release tag.
#
#   custom/release.sh v2026.11.1
#
# The DMG is signed with the local signing identity but NOT notarized (no Apple
# Developer ID yet), so testers confirm it once in System Settings → Privacy &
# Security → Open Anyway. Output: .local/release/StenoAI-<tag>-arm64.dmg plus a
# .sha256 file. Upload both to the GitHub Release for that tag; never commit them.
#
# A vYYYY.M.N tag also gets the in-app update files: StenoAI-<tag>-arm64-mac.zip
# and latest-mac.yml. Installed apps signed with the same certificate download
# the zip from the newest full (not pre-) release and install it on restart, so
# publish those releases as full releases with all four files attached.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:?usage: custom/release.sh <tag>}"
git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null \
  || { echo "Unknown tag: $TAG" >&2; exit 1; }
# Installed apps compare their version against release tags (app/release-check.js),
# so a release is vYYYY.M.N and app/package.json at that tag carries YYYY.M.N.
if [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  TAGGED_VERSION="$(git -C "$ROOT" show "$TAG:app/package.json" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')" \
    || { echo "Could not read app/package.json at $TAG." >&2; exit 1; }
  [ "$TAGGED_VERSION" = "${TAG#v}" ] \
    || { echo "app/package.json at $TAG says $TAGGED_VERSION; bump it to ${TAG#v} and re-tag." >&2; exit 1; }
  UPDATE_VERSION="$TAGGED_VERSION"
elif [[ "$TAG" =~ ^v[0-9] ]]; then
  echo "$TAG looks like a version but is not vYYYY.M.N; installed apps would ignore it." >&2; exit 1
else
  echo "Note: $TAG is not a vYYYY.M.N tag, so installed apps will not offer it as an update." >&2
  echo "Publish it as a pre-release: a full release would hide the real latest version from the updater." >&2
fi
UPDATE_VERSION="${UPDATE_VERSION:-}"
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

# The verified helper cache outlives upstream's expiring CI artifact; the
# worktree's own .local/ starts empty.
if [ -d "$ROOT/.local/helpers" ]; then
  mkdir -p "$WORK/.local"
  cp -R "$ROOT/.local/helpers" "$WORK/.local/"
fi

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

[ -n "$UPDATE_VERSION" ] || exit 0

# In-app update files. ditto keeps the signature intact and puts StenoAI.app at
# the top of the zip, which is what ShipIt expects.
echo "==> Packaging in-app update"
ZIP="$OUT/StenoAI-$TAG-arm64-mac.zip"
MANIFEST="$OUT/latest-mac.yml"
rm -f "$ZIP" "$MANIFEST"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
# The tag's own script, so the macOS floor matches the build being shipped.
[ -f "$WORK/app/update-manifest.js" ] \
  || { echo "$TAG predates in-app updates (no app/update-manifest.js); publish the DMG only." >&2; exit 1; }
node "$WORK/app/update-manifest.js" "$ZIP" "$UPDATE_VERSION" "$MANIFEST"
echo "==> $ZIP ($(du -h "$ZIP" | cut -f1))"
echo
echo "Write the release notes to a file, then publish all four files as a full release:"
echo "  custom/publish-release.sh $TAG notes.md"
