// Copied from .refs/bot-core/lib/runners.mjs (`claude` runner, claudeTools,
// claudeApprovalRules, claudeDeniedRules, claudeRulePath) on 2026-09-23;
// changes: TypeScript; the workspace is the only scoped path (no attachment,
// output or protected directories); no --model/--effort (the CLI's own
// default); the tool_use action carries the tool name.

import { type ToolPolicy, hasToolCapability, toolPolicyError } from '../toolPolicy';

import { type CliSpec, type CliTurn, type RunnerEvent, absolutePath, assertEngineToolPolicy, createCliEngine, toolActionTitle, totalInputTokens } from './runner';
import type { Engine } from './types';

const claudeRulePath = (directory: string): string => {
  const resolved = absolutePath(directory, 'tool policy path');
  // Claude's rules are a comma-separated mini-language: a folder name must
  // not be able to widen a rule.
  if (/[(),*?[\]{}\\]/.test(resolved)) throw toolPolicyError('tool policy path contains characters unsafe for Claude permission rules.');
  return resolved;
};
const claudePath = (directory: string) => `//${claudeRulePath(directory).replace(/^\/+/, '')}/**`;
const claudeRule = (tool: string, directory: string) => `${tool}(${claudePath(directory)})`;

// Web tools take no path, so they are never scoped.
const CLAUDE_WEB_TOOLS = ['WebSearch', 'WebFetch'];

export const claudeTools = (policy: ToolPolicy): string[] => {
  const tools: string[] = [];
  if (hasToolCapability(policy, 'read')) tools.push('Read', 'Glob', 'Grep');
  if (hasToolCapability(policy, 'write')) tools.push('Edit', 'Write');
  if (hasToolCapability(policy, 'bash')) tools.push('Bash');
  if (hasToolCapability(policy, 'web')) tools.push(...CLAUDE_WEB_TOOLS);
  if (hasToolCapability(policy, 'subagents')) tools.push('Agent');
  return tools;
};

const claudeApprovalRules = (policy: ToolPolicy, workspace: string): string[] => {
  if (policy.scope === 'container') return claudeTools(policy);
  const rules: string[] = [];
  if (hasToolCapability(policy, 'read')) rules.push(...['Read', 'Glob', 'Grep'].map(tool => claudeRule(tool, workspace)));
  if (hasToolCapability(policy, 'write')) rules.push(claudeRule('Edit', workspace), claudeRule('Write', workspace));
  if (hasToolCapability(policy, 'bash')) rules.push('Bash(*)');
  // `dontAsk` fails any tool that is available but not approved.
  if (hasToolCapability(policy, 'web')) rules.push(...CLAUDE_WEB_TOOLS);
  if (hasToolCapability(policy, 'subagents')) rules.push('Agent');
  return rules;
};

export const claudeSpec: CliSpec = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  streamsPartials: true,
  systemPromptFlag: true,
  passEnv: ['ANTHROPIC_API_KEY'],
  buildArgs({ prompt, resume, systemPrompt, policy: policyInput, workspace }: CliTurn): string[] {
    const policy = assertEngineToolPolicy('claude', policyInput);
    // Final-answer deltas come as `stream_event` frames only with
    // --include-partial-messages.
    const args = [
      '-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      // The app owns the policy: project/user settings, MCP, browser control
      // and slash commands must not widen it.
      '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-chrome',
    ];
    if (resume) args.push('--resume', resume);
    // `--tools` is the availability boundary; `dontAsk` fails anything outside
    // the allowlist instead of waiting on a prompt nobody sees.
    const tools = claudeTools(policy);
    args.push('--permission-mode', 'dontAsk', '--tools', tools.join(','));
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    if (tools.length) {
      const approvals = claudeApprovalRules(policy, absolutePath(workspace, 'workspace'));
      if (approvals.length) args.push('--allowedTools', approvals.join(','));
    }
    // The prompt is always last, after `--` (a leading dash stays text).
    args.push('--', prompt);
    return args;
  },
  parseEvent(value: unknown): RunnerEvent[] {
    const obj = value as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any -- CLI JSON
    if (obj?.type === 'system' && obj.subtype === 'init' && obj.session_id) return [{ kind: 'started', sessionId: String(obj.session_id) }];
    if (obj?.type === 'assistant' && Array.isArray(obj.message?.content)) {
      const out: RunnerEvent[] = [];
      for (const block of obj.message.content) {
        if (block?.type === 'tool_use') out.push({ kind: 'action', name: String(block.name ?? 'tool'), title: toolActionTitle(block.name, block.input) });
        else if (block?.type === 'text' && block.text) out.push({ kind: 'text', text: String(block.text) });
      }
      return out;
    }
    if (obj?.type === 'stream_event' && obj.event?.type === 'content_block_delta') {
      const delta = obj.event.delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) return [{ kind: 'partial', text: delta.text }];
    }
    if (obj?.type === 'result') {
      if (obj.is_error) return [{ kind: 'error', message: String(obj.result ?? obj.subtype ?? 'claude error') }];
      const input = totalInputTokens(obj.usage);
      const usage = {
        ...(input != null ? { inputTokens: input } : {}),
        ...(obj.usage?.output_tokens != null ? { outputTokens: Number(obj.usage.output_tokens) } : {}),
        ...(obj.total_cost_usd != null ? { costUsd: Number(obj.total_cost_usd) } : {}),
      };
      return [{ kind: 'result', text: typeof obj.result === 'string' ? obj.result : '', ok: true, ...(Object.keys(usage).length ? { usage } : {}) }];
    }
    return [];
  },
};

export const claudeEngine: Engine = createCliEngine(claudeSpec);
