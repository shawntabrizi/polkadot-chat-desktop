#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12g:')" ] || fail "no M12g commit in history"
[ -f scripts/e2e-pay.mjs ] || fail "e2e-pay missing"
grep -rq "Request PAS" src/renderer/ui || fail "request missing"
grep -rq "Send PAS" src/renderer/ui || fail "send missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m12g-check.log 2>&1 || { tail -40 /tmp/m12g-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:pay 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q PAY_OK || fail "pay e2e did not reach PAY_OK"
for t in berlin-day berlin-night; do for f in send-pas room-request room-request-paid; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M12g' docs/acceptance.md || fail "no M12g acceptance section"
echo "CHECK PASS: M12g"
