#!/usr/bin/env bash
# Dock reopen (docs/decisions.md "Dock reopen crash (2026-09-24)"). Runs the
# packaged app (npm run package) NOT headless, since the `activate` handler
# does nothing when headless. `--test-reopen` keeps the window hidden, closes
# it and reopens it through `activate` twice: REOPEN_OK.
# Then the owner's crash: a copy of the bundle in a temp folder is moved while
# it runs, then reopened. Before the fix the process died on a SIGTRAP (exit
# 133); now it must quit cleanly with REOPEN_MOVED (exit 0).
#
# Throwaway data folders only (PCD_USER_DATA_DIR); the owner's are never read.
set -euo pipefail
cd "$(dirname "$0")/.."
app="dist/mac-arm64/Polkadot Chat.app"
bin="$app/Contents/MacOS/Polkadot Chat"
if [ ! -x "$bin" ]; then
  echo "REOPEN_FAIL no packaged app at $app (run npm run package)"
  exit 1
fi

profile=$(mktemp -d -t pcd-reopen)
copy=""
trap 'rm -rf "$profile" ${copy:+"$copy"}' EXIT
echo "profile $profile"
out=$(PCD_USER_DATA_DIR="$profile" "$bin" --test-reopen 2>&1) || true
echo "$out" | grep -E '^REOPEN_' || true
echo "$out" | grep -q '^REOPEN_OK' || { echo "$out" | tail -20; exit 1; }
rm -rf "$profile"

copy=$(mktemp -d -t pcd-reopen-app)
profile=$(mktemp -d -t pcd-reopen)
cp -R "$app" "$copy/"
log="$copy/run.log"
PCD_USER_DATA_DIR="$profile" "$copy/Polkadot Chat.app/Contents/MacOS/Polkadot Chat" --test-reopen --test-reopen-moved > "$log" 2>&1 &
pid=$!
for _ in $(seq 1 300); do
  grep -q '^REOPEN_WAITING' "$log" && break
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
mv "$copy/Polkadot Chat.app" "$copy/Moved.app"
code=0
wait "$pid" || code=$?
grep -E '^REOPEN_' "$log" || true
echo "moved run exit $code"
if [ "$code" != 0 ] || ! grep -q '^REOPEN_MOVED' "$log"; then
  tail -20 "$log"
  echo "REOPEN_MOVED_FAIL"
  exit 1
fi
echo "REOPEN_MOVED_OK"
