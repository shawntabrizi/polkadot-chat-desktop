#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12f:')" ] || fail "no M12f commit in history"
[ -f docs/spec/vectors-0008c.md ] || fail "vectors-0008c missing"
grep -q "pending" src/renderer/domain/chat/identityEvents.ts || fail "pending not decoded"
npm run check >/tmp/m12f-check.log 2>&1 || { tail -40 /tmp/m12f-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 900 npm run e2e:meter 2>&1 | tail -12) || true
echo "$out"
echo "$out" | grep -q METER_OK || fail "meter e2e failed"
echo "$out" | grep -q HEADER_MATCHES_BALANCE || fail "header does not match /balance"
grep -q '## M12f' docs/acceptance.md || fail "no M12f acceptance section"
echo "CHECK PASS: M12f"
