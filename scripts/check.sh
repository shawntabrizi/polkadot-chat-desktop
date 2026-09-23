#!/usr/bin/env bash
# Reviewer entry point: scripts/check.sh M0
set -euo pipefail
cd "$(dirname "$0")/.."
M="${1:?milestone id}"
echo "== git"; git log --oneline -3; git status --short
echo "== diff stat vs previous commit"; git diff --stat HEAD~1 2>/dev/null | tail -25 || true
echo "== milestone check"; bash "docs/milestones/$M.check.sh"
