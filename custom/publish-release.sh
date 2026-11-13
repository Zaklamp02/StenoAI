#!/bin/bash
# Publish the files custom/release.sh wrote for a tag as a full GitHub release.
#
#   custom/publish-release.sh v2026.11.2 notes.md
#
# The release is created as a draft, the large files are uploaded with retries
# (GitHub drops slow uploads with HTTP 408), every size is checked against the
# local file, and only then is it published. Installed apps read the newest
# full release, so they never see one with a missing or partial update file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:?usage: custom/publish-release.sh <tag> <notes.md>}"
NOTES="${2:?usage: custom/publish-release.sh <tag> <notes.md>}"
REPO="Zaklamp02/StenoAI"
OUT="$ROOT/.local/release"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a vYYYY.M.N tag: $TAG" >&2; exit 1; }
[ -f "$NOTES" ] || { echo "No notes file: $NOTES" >&2; exit 1; }

DMG="StenoAI-$TAG-arm64.dmg"
ZIP="StenoAI-$TAG-arm64-mac.zip"
FILES=("$DMG.sha256" latest-mac.yml "$ZIP" "$DMG")
for f in "${FILES[@]}"; do
  [ -f "$OUT/$f" ] || { echo "Missing $OUT/$f; run custom/release.sh $TAG first." >&2; exit 1; }
done
# latest-mac.yml is shared by every release build; make sure it is this one's.
grep -qx "version: ${TAG#v}" "$OUT/latest-mac.yml" \
  || { echo "$OUT/latest-mac.yml is not for $TAG; rerun custom/release.sh $TAG." >&2; exit 1; }

size_of() { stat -f %z "$1"; }

RID="$(gh api "repos/$REPO/releases" --jq ".[] | select(.tag_name==\"$TAG\") | .id" | head -1)"
if [ -z "$RID" ]; then
  echo "==> Creating draft release $TAG"
  gh release create "$TAG" --repo "$REPO" --verify-tag --draft --title "StenoAI $TAG" --notes-file "$NOTES" >/dev/null
  RID="$(gh api "repos/$REPO/releases" --jq ".[] | select(.tag_name==\"$TAG\") | .id" | head -1)"
else
  [ "$(gh api "repos/$REPO/releases/$RID" --jq .draft)" = "true" ] \
    || { echo "$TAG is already published; not touching it." >&2; exit 1; }
  echo "==> Resuming draft release $TAG"
fi

remote_size() {
  gh api "repos/$REPO/releases/$RID/assets" --paginate \
    --jq ".[] | select(.name==\"$1\" and .state==\"uploaded\") | .size" | head -1
}
delete_asset() {
  for id in $(gh api "repos/$REPO/releases/$RID/assets" --paginate --jq ".[] | select(.name==\"$1\") | .id"); do
    gh api -X DELETE "repos/$REPO/releases/assets/$id" >/dev/null || true
  done
}

for f in "${FILES[@]}"; do
  want="$(size_of "$OUT/$f")"
  if [ "$(remote_size "$f")" = "$want" ]; then echo "    $f already uploaded"; continue; fi
  ok=""
  for try in 1 2 3 4 5; do
    delete_asset "$f"
    echo "==> Uploading $f ($want bytes), try $try"
    if curl -sS --fail --http1.1 -H "Expect:" -o /dev/null -X POST \
        -H "Authorization: Bearer $(gh auth token)" -H "Content-Type: application/octet-stream" \
        --data-binary "@$OUT/$f" \
        "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=$f" \
      && [ "$(remote_size "$f")" = "$want" ]; then
      ok=1; break
    fi
  done
  [ -n "$ok" ] || { echo "Could not upload $f; the release stays a draft. Rerun to resume." >&2; exit 1; }
done

echo "==> Publishing $TAG"
gh api -X PATCH "repos/$REPO/releases/$RID" -F draft=false -F prerelease=false -f make_latest=true \
  --jq '.html_url'
FEED="$(curl -sL "https://github.com/$REPO/releases/latest/download/latest-mac.yml" | grep '^version:' || true)"
[ "$FEED" = "version: ${TAG#v}" ] \
  && echo "==> Update feed now offers ${TAG#v}" \
  || echo "Warning: the update feed reads '$FEED'; check that $TAG is the latest release." >&2
