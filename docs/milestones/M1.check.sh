#!/usr/bin/env bash
# Reviewer check for M1. Exit 0 = pass. Needs network access to devnet.
set -euo pipefail
cd "$(dirname "$0")/../.."
# macOS has no `timeout`; run the command directly when neither timeout nor gtimeout exists.
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
git log --format=%s | grep -q '^M1:' || fail "no M1 commit in history"
for f in src/main/identity/keys.ts src/main/identity/register.ts src/main/identity/store.ts src/main/identity/service.ts src/main/ipc.ts src/renderer/domain/identity/selfIdentity.ts src/renderer/ui/SignUp.tsx scripts/identity-register.mjs resources/summit-bandersnatch-cli.wasm; do [ -f "$f" ] || fail "missing $f"; done
cmp -s resources/summit-bandersnatch-cli.wasm .refs/bot-core/vendor/summit-bandersnatch-cli.wasm || fail "wasm differs from bot-core's"
! git grep -n -E 'console\.log\([^)]*(mnemonic|seed|privateKey)' -- src scripts || fail "a log statement mentions secret material"
npm run check >/tmp/m1-check.log 2>&1 || { tail -40 /tmp/m1-check.log; fail "npm run check failed"; }
name="pcdrev$RANDOM"
out=$(with_timeout 400 npm run identity:register -- "$name" 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q 'ON_CHAIN key_type=0' || fail "registration did not land on chain with an X25519 key"
grep -q '## M1' docs/acceptance.md || fail "docs/acceptance.md has no M1 section"
echo "CHECK PASS: M1"
