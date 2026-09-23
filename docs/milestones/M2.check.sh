#!/usr/bin/env bash
# Reviewer check for M2. The reviewer must have `pca run hishawn` running with the
# e2e identity allowed (or the bot public) before running this.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
git log -1 --format=%s | grep -q '^M2:' || fail "last commit is not an M2 commit"
[ -f scripts/e2e-chat.mjs ] || fail "scripts/e2e-chat.mjs missing"
npm run check >/tmp/m2-check.log 2>&1 || { tail -40 /tmp/m2-check.log; fail "npm run check failed"; }
out=$(timeout 420 npm run e2e:chat -- hishawn.84 2>&1 | tail -25) || true
echo "$out"
echo "$out" | grep -q 'E2E_OK' || fail "e2e chat did not reach E2E_OK"
grep -q '## M2' docs/acceptance.md || fail "docs/acceptance.md has no M2 section"
echo "CHECK PASS: M2"
