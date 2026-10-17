#!/bin/bash
# Fast path: rebuild the renderer and package the existing backend with stable signing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDENTITY="${STENOAI_SIGNING_IDENTITY:-StenoAI Local Signing}"
if [ -z "$IDENTITY" ] || [ "$IDENTITY" = "-" ]; then
  echo "A stable certificate identity is required (not ad-hoc signing)." >&2
  exit 1
fi
[ -x "$ROOT/dist/stenoai/stenoai" ] || {
  echo "No bundled backend; run custom/build.sh first." >&2; exit 1;
}

cd "$ROOT/app"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build:renderer
# Fail rather than falling back to ad-hoc. Keep the existing hardened runtime
# and entitlements. Local signatures don't need a network timestamp/notarization.
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder \
  --mac dir --arm64 --publish=never -c.forceCodeSigning=true \
  "-c.mac.identity=$IDENTITY" -c.mac.notarize=false -c.mac.timestamp=none

APP="$ROOT/app/dist/mac-arm64/StenoAI.app"
codesign --verify --deep --strict "$APP"
DETAILS="$(codesign -dv --verbose=4 "$APP" 2>&1)"
REQUIREMENT="$(codesign -dr - "$APP" 2>&1)"
echo "$DETAILS"
echo "$REQUIREMENT"
echo "$DETAILS" | grep -Fq "Authority=$IDENTITY"
echo "$DETAILS" | grep -Eq 'flags=.*runtime'
echo "$REQUIREMENT" | grep -Eq 'designated =>.*(anchor|certificate)'
if echo "$REQUIREMENT" | grep -q 'cdhash'; then
  echo "Designated requirement depends on build contents; refusing this build." >&2
  exit 1
fi
echo "==> Built $APP with a certificate-based designated requirement"
