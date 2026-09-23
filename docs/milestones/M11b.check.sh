#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M11b:')" ] || fail "no M11b commit in history"
[ ! -f src/shared/meter.ts ] || fail "meter constants still present"
[ -f docs/spec/contracts/flip.md ] && [ -f scripts/e2e-flip.mjs ] || fail "M11b files missing"
npm run check >/tmp/m11b-check.log 2>&1 || { tail -40 /tmp/m11b-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:meter 2>&1 | tail -6) || true
echo "$out" | grep -q METER_OK || { echo "$out"; fail "meter e2e regressed"; }
out=$(with_timeout 1200 npm run e2e:flip 2>&1 | tail -20) || true
echo "$out"
echo "$out" | grep -q FLIP_OK || fail "flip e2e did not reach FLIP_OK"
for t in berlin-day berlin-night; do for f in pocket room-flip room-flip-done; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M11b' docs/acceptance.md || fail "no M11b acceptance section"
echo "CHECK PASS: M11b"
