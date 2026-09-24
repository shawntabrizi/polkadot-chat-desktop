#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M12h:')" ] || fail "no M12h commit in history"
npm run check >/tmp/m12h-check.log 2>&1 || { tail -40 /tmp/m12h-check.log; fail "npm run check failed"; }
start=$(date +%s); out=$(npm run screenshots 2>&1 | tail -3) || true; end=$(date +%s)
echo "$out"; echo "screenshots took $((end-start)) s"
echo "$out" | grep -q SCREENSHOTS_OK || fail "screenshots failed"
[ $((end-start)) -le 180 ] || fail "full screenshot pass over 180 s"
grep -q '## M12h' docs/acceptance.md || fail "no M12h acceptance section"
echo "CHECK PASS: M12h"
