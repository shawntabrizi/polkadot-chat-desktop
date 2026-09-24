#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12d:')" ] || fail "no M12d commit in history"
grep -q "memo(" src/renderer/ui/MessageBubble.tsx || fail "MessageBubble not memoized"
npm run check >/tmp/m12d-check.log 2>&1 || { tail -40 /tmp/m12d-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 300 npm run e2e:typing 2>&1 | tail -5) || true
echo "$out" | grep -q BUDGET_OK || { echo "$out"; fail "typing e2e failed"; }
grep -q '## M12d' docs/acceptance.md || fail "no M12d acceptance section"
echo "CHECK PASS: M12d"
