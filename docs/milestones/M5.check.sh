#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M5:')" ] || fail "no M5 commit in history"
[ -f src/renderer/theme/index.css ] && [ -f src/renderer/lib/cn.ts ] && [ -d src/renderer/components/ui ] || fail "design system not installed"
cmp -s src/renderer/theme/primitives.css .refs/polkadot-design-system/assets/theme/primitives.css || fail "primitives.css differs from the bundle"
[ ! -f src/renderer/components/ui/alert-dialog.tsx ] || fail "alert-dialog installed"
! grep -rq "style={{" src/renderer/ui || fail "inline styles remain in src/renderer/ui"
! grep -rqE "dark:(bg|text|border)-" src/renderer/ui || fail "dark: colour classes in ui"
! grep -rq "@novasamatech/tr-ui" package.json || fail "tr-ui added"
[ -f scripts/check-tokens.mjs ] && grep -q '"check:tokens"' package.json || fail "token lint missing"
npm run check >/tmp/m5-check.log 2>&1 || { tail -40 /tmp/m5-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
for t in berlin-day berlin-night; do for f in signup chats room settings; do [ -f ".agent-runs/screens/$t/$f.png" ] || fail "missing screenshot $t/$f.png"; done; done
grep -q '## M5' docs/acceptance.md || fail "no M5 acceptance section"
echo "CHECK PASS: M5"
