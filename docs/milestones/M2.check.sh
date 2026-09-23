#!/usr/bin/env bash
# Reviewer check for M2. The reviewer must have `pca run pcdpeer` running (public echo bot,
# no allowlist) before running this.
set -euo pipefail
cd "$(dirname "$0")/../.."
# macOS has no `timeout`; run the command directly when neither timeout nor gtimeout exists.
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M2:')" ] || fail "no M2 commit in history"
[ -f scripts/e2e-chat.mjs ] || fail "scripts/e2e-chat.mjs missing"
npm run check >/tmp/m2-check.log 2>&1 || { tail -40 /tmp/m2-check.log; fail "npm run check failed"; }
out=$(with_timeout 420 npm run e2e:chat -- pcdpeer.47 2>&1 | tail -25) || true
echo "$out"
echo "$out" | grep -q 'E2E_OK' || fail "e2e chat did not reach E2E_OK"
grep -q '## M2' docs/acceptance.md || fail "docs/acceptance.md has no M2 section"
echo "CHECK PASS: M2"
