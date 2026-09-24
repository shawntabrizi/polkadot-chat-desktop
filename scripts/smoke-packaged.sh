#!/usr/bin/env bash
# Runs the packaged app (npm run package) with --smoke: it loads the renderer
# hidden and prints SMOKE_OK. Then with --agent-selftest (M13): the published
# agent's utility process loads bot-core from inside the package and prints
# AGENT_SELFTEST_OK.
# M18: the throwaway profile starts in the old single-profile layout (one
# window.json in the root); the packaged app must move it to
# profiles/default on its first start: MIGRATE_OK.
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
if [ ! -e "$profile/profiles.json" ]; then echo '{"width":900,"height":700}' > "$profile/window.json"; fi
out=$(PCD_HEADLESS=1 PCD_USER_DATA_DIR="$profile" "$bin" --smoke 2>&1) || true
echo "$out"
echo "$out" | grep -q '^SMOKE_OK' || exit 1
if [ -f "$profile/profiles.json" ] && [ -f "$profile/profiles/default/window.json" ] && [ ! -e "$profile/window.json" ]; then
  echo "MIGRATE_OK root holds $(ls -A "$profile" | tr '\n' ' ')"
else
  echo "MIGRATE_FAIL root holds $(ls -A "$profile" | tr '\n' ' ')"
  exit 1
fi
agent=$(PCD_HEADLESS=1 PCD_USER_DATA_DIR="$profile" "$bin" --agent-selftest 2>&1) || true
echo "$agent"
echo "$agent" | grep -q '^AGENT_SELFTEST_OK' || exit 1
