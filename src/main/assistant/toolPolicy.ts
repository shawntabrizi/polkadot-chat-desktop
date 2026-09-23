// Copied from .refs/bot-core/lib/tool-policy.mjs on 2026-09-23; changes:
// TypeScript; no `toolPolicyFromEnvironment` / `parseToolCapabilities` (the
// app reads the policy from assistant.json, not from a bot's environment);
// `ToolPolicyError` is a plain Error with a name; header shortened.
//
// Portable tool policy: the owner picks outcomes (`read`, `write`, `bash`,
// `web`, `subagents`) and a filesystem scope; each engine compiles that to
// its own flags (engines/*.ts). `web` and `subagents` are orthogonal to the
// file ladder. `bash` implies arbitrary egress through whatever runtime the
// shell can reach, so granting it is accepting that.

export const TOOL_CAPABILITIES = Object.freeze(['read', 'write', 'bash', 'web', 'subagents'] as const);
export const TOOL_SCOPES = Object.freeze(['workspace', 'container'] as const);

export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];
export type ToolScope = (typeof TOOL_SCOPES)[number];
export type ToolPolicy = Readonly<{ capabilities: readonly ToolCapability[]; scope: ToolScope }>;

export const DEFAULT_TOOL_POLICY: ToolPolicy = Object.freeze({ capabilities: Object.freeze([]), scope: 'workspace' });

const capabilityRank = new Map<string, number>(TOOL_CAPABILITIES.map((capability, index) => [capability, index]));

export const toolPolicyError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'ToolPolicyError';
  return error;
};

const isCapability = (value: string): value is ToolCapability => (TOOL_CAPABILITIES as readonly string[]).includes(value);

const canonicalCapabilities = (values: readonly string[] | string, label: string): readonly ToolCapability[] => {
  let listed: string[] = Array.isArray(values) ? [...values] : String(values ?? '').split(',');
  // `all` expands here, at parse time, so what runs is always the explicit
  // list: a capability added later never attaches itself to old settings.
  if (listed.some(raw => String(raw).trim() === 'all')) {
    if (listed.length !== 1) throw toolPolicyError(`${label}: "all" stands alone — it already means ${TOOL_CAPABILITIES.join(',')}.`);
    listed = [...TOOL_CAPABILITIES];
  }
  const selected = new Set<ToolCapability>();
  for (const raw of listed) {
    const capability = String(raw).trim();
    if (!capability) {
      if (listed.length === 1) continue;
      throw toolPolicyError(`${label} cannot contain an empty capability.`);
    }
    if (!isCapability(capability)) {
      throw toolPolicyError(`${label} contains unsupported capability "${capability}". Choose: ${TOOL_CAPABILITIES.join(', ')}, or all.`);
    }
    if (selected.has(capability)) throw toolPolicyError(`${label} contains duplicate capability "${capability}".`);
    selected.add(capability);
  }
  // Outcome capabilities: a shell can inspect and change files in its scope,
  // and an edit needs to read its target. Close the implications once here.
  if (selected.has('bash')) {
    selected.add('write');
    selected.add('read');
  } else if (selected.has('write')) {
    selected.add('read');
  }
  return Object.freeze([...selected].sort((a, b) => (capabilityRank.get(a) ?? 0) - (capabilityRank.get(b) ?? 0)));
};

export const createToolPolicy = ({
  capabilities = [],
  scope = 'workspace',
}: { capabilities?: readonly string[] | string; scope?: string | null } = {}): ToolPolicy => {
  const canonical = canonicalCapabilities(capabilities, 'tool capabilities');
  const selectedScope = scope == null || scope === '' ? 'workspace' : String(scope).trim();
  if (!(TOOL_SCOPES as readonly string[]).includes(selectedScope)) throw toolPolicyError(`tool scope must be one of: ${TOOL_SCOPES.join(', ')}.`);
  return Object.freeze({ capabilities: canonical, scope: selectedScope as ToolScope });
};

export const toolPolicyEnvironment = (policy: ToolPolicy): Record<string, string> => {
  const normalized = createToolPolicy(policy);
  return {
    BOT_AI_TOOL_CAPABILITIES: normalized.capabilities.join(','),
    BOT_AI_TOOL_SCOPE: normalized.scope,
  };
};

export const hasToolCapability = (policy: ToolPolicy, capability: ToolCapability): boolean =>
  createToolPolicy(policy).capabilities.includes(capability);

export const toolPolicySummary = (policy: ToolPolicy): { capabilities: string; scope: ToolScope } => {
  const normalized = createToolPolicy(policy);
  return {
    capabilities: normalized.capabilities.length ? normalized.capabilities.join(', ') : 'none',
    scope: normalized.scope,
  };
};
