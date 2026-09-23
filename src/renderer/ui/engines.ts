/** Names of the Assistant engines and tools as the UI shows them. */

import type { AssistantEngineId, AssistantTool } from '../../shared/desktop-api';

export const ENGINE_LABELS: Record<AssistantEngineId, string> = {
  proxy: 'Proxy',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export const engineLabel = (engine: AssistantEngineId): string => ENGINE_LABELS[engine];

/** The four tools Settings offers, in the policy's order. `bash` is "Shell" to a person. */
export const TOOL_CHOICES: { id: AssistantTool; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'bash', label: 'Shell' },
  { id: 'web', label: 'Web' },
];

/** "tools: off" or "tools: read, write, shell". */
export const toolsLine = (tools: readonly AssistantTool[]): string => {
  const names = TOOL_CHOICES.filter(choice => tools.includes(choice.id)).map(choice => choice.label.toLowerCase());
  return names.length ? `tools: ${names.join(', ')}` : 'tools: off';
};
