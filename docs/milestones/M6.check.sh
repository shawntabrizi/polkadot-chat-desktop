#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M6:')" ] || fail "no M6 commit in history"
for f in src/main/assistant/engines/claude.ts src/main/assistant/engines/codex.ts src/main/assistant/engines/opencode.ts src/main/assistant/toolPolicy.ts src/main/menu.ts scripts/e2e-engines.mjs; do [ -f "$f" ] || fail "missing $f"; done
grep -q "isComposing" src/renderer/ui/Composer.tsx || fail "IME guard missing in composer"
grep -q "setBadge" src/main/ipc.ts src/main/index.ts 2>/dev/null || fail "dock badge IPC missing"
! grep -rq "AlertDialog\|window.confirm" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m6-check.log 2>&1 || { tail -40 /tmp/m6-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 600 npm run e2e:engines 2>&1 | tail -12) || true
echo "$out"
echo "$out" | grep -q ENGINES_OK || fail "e2e:engines did not reach ENGINES_OK"
for t in berlin-day berlin-night; do for f in settings assistant keyboard; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing screenshot $t/$f.png"; done; done
grep -q '## M6' docs/acceptance.md || fail "no M6 acceptance section"
echo "CHECK PASS: M6"
