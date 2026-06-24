#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.macos-signing.local"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Missing $ENV_FILE"
  echo "Copy .env.macos-signing.example to .env.macos-signing.local and fill in your Apple credentials."
  exit 1
fi

missing=()
[[ -z "${APPLE_SIGNING_IDENTITY:-}" ]] && missing+=("APPLE_SIGNING_IDENTITY")
[[ -z "${APPLE_TEAM_ID:-}" ]] && missing+=("APPLE_TEAM_ID")

has_apple_id_auth=$([[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" ]] && echo 1 || echo 0)
has_api_auth=$([[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_PATH:-}" ]] && echo 1 || echo 0)

if (( ${#missing[@]} > 0 )); then
  echo "Missing required variables in $ENV_FILE:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

if (( has_apple_id_auth + has_api_auth != 1 )); then
  echo "Set either Apple ID auth (APPLE_ID + APPLE_PASSWORD) or API key auth"
  echo "(APPLE_API_ISSUER + APPLE_API_KEY + APPLE_API_KEY_PATH) in $ENV_FILE."
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  echo "Signing identity not found in Keychain:"
  echo "  $APPLE_SIGNING_IDENTITY"
  echo
  echo "Install a Developer ID Application certificate, then rerun:"
  echo "  security find-identity -v -p codesigning"
  exit 1
fi

cd "$ROOT"
echo "Building signed + notarized macOS bundle..."
npm run tauri build -- --bundles dmg

APP="$ROOT/src-tauri/target/release/bundle/macos/Gitty.app"
DMG="$ROOT/src-tauri/target/release/bundle/dmg/Gitty_0.1.0_aarch64.dmg"

echo
echo "Build finished."
echo "  App: $APP"
echo "  DMG: $DMG"
echo
echo "Verify notarization:"
echo "  spctl -a -vv --type execute \"$APP\""
echo "  xcrun stapler validate \"$APP\""
