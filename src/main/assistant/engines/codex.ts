// Copied from .refs/bot-core/lib/runners.mjs (`codex` runner,
// codexPermissionProfile) on 2026-09-23; changes: TypeScript; the workspace
// is the only path in the permission profile (no attachment or output
// directories); no -m/effort flags (the CLI's own default); the profile is
// named `pcd`; the tool_use action carries a tool name.

import { type ToolPolicy, hasToolCapability } from '../toolPolicy';

import { type CliSpec, type CliTurn, type RunnerEvent, absolutePath, assertEngineToolPolicy, createCliEngine, toolActionTitle, totalInputTokens } from './runner';
import type { Engine } from './types';

const tomlBasicString = (value: string) => JSON.stringify(String(value));

/**
 * `-c` takes a TOML assignment. Deliberately explicit: the built-in
 * `workspace-write` profile includes `:root` and would expose the CLI's
 * login home. This one starts from `:minimal` and opens only the workspace.
 */
export const codexPermissionProfile = (policy: ToolPolicy, workspace: string): string => {
  const filesystem = ['":minimal"="read"'];
  if (hasToolCapability(policy, 'read')) {
    const access = hasToolCapability(policy, 'write') ? 'write' : 'read';
    if (policy.scope === 'container') filesystem.push(`":root"=${tomlBasicString(access)}`);
    else filesystem.push(`":workspace_roots"={"."=${tomlBasicString(access)}}`);
  }
  return `permissions={pcd={workspace_roots={${tomlBasicString(workspace)}=true},filesystem={${filesystem.join(',')}}}}`;
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CLI JSON

export const codexSpec: CliSpec = {
  id: 'codex',
  label: 'Codex',
  command: 'codex',
  streamsPartials: false,
  systemPromptFlag: false,
  passEnv: ['OPENAI_API_KEY'],
  buildArgs({ prompt, resume, policy: policyInput, workspace: workingDirectory }: CliTurn): string[] {
    const policy = assertEngineToolPolicy('codex', policyInput);
    const workspace = absolutePath(workingDirectory, 'workspace');
    const args = ['--ask-for-approval', 'never', 'exec', '--json', '--skip-git-repo-check', '--color=never', '--ignore-user-config', '-C', workspace];
    args.push('-c', 'default_permissions="pcd"');
    args.push('-c', codexPermissionProfile(policy, workspace));
    args.push('-c', `features.shell_tool=${hasToolCapability(policy, 'bash') ? 'true' : 'false'}`);
    args.push('-c', 'features.apps=false', '-c', 'features.plugins=false');
    args.push('-c', `features.multi_agent=${hasToolCapability(policy, 'subagents') ? 'true' : 'false'}`);
    // `web_search` accepts disabled|cached|indexed|live; the capability means live.
    if (hasToolCapability(policy, 'web')) args.push('-c', 'tools.web_search=true', '-c', 'web_search="live"');
    else args.push('-c', 'tools.web_search=false', '-c', 'web_search="disabled"');
    // `exec resume <id> <prompt>` continues a thread; the prompt goes last either way.
    if (resume) args.push('resume', resume, '--', prompt);
    else args.push('--', prompt);
    return args;
  },
  parseEvent(value: unknown): RunnerEvent[] {
    const obj = value as Json | null;
    if (obj?.type === 'thread.started' && obj.thread_id) return [{ kind: 'started', sessionId: String(obj.thread_id) }];
    if (obj?.type === 'error') return [{ kind: 'error', message: String(obj.message ?? 'codex error') }];
    if (obj?.type === 'turn.failed') return [{ kind: 'error', message: String(obj.error?.message ?? 'codex turn failed') }];
    if (obj?.type === 'item.completed' || obj?.type === 'item.started') {
      const item: Json = obj.item ?? {};
      const it = String(item.type ?? item.item_type ?? '');
      if (it === 'agent_message' || it === 'assistant_message') {
        // Only the completed message is the answer; started is a boundary.
        return obj.type === 'item.completed' && item.text ? [{ kind: 'text', text: String(item.text) }] : [];
      }
      if (obj.type === 'item.started') {
        if (it === 'command_execution') return [{ kind: 'action', name: 'shell', title: toolActionTitle('bash', { command: item.command }) }];
        if (it === 'file_change' || it === 'patch_apply') return [{ kind: 'action', name: 'edit', title: `editing ${String(item.path ?? item.files?.[0] ?? 'files')}` }];
        if (it === 'web_search') return [{ kind: 'action', name: 'web_search', title: `searching: ${String(item.query ?? '')}`.trim() }];
        if (it === 'mcp_tool_call' || it === 'tool_call') {
          const name = String(item.tool ?? item.name ?? 'tool');
          return [{ kind: 'action', name, title: toolActionTitle(name, item.arguments ?? {}) }];
        }
        if (it === 'collab_tool_call') return [{ kind: 'action', name: 'agent', title: toolActionTitle('agent', { description: item.description ?? item.name ?? item.tool ?? '' }) }];
      }
      return [];
    }
    if (obj?.type === 'turn.completed') {
      const input = totalInputTokens(obj.usage);
      const usage = {
        ...(input != null ? { inputTokens: input } : {}),
        ...(obj.usage?.output_tokens != null ? { outputTokens: Number(obj.usage.output_tokens) } : {}),
      };
      return [{ kind: 'result', text: '', ok: true, ...(Object.keys(usage).length ? { usage } : {}) }];
    }
    return [];
  },
};

export const codexEngine: Engine = createCliEngine(codexSpec);
