#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M11:')" ] || fail "no M11 commit in history"
for f in docs/spec/vectors-0007.md docs/spec/contracts/meter.md src/main/chain/assetHub.ts scripts/e2e-meter.mjs; do [ -f "$f" ] || fail "missing $f"; done
grep -q "'transactionReference'" src/renderer/domain/chat/content.ts || fail "reference kind missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m11-check.log 2>&1 || { tail -40 /tmp/m11-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:meter 2>&1 | tail -20) || true
echo "$out"
echo "$out" | grep -q METER_OK || fail "meter e2e did not reach METER_OK"
for t in berlin-day berlin-night; do for f in room-tx room-tx-done; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M11' docs/acceptance.md || fail "no M11 acceptance section"
echo "CHECK PASS: M11"
