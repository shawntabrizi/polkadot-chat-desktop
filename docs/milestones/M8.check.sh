#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M8:')" ] || fail "no M8 commit in history"
[ -f docs/spec/vectors-0006.md ] && [ -f src/shared/buttonsBlock.ts ] && [ -f scripts/e2e-buttons.mjs ] || fail "M8 files missing"
grep -q "'buttons'" src/renderer/domain/chat/content.ts && grep -q "'buttonPress'" src/renderer/domain/chat/content.ts || fail "content kinds missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m8-check.log 2>&1 || { tail -40 /tmp/m8-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 480 npm run e2e:buttons 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q BUTTONS_OK || fail "buttons e2e did not reach BUTTONS_OK (is pcdguide on the pca branch with BOT_PROTOCOL_EXTENSIONS=buttons?)"
for t in berlin-day berlin-night; do [ -f ".agent-runs/screens/$t/room-buttons.png" ] || fail "missing $t/room-buttons.png"; done
grep -q '## M8' docs/acceptance.md || fail "no M8 acceptance section"
echo "CHECK PASS: M8"
