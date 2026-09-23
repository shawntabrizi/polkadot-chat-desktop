#!/usr/bin/env bash
# Reviewer check for M0. Exit 0 = pass.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
git log -1 --format=%s | grep -q '^M0:' || fail "last commit is not an M0 commit"
[ -f electron.vite.config.ts ] || fail "electron.vite.config.ts missing"
[ -f src/main/index.ts ] && [ -f src/preload/index.ts ] && [ -f src/renderer/main.tsx ] || fail "main/preload/renderer entry missing"
grep -q '"electron": "44.4.1"' package.json || fail "electron not pinned to 44.4.1"
! grep -E '"[~^]' package.json || fail "unpinned version range in package.json"
grep -q 'no-restricted-imports' eslint.config.js || fail "renderer import guard missing"
npm run check >/tmp/m0-check.log 2>&1 || { tail -40 /tmp/m0-check.log; fail "npm run check failed"; }
out=$(timeout 180 npm run smoke 2>&1 | tail -5) || true
echo "$out" | grep -q 'SMOKE_OK' || { echo "$out"; fail "smoke did not print SMOKE_OK"; }
grep -q '## M0' docs/acceptance.md || fail "docs/acceptance.md has no M0 section"
echo "CHECK PASS: M0"
