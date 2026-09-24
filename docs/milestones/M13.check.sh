#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$@"; else shift; "$@"; fi; }
fail() { echo "CHECK FAIL: $*"; exit 1; }
[ -z "$(git status --short)" ] || fail "working tree not clean"
[ -n "$(git log --format=%s --grep='^M13:')" ] || fail "no M13 commit in history"
[ -f scripts/e2e-agent.mjs ] && [ -f scripts/e2e-tools.mjs ] || fail "e2e scripts missing"
grep -rq "send_buttons" src || fail "tool definitions missing"
! grep -rq "window.confirm\|AlertDialog" src/renderer/ui || fail "confirm dialog present"
npm run check >/tmp/m13-check.log 2>&1 || { tail -40 /tmp/m13-check.log; fail "npm run check failed"; }
out=$(with_timeout 180 npm run smoke 2>&1 | tail -3) || true
echo "$out" | grep -q SMOKE_OK || { echo "$out"; fail "smoke failed"; }
out=$(with_timeout 600 npm run e2e:tools 2>&1 | tail -8) || true
echo "$out" | grep -q TOOLS_OK || { echo "$out"; fail "tools e2e failed"; }
out=$(with_timeout 900 npm run e2e:agent 2>&1 | tail -15) || true
echo "$out"
echo "$out" | grep -q AGENT_OK || fail "agent e2e failed"
for t in berlin-day berlin-night; do [ -f ".agent-runs/screens/$t/settings-agent.png" ] || fail "missing $t/settings-agent.png"; done
grep -q '## M13' docs/acceptance.md || fail "no M13 acceptance section"
echo "CHECK PASS: M13"
