#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M7b:')" ] || fail "no M7b commit in history"
grep -rqi "No results for" src/renderer/ui || fail "empty state string missing"
grep -rq "scrollToMessageId" src/renderer/ui || fail "scroll-to-message missing"
npm run check >/tmp/m7b-check.log 2>&1 || { tail -40 /tmp/m7b-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
for t in berlin-day berlin-night; do for f in search search-empty; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M7b' docs/acceptance.md || fail "no M7b acceptance section"
echo "CHECK PASS: M7b"
