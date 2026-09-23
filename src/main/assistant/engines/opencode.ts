// Copied from .refs/bot-core/lib/runners.mjs (`opencode` runner,
// opencodePermissions, opencodePathRules, openCodeRulePath) on 2026-09-23;
// changes: TypeScript; the workspace is the only path (no attachment or
// output directories, so external_directory is always "deny" in workspace
// scope); no --model flag (the CLI's own default); the tool_use action
// carries the tool name; parseEvent also reads OpenCode 1.x's nested
// `part` fields; the engine passes the provider key variables
// OpenCode configs usually read (see passEnv).

import { type ToolPolicy, hasToolCapability, toolPolicyError } from '../toolPolicy';

import { type CliSpec, type CliTurn, type RunnerEvent, absolutePath, assertEngineToolPolicy, createCliEngine, toolActionTitle } from './runner';
import type { Engine } from './types';

const openCodeRulePath = (directory: string): string => {
  const resolved = absolutePath(directory, 'tool policy path');
  // Permission keys are globs: a folder name must never become a wildcard.
  if (/[*?[\]{}\\]/.test(resolved)) throw toolPolicyError('tool policy path contains characters unsafe for OpenCode permission rules.');
  return resolved;
};

type Rule = 'allow' | 'deny' | Record<string, 'allow' | 'deny'>;

/**
 * Later matches win in OpenCode, so the catch-all deny goes first and only
 * the chosen capabilities are opened after it.
 */
export const opencodePermissions = (policy: ToolPolicy, workspace: string): Record<string, Rule> => {
  const scoped: Record<string, 'allow' | 'deny'> = { '*': 'deny', [`${openCodeRulePath(workspace)}/**`]: 'allow' };
  const permissions: Record<string, Rule> = { '*': 'deny' };
  if (hasToolCapability(policy, 'read')) {
    permissions.read = policy.scope === 'container' ? 'allow' : scoped;
    permissions.glob = 'allow';
    permissions.grep = 'allow';
    permissions.list = 'allow';
  }
  if (hasToolCapability(policy, 'write')) permissions.edit = policy.scope === 'container' ? 'allow' : scoped;
  if (hasToolCapability(policy, 'bash')) permissions.bash = 'allow';
  if (hasToolCapability(policy, 'web')) {
    permissions.webfetch = 'allow';
    permissions.websearch = 'allow';
  }
  if (hasToolCapability(policy, 'subagents')) permissions.task = 'allow';
  permissions.external_directory = policy.scope === 'container' ? 'allow' : 'deny';
  return permissions;
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CLI JSON

export const opencodeSpec: CliSpec = {
  id: 'opencode',
  label: 'OpenCode',
  command: 'opencode',
  streamsPartials: false,
  systemPromptFlag: false,
  // OpenCode reads provider keys from the environment ({env:NAME} in its
  // config). LLM_PROXY_KEY is the app's own proxy key.
  passEnv: ['LLM_PROXY_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  buildArgs({ prompt, resume, policy: policyInput, workspace }: CliTurn): string[] {
    assertEngineToolPolicy('opencode', policyInput);
    const args = ['--pure', 'run', '--format', 'json', '--dir', absolutePath(workspace, 'workspace')];
    if (resume) args.push('--session', resume);
    // A period keeps a purely numeric prompt from being read as an option value.
    args.push('--', /^\d+$/.test(prompt) ? `${prompt}.` : prompt);
    return args;
  },
  buildEnvironment({ policy: policyInput, workspace }: CliTurn): Record<string, string> {
    const policy = assertEngineToolPolicy('opencode', policyInput);
    const permission = opencodePermissions(policy, workspace);
    return {
      OPENCODE_PERMISSION: JSON.stringify(permission),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission, plugin: [] }),
      OPENCODE_PURE: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    };
  },
  parseEvent(value: unknown): RunnerEvent[] {
    const obj = value as Json | null;
    // OpenCode 1.x nests an event's fields in `part`; bot-core's fixtures
    // have them at the top. Read both.
    const part: Json = obj?.part ?? {};
    const out: RunnerEvent[] = [];
    if (obj?.sessionID) out.push({ kind: 'started', sessionId: String(obj.sessionID) });
    if (obj?.type === 'tool_use') {
      const name = String(obj.tool ?? obj.name ?? part.tool ?? 'tool');
      out.push({ kind: 'action', name, title: toolActionTitle(name, obj.input ?? obj.args ?? part.state?.input ?? {}) });
    } else if (obj?.type === 'text' && (obj.text || part.text)) out.push({ kind: 'text', text: String(obj.text || part.text) });
    else if (obj?.type === 'step_finish' && (obj.reason ?? part.reason) === 'stop') out.push({ kind: 'result', text: '', ok: true });
    else if (obj?.type === 'error') out.push({ kind: 'error', message: String(obj.error?.data?.message ?? obj.error?.message ?? 'opencode error') });
    return out;
  },
};

export const opencodeEngine: Engine = createCliEngine(opencodeSpec);
