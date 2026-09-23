#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# macOS has no `timeout`; run the command directly when neither timeout nor gtimeout exists.
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M4:')" ] || fail "no M4 commit in history"
[ -f src/main/assistant/client.ts ] && [ -f scripts/e2e-assistant.mjs ] || fail "assistant files missing"
! git grep -n 'LLM_PROXY_KEY' -- src/renderer || fail "renderer references the proxy key"
npm run check >/tmp/m4-check.log 2>&1 || { tail -40 /tmp/m4-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run e2e:assistant 2>&1 | tail -8) || true
echo "$out" | grep -q ASSISTANT_OK || { echo "$out"; fail "assistant e2e failed"; }
grep -q '## M4' docs/acceptance.md || fail "no M4 acceptance section"
echo "CHECK PASS: M4"
