#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M7:')" ] || fail "no M7 commit in history"
grep -rq "'deleted'" src/renderer/domain/chat/content.ts || fail "deleted content kind missing"
grep -rq "pendingDeletions" src/renderer/app/database.ts || fail "pending deletion table missing"
grep -rq "isLiveFrame" src/renderer || fail "live frame classifier missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m7-check.log 2>&1 || { tail -40 /tmp/m7-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 480 npm run e2e:chat -- pcdpeer.47 --delete 2>&1 | tail -20) || true
echo "$out"
echo "$out" | grep -q "DELETE_SENT" || fail "no DELETE_SENT"
echo "$out" | grep -q "E2E_OK" || fail "e2e did not reach E2E_OK"
grep -q "BOT_RECEIVED_DELETED" /tmp/pcdpeer.log || fail "bot did not log the deletion (is it on the pca RFC-0003 branch?)"
for t in berlin-day berlin-night; do [ -f ".agent-runs/screens/$t/room-deleted.png" ] || fail "missing $t/room-deleted.png"; done
grep -q '## M7' docs/acceptance.md || fail "no M7 acceptance section"
echo "CHECK PASS: M7"
