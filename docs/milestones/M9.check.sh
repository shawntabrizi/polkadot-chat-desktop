#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M9:')" ] || fail "no M9 commit in history"
[ -f docs/spec/vectors-0005.md ] && [ -f scripts/e2e-typing.mjs ] || fail "M9 files missing"
grep -q "'typing'" src/renderer/domain/chat/content.ts && grep -q "'seen'" src/renderer/domain/chat/content.ts || fail "content kinds missing"
npm run check >/tmp/m9-check.log 2>&1 || { tail -40 /tmp/m9-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 480 npm run e2e:typing 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q TYPING_OK || fail "typing e2e did not reach TYPING_OK (is pcdpirate on the pca branch with the typing half?)"
for t in berlin-day berlin-night; do for f in room-typing room-seen; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M9' docs/acceptance.md || fail "no M9 acceptance section"
echo "CHECK PASS: M9"
