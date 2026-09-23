#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12:')" ] || fail "no M12 commit in history"
[ -f docs/spec/vectors-0009.md ] && [ -f scripts/e2e-group.mjs ] || fail "M12 files missing"
grep -q "'groupMessage'" src/renderer/domain/chat/content.ts || fail "group kinds missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m12-check.log 2>&1 || { tail -40 /tmp/m12-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:group 2>&1 | tail -20) || true
echo "$out"
echo "$out" | grep -q GROUP_OK || fail "group e2e did not reach GROUP_OK"
for t in berlin-day berlin-night; do for f in group-create room-group group-members; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M12' docs/acceptance.md || fail "no M12 acceptance section"
echo "CHECK PASS: M12"
