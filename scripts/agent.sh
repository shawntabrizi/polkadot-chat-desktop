#!/usr/bin/env bash
# Run the implementation agent on ONE milestone through the Parity LLM proxy.
# The agent is confined to this repository: it may edit files here and run
# npm, npx, node, git, and read-only shell commands. Nothing else.
#   scripts/agent.sh M0            # implement docs/milestones/M0.md
#   scripts/agent.sh M0 review     # apply docs/review/M0.md fixes only
# Requires LLM_PROXY_KEY in the environment. Logs to .agent-runs/<M>-<mode>-<ts>.log
set -euo pipefail
cd "$(dirname "$0")/.."
M="${1:?milestone id, e.g. M0}"; MODE="${2:-implement}"
[ -n "${LLM_PROXY_KEY:-}" ] || { echo "LLM_PROXY_KEY not set"; exit 1; }
MODEL="${AGENT_MODEL:-parity/deepseek-v4.1-flash}"   # pod-only, free; no cloud fallback
# Fail fast when the Parity pod is down: the owner then runs the milestone with
# Opus 5.5 subagents from the orchestrating session instead of paying OpenRouter.
probe=$(curl -s --max-time 60 https://llm.substrate.dev/v1/messages -H "Authorization: Bearer $LLM_PROXY_KEY" -H "content-type: application/json" -H "anthropic-version: 2023-06-01" -d "{\"model\":\"$MODEL\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" || true)
echo "$probe" | grep -q '"content"' || { echo "POD_DOWN: $MODEL did not answer; use Opus subagents. Response head: $(echo "$probe" | head -c 200)"; exit 3; }
TS=$(date +%Y%m%d-%H%M%S); LOG=".agent-runs/$M-$MODE-$TS.log"; mkdir -p .agent-runs
if [ "$MODE" = review ]; then
  PROMPT="Read AGENTS.md, then PLAN.md, then docs/milestones/$M.md, then docs/review/$M.md. The reviewer found problems. Fix only the numbered items in docs/review/$M.md. Run npm run check and the milestone acceptance commands again, update docs/acceptance.md, then commit with the message '$M: review fixes' and stop."
else
  PROMPT="Read AGENTS.md, then PLAN.md, then docs/milestones/$M.md. Implement milestone $M exactly as written, step by step. Run npm run check and every acceptance command yourself, record real output in docs/acceptance.md, record choices in docs/decisions.md, commit with the message given in the milestone, and stop. Do not start any other milestone."
fi
export ANTHROPIC_BASE_URL="https://llm.substrate.dev"
export ANTHROPIC_AUTH_TOKEN="$LLM_PROXY_KEY"
export ANTHROPIC_MODEL="$MODEL" ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL" ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL" ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL" ANTHROPIC_DEFAULT_FABLE_MODEL="$MODEL"
export CLAUDE_CONFIG_DIR="$HOME/.llm-proxy/claude"
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=131072
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_ATTRIBUTION_HEADER=0 DISABLE_FEEDBACK_COMMAND=1 DISABLE_EXTRA_USAGE_COMMAND=1 DISABLE_ERROR_REPORTING=1
unset ANTHROPIC_API_KEY
echo "agent $M $MODE model=$MODEL log=$LOG"
claude -p "$PROMPT" \
  --model "$MODEL" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Glob,Grep,LS,Bash(npm:*),Bash(npx:*),Bash(node:*),Bash(git:*),Bash(ls:*),Bash(cat:*),Bash(mkdir:*),Bash(cp:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(pwd),Bash(cmp:*),Bash(diff:*),Bash(timeout:*)" \
  --max-turns 300 \
  --output-format stream-json --verbose \
  > "$LOG" 2>&1
echo "exit=$? log=$LOG"
