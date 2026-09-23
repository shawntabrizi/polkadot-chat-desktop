#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12c:')" ] || fail "no M12c commit in history"
[ -f scripts/probe-statements.mjs ] || fail "probe script missing"
grep -q "10_000" src/renderer/domain/chat/signals.ts || fail "typing interval not 10 s"
grep -q "5_000" src/renderer/domain/chat/signals.ts || fail "seen window not 5 s"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m12c-check.log 2>&1 || { tail -40 /tmp/m12c-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 300 npm run e2e:typing 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q BUDGET_OK || fail "typing e2e did not reach BUDGET_OK"
grep -q 'PROBE\|probe' docs/acceptance.md || fail "no probe table in acceptance"
grep -q '## M12c' docs/acceptance.md || fail "no M12c acceptance section"
echo "CHECK PASS: M12c"
