#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12i:')" ] || fail "no M12i commit in history"
[ -f src/shared/demoBots.ts ] && [ -f scripts/e2e-demo.mjs ] || fail "demo files missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m12i-check.log 2>&1 || { tail -40 /tmp/m12i-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 300 npm run e2e:demo 2>&1 | tail -12) || true
echo "$out"
echo "$out" | grep -q DEMO_OK || fail "demo e2e failed"
echo "$out" | grep -q DEMO_IDEMPOTENT || fail "demo not idempotent"
for t in berlin-day berlin-night; do for f in demo-onboarding settings-demo; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M12i' docs/acceptance.md || fail "no M12i acceptance section"
echo "CHECK PASS: M12i"
