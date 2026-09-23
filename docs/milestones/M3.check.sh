#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# macOS has no `timeout`; run the command directly when neither timeout nor gtimeout exists.
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
git log -1 --format=%s | grep -q '^M3:' || fail "last commit is not an M3 commit"
[ -f electron-builder.yml ] || fail "electron-builder.yml missing"
npm run check >/tmp/m3-check.log 2>&1 || { tail -40 /tmp/m3-check.log; fail "npm run check failed"; }
with_timeout 900 npm run package >/tmp/m3-package.log 2>&1 || { tail -30 /tmp/m3-package.log; fail "package failed"; }
ls dist/*.dmg >/dev/null 2>&1 || fail "no dmg in dist/"
out=$(with_timeout 120 npm run smoke:packaged 2>&1 | tail -5) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "packaged smoke failed"; }
grep -q '## M3' docs/acceptance.md || fail "no M3 acceptance section"
echo "CHECK PASS: M3"
