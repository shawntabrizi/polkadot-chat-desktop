#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12e:')" ] || fail "no M12e commit in history"
grep -q "extractButtonsBlock" src/shared/buttonsBlock.ts || fail "lenient parser missing"
grep -rq "Withdraw request" src/renderer/ui || fail "withdraw missing"
grep -rq "Delete chat" src/renderer/ui || fail "delete chat missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m12e-check.log 2>&1 || { tail -40 /tmp/m12e-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 300 npm run e2e:typing 2>&1 | tail -5) || true
echo "$out" | grep -q BUDGET_OK || { echo "$out"; fail "typing e2e failed"; }
for t in berlin-day berlin-night; do for f in chat-menu archived settings-privacy; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M12e' docs/acceptance.md || fail "no M12e acceptance section"
echo "CHECK PASS: M12e"
