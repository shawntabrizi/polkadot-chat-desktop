#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
git log -1 --format=%s | grep -q '^M4:' || fail "last commit is not an M4 commit"
[ -f src/main/assistant/client.ts ] && [ -f scripts/e2e-assistant.mjs ] || fail "assistant files missing"
! git grep -n 'LLM_PROXY_KEY' -- src/renderer || fail "renderer references the proxy key"
npm run check >/tmp/m4-check.log 2>&1 || { tail -40 /tmp/m4-check.log; fail "npm run check failed"; }
out=$(timeout 180 npm run e2e:assistant 2>&1 | tail -8) || true
echo "$out" | grep -q ASSISTANT_OK || { echo "$out"; fail "assistant e2e failed"; }
grep -q '## M4' docs/acceptance.md || fail "no M4 acceptance section"
echo "CHECK PASS: M4"
