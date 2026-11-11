#!/usr/bin/env bash
# Wrap the built web app into a signed Android APK with zapstore/goapk.
# No Android SDK, JDK or Gradle needed — goapk is a single self-contained binary.
#
#   go install github.com/zapstore/goapk@latest
#   ./scripts/build-apk.sh
#
# Environment overrides: PACKAGE, NAME, VERSION_CODE, VERSION_NAME, KEYSTORE, OUT.
set -euo pipefail
cd "$(dirname "$0")/.."

PACKAGE="${PACKAGE:-com.marc26z.nip44notes}"
NAME="${NAME:-NIP44 Notes}"
VERSION_CODE="${VERSION_CODE:-4}"
VERSION_NAME="${VERSION_NAME:-0.04}"
KEYSTORE="${KEYSTORE:-keystore.p12}"
OUT="${OUT:-dist/nip44notes-${VERSION_NAME}.apk}"

if ! command -v goapk >/dev/null 2>&1; then
  echo "goapk not found. Install it with: go install github.com/zapstore/goapk@latest" >&2
  exit 1
fi

npm run build

# Stage only the web assets the app needs. Building first keeps the staged
# copy out of the way of esbuild's clean rebuild of dist/.
WEB="dist/web"
rm -rf "$WEB"
mkdir -p "$WEB"
cp -r dist/index.html dist/styles.css dist/app.js dist/manifest.webmanifest \
  dist/sw.js dist/icons "$WEB"/

# Reuse one keystore for every release so the app updates in place.
if [ ! -f .keystore-password ]; then
  openssl rand -base64 24 > .keystore-password
  chmod 600 .keystore-password
fi
PASS="$(cat .keystore-password)"

if [ ! -f "$KEYSTORE" ]; then
  echo "Generating signing keystore at $KEYSTORE — keep it safe and reuse it for every release."
  KEYSTORE_PASSWORD="$PASS" goapk keygen --cn "Marc26z NIP44 Notes" "$KEYSTORE"
fi

mkdir -p dist
KEYSTORE_PASSWORD="$PASS" goapk build -s "$WEB" \
  --package "$PACKAGE" \
  --name "$NAME" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --icon icons/icon-512.png \
  --keystore "$KEYSTORE" \
  "$OUT"

echo "Built $OUT"
