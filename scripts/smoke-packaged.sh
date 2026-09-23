#!/usr/bin/env bash
# Runs the packaged app (npm run package) with --smoke: it loads the renderer
# hidden and prints SMOKE_OK.
#
# It runs against a throwaway profile (PCD_USER_DATA_DIR, a new temp folder
# unless set). The packaged app has its own profile ("Polkadot Chat"), apart
# from `npm run dev`; a smoke run must still not open the owner's identity,
# and an unsigned binary reading a keychain entry would stop on a macOS
# permission prompt.
set -euo pipefail
cd "$(dirname "$0")/.."
app="dist/mac-arm64/Polkadot Chat.app"
bin="$app/Contents/MacOS/Polkadot Chat"
if [ ! -x "$bin" ]; then
  echo "SMOKE_FAIL no packaged app at $app (run npm run package)"
  exit 1
fi
profile="${PCD_USER_DATA_DIR:-$(mktemp -d -t pcd-smoke)}"
echo "profile $profile"
out=$(PCD_USER_DATA_DIR="$profile" "$bin" --smoke 2>&1) || true
echo "$out"
echo "$out" | grep -q '^SMOKE_OK' || exit 1
