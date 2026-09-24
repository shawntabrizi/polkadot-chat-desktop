#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M15a:')" ] || fail "no M15a commit in history"
[ -f scripts/e2e-attach.mjs ] || fail "e2e-attach missing"
npm run check >/tmp/m15a-check.log 2>&1 || { tail -40 /tmp/m15a-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:attach 2>&1 | tail -12) || true
echo "$out"
echo "$out" | grep -q ATTACH_OK || fail "attach e2e failed"
for t in berlin-day berlin-night; do for f in room-attachment composer-attach; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M15a' docs/acceptance.md || fail "no M15a acceptance section"
echo "CHECK PASS: M15a"
