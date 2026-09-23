import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOL_POLICY, createToolPolicy, hasToolCapability, toolPolicyEnvironment, toolPolicySummary } from './toolPolicy';

describe('tool policy', () => {
  // M6: no engine gets a tool unless the owner turns it on.
  it('grants nothing by default', () => {
    expect(DEFAULT_TOOL_POLICY.capabilities).toEqual([]);
    expect(createToolPolicy().capabilities).toEqual([]);
    expect(toolPolicySummary(DEFAULT_TOOL_POLICY)).toEqual({ capabilities: 'none', scope: 'workspace' });
  });

  // A shell can read and change files, and an edit reads its target: the
  // implied capabilities must be explicit so every engine compiles the same thing.
  it('closes the implications: bash gives write and read, write gives read', () => {
    expect(createToolPolicy({ capabilities: ['bash'] }).capabilities).toEqual(['read', 'write', 'bash']);
    expect(createToolPolicy({ capabilities: ['write'] }).capabilities).toEqual(['read', 'write']);
    expect(createToolPolicy({ capabilities: ['web'] }).capabilities).toEqual(['web']);
    expect(hasToolCapability(createToolPolicy({ capabilities: 'web' }), 'read')).toBe(false);
  });

  it('refuses unknown or duplicate capabilities and unknown scopes', () => {
    expect(() => createToolPolicy({ capabilities: ['root'] })).toThrow(/unsupported capability/);
    expect(() => createToolPolicy({ capabilities: ['read', 'read'] })).toThrow(/duplicate/);
    expect(() => createToolPolicy({ capabilities: [], scope: 'everywhere' })).toThrow(/scope/);
  });

  it('expands "all" to the explicit list', () => {
    expect(createToolPolicy({ capabilities: 'all' }).capabilities).toEqual(['read', 'write', 'bash', 'web', 'subagents']);
    expect(toolPolicyEnvironment(createToolPolicy({ capabilities: ['read'] }))).toEqual({ BOT_AI_TOOL_CAPABILITIES: 'read', BOT_AI_TOOL_SCOPE: 'workspace' });
  });
});
