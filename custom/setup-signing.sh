#!/bin/bash
# One-time local signing identity setup. Run only after approving keychain changes.
set -euo pipefail

IDENTITY="StenoAI Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Never silently replace an existing certificate: doing so changes app identity.
if security find-certificate -c "$IDENTITY" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "$IDENTITY already exists; keep it to preserve app identity."
  security find-identity -v -p codesigning "$KEYCHAIN"
  exit 0
fi

umask 077
mkdir -p "$ROOT/work/signing"
TASK_TMP="$(mktemp -d "$ROOT/work/signing/setup.XXXXXX")"
trap 'rm -rf "$TASK_TMP"; rmdir "$ROOT/work/signing" 2>/dev/null || true' EXIT
cat > "$TASK_TMP/openssl.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = signing
prompt = no
[dn]
CN = StenoAI Local Signing
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

/usr/bin/openssl req -new -newkey rsa:3072 -nodes -x509 -sha256 -days 3650 \
  -config "$TASK_TMP/openssl.cnf" -keyout "$TASK_TMP/key.pem" \
  -out "$TASK_TMP/cert.pem"
/usr/bin/openssl rand -hex 32 > "$TASK_TMP/password"
/usr/bin/openssl pkcs12 -export -inkey "$TASK_TMP/key.pem" \
  -in "$TASK_TMP/cert.pem" -name "$IDENTITY" -out "$TASK_TMP/identity.p12" \
  -passout "file:$TASK_TMP/password"

# Authorize codesign only, not every application. No global key ACL changes.
security import "$TASK_TMP/identity.p12" -k "$KEYCHAIN" \
  -P "$(cat "$TASK_TMP/password")" -T /usr/bin/codesign
# User-level trust for code signing only; no SSL trust or system keychain edits.
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TASK_TMP/cert.pem"
security find-identity -v -p codesigning "$KEYCHAIN"
echo "Created $IDENTITY. Keep this certificate and private key for future builds."
