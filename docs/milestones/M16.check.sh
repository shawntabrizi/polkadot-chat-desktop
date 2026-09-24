#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M16:')" ] || fail "no M16 commit in history"
[ -f scripts/e2e-group2.mjs ] && [ -f src/renderer/domain/chat/groupKeys.ts ] || fail "M16 files missing"
npm run check >/tmp/m16-check.log 2>&1 || { tail -40 /tmp/m16-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:group2 2>&1 | tail -14) || true
echo "$out"
echo "$out" | grep -q GROUP2_OK || fail "group2 e2e did not reach GROUP2_OK"
for t in berlin-day berlin-night; do for f in room-group2 group2-members; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M16' docs/acceptance.md || fail "no M16 acceptance section"
echo "CHECK PASS: M16"
