#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M10:')" ] || fail "no M10 commit in history"
[ -f docs/spec/vectors-0008.md ] && [ -f scripts/e2e-botinfo.mjs ] || fail "M10 files missing"
grep -q "'botInfo'" src/renderer/domain/chat/content.ts || fail "botInfo kind missing"
grep -rq "local:faucet" src/renderer || fail "Faucet contact missing"
npm run check >/tmp/m10-check.log 2>&1 || { tail -40 /tmp/m10-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 480 npm run e2e:botinfo 2>&1 | tail -12) || true
echo "$out"
echo "$out" | grep -q BOTINFO_OK || fail "botinfo e2e did not reach BOTINFO_OK"
for t in berlin-day berlin-night; do for f in room-bot faucet search-bots; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing $t/$f.png"; done; done
grep -q '## M10' docs/acceptance.md || fail "no M10 acceptance section"
echo "CHECK PASS: M10"
