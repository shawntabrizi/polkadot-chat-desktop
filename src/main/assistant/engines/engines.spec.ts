import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOL_POLICY, type ToolPolicy, createToolPolicy } from '../toolPolicy';

import { claudeSpec } from './claude';
import { codexSpec } from './codex';
import { opencodeSpec } from './opencode';
import { type CliSpec, type CliTurn, type RunnerEvent, buildAgentEnvironment, composePrompt, runCli, stripToolMarkup, toolPolicyEnforcement, toolsInstruction } from './runner';
import type { EngineEvent, EngineRunInput } from './types';

const WS = '/Users/someone/Library/Application Support/polkadot-chat-desktop/assistant-workspace';
const turn = (overrides: Partial<CliTurn> = {}): CliTurn => ({ prompt: 'hi', resume: null, systemPrompt: 'Be brief.', policy: DEFAULT_TOOL_POLICY, workspace: WS, ...overrides });
const policy = (capabilities: string[]): ToolPolicy => createToolPolicy({ capabilities });
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** Accumulates a fixture stream the way runCli does. */
const drive = (spec: CliSpec, objs: unknown[]) => {
  let sessionId: string | null = null;
  let text = '';
  let result: Extract<RunnerEvent, { kind: 'result' }> | null = null;
  let error: string | null = null;
  const actions: string[] = [];
  for (const obj of objs) {
    for (const ev of spec.parseEvent(obj)) {
      if (ev.kind === 'started') sessionId ??= ev.sessionId;
      else if (ev.kind === 'action') actions.push(ev.title);
      else if (ev.kind === 'text') text += ev.text;
      else if (ev.kind === 'result') result = ev;
      else if (ev.kind === 'error') error = ev.message;
    }
  }
  return { sessionId, actions, answer: error ? null : result?.text || text, error, usage: result?.usage };
};

describe('claude', () => {
  // Tools off must mean an empty --tools list: the availability boundary.
  it('runs with no tools, no user settings and no MCP by default', () => {
    const args = claudeSpec.buildArgs(turn());
    expect(args.slice(0, 5)).toEqual(['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose']);
    expect(argAfter(args, '--tools')).toBe('');
    expect(argAfter(args, '--permission-mode')).toBe('dontAsk');
    expect(argAfter(args, '--setting-sources')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--allowedTools');
    expect(argAfter(args, '--append-system-prompt')).toBe('Be brief.');
    expect(args.slice(-2)).toEqual(['--', 'hi']);
  });

  it('scopes file tools to the workspace and resumes a session', () => {
    const args = claudeSpec.buildArgs(turn({ policy: policy(['write']), resume: 'SID-1' }));
    expect(argAfter(args, '--tools')).toBe('Read,Glob,Grep,Edit,Write');
    const allowed = argAfter(args, '--allowedTools');
    expect(allowed).toContain(`Read(/${WS}/**)`);
    expect(allowed).toContain(`Edit(/${WS}/**)`);
    expect(allowed).not.toContain('Bash');
    expect(argAfter(args, '--resume')).toBe('SID-1');
    expect(() => claudeSpec.buildArgs(turn({ policy: policy(['read']), workspace: '/tmp/evil,Bash(*)' }))).toThrow(/unsafe/);
  });

  it('parses the stream: session, partial deltas, tools, result with usage', () => {
    const events = [
      { type: 'system', subtype: 'init', session_id: 'S-1' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'eng' } } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b/notes.md' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'engine ok' }] } },
      { type: 'result', result: 'engine ok', usage: { input_tokens: 2, cache_read_input_tokens: 500, output_tokens: 4 }, total_cost_usd: 0.01 },
    ];
    expect(claudeSpec.parseEvent(events[1])).toEqual([{ kind: 'partial', text: 'eng' }]);
    expect(drive(claudeSpec, events)).toEqual({
      sessionId: 'S-1',
      actions: ['reading notes.md'],
      answer: 'engine ok',
      error: null,
      usage: { inputTokens: 502, outputTokens: 4, costUsd: 0.01 },
    });
    expect(drive(claudeSpec, [{ type: 'result', is_error: true, result: 'Credit balance is too low' }]).error).toMatch(/Credit/);
  });
});

describe('codex', () => {
  // The built-in workspace-write profile would expose the CLI's login home.
  it('opens only the workspace through its own permission profile, shell and web off', () => {
    const args = codexSpec.buildArgs(turn());
    expect(args.slice(0, 7)).toEqual(['--ask-for-approval', 'never', 'exec', '--json', '--skip-git-repo-check', '--color=never', '--ignore-user-config']);
    expect(argAfter(args, '-C')).toBe(WS);
    const profile = args.find(value => value.startsWith('permissions=')) ?? '';
    expect(profile).toContain('":minimal"="read"');
    expect(profile).not.toContain('":workspace_roots"={"."');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('web_search="disabled"');
    expect(args.slice(-2)).toEqual(['--', 'hi']);
    const resumed = codexSpec.buildArgs(turn({ resume: 'TH-9', policy: policy(['read']) }));
    expect(resumed.slice(resumed.indexOf('resume'))).toEqual(['resume', 'TH-9', '--', 'hi']);
    expect(resumed.find(value => value.startsWith('permissions='))).toContain('":workspace_roots"={"."="read"}');
  });

  it('parses thread, command, answer and failure', () => {
    expect(
      drive(codexSpec, [
        { type: 'thread.started', thread_id: 'TH-3' },
        { type: 'item.started', item: { type: 'command_execution', command: 'npm test' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'all green' } },
        { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
      ]),
    ).toMatchObject({ sessionId: 'TH-3', actions: ['$ npm test'], answer: 'all green', usage: { inputTokens: 10, outputTokens: 2 } });
    expect(drive(codexSpec, [{ type: 'turn.failed', error: { message: 'usage limit' } }]).error).toBe('usage limit');
  });
});

describe('opencode', () => {
  it('denies every tool first and passes the policy through its environment', () => {
    const args = opencodeSpec.buildArgs(turn());
    expect(args.slice(0, 6)).toEqual(['--pure', 'run', '--format', 'json', '--dir', WS]);
    expect(opencodeSpec.buildArgs(turn({ prompt: '42' })).at(-1)).toBe('42.');
    const off = JSON.parse(opencodeSpec.buildEnvironment?.(turn()).OPENCODE_PERMISSION ?? '{}');
    expect(off).toEqual({ '*': 'deny', external_directory: 'deny' });
    const read = JSON.parse(opencodeSpec.buildEnvironment?.(turn({ policy: policy(['read']) })).OPENCODE_PERMISSION ?? '{}');
    expect(Object.keys(read)[0]).toBe('*');
    expect(read.read).toEqual({ '*': 'deny', [`${WS}/**`]: 'allow' });
    expect(read.bash).toBeUndefined();
  });

  it('parses flat and nested (1.x) events', () => {
    expect(
      drive(opencodeSpec, [
        { type: 'step_start', sessionID: 'ses_1' },
        { type: 'tool_use', tool: 'read', input: { file_path: 'x.ts' }, sessionID: 'ses_1' },
        { type: 'text', text: 'hi there', sessionID: 'ses_1' },
        { type: 'step_finish', reason: 'stop', sessionID: 'ses_1' },
      ]),
    ).toMatchObject({ sessionId: 'ses_1', actions: ['reading x.ts'], answer: 'hi there' });
    expect(drive(opencodeSpec, [{ type: 'text', sessionID: 's', part: { type: 'text', text: 'nested' } }, { type: 'step_finish', part: { reason: 'stop' } }]).answer).toBe('nested');
    expect(drive(opencodeSpec, [{ type: 'error', error: { data: { message: 'model not found' } } }]).error).toBe('model not found');
  });
});

describe('the enforcement each engine reports', () => {
  it('says all native tools are disabled when tools are off', () => {
    for (const id of ['claude', 'codex', 'opencode']) expect(toolPolicyEnforcement(id, DEFAULT_TOOL_POLICY).kind).toBe('none');
    expect(toolPolicyEnforcement('codex', policy(['read'])).kind).toBe('native-sandbox');
    expect(toolPolicyEnforcement('claude', policy(['web'])).detail).toMatch(/web tools reach any URL/);
  });
});

describe('agent environment', () => {
  // A parent Claude Code session makes a child `claude` refuse to start, and
  // the app's own keys must not reach a CLI that did not ask for them.
  it('drops agent session markers and credentials, keeps what a CLI needs', () => {
    const env = buildAgentEnvironment({
      parentEnv: {
        PATH: '/usr/bin',
        HOME: '/Users/x',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CODEX_HOME: '/x',
        OPENCODE_CONFIG: '/x',
        GITHUB_TOKEN: 'secret',
        OPENAI_API_KEY: 'secret',
        LLM_PROXY_KEY: 'secret',
      },
      passEnv: ['LLM_PROXY_KEY'],
      agentEnv: { OPENCODE_PURE: '1' },
      binaryDir: '/Users/x/.nvm/bin',
    });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LLM_PROXY_KEY', 'OPENCODE_PURE', 'PATH']);
    expect((env.PATH ?? '').split(':')[0]).toBe('/Users/x/.nvm/bin');
    expect(env.PATH).toContain('/opt/homebrew/bin');
  });
});

describe('prompt', () => {
  it('sends only the new message on resume, the history and instructions on a fresh session', () => {
    const input = { prompt: 'and now?', history: [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'hello' }], systemPrompt: 'Be brief.' };
    expect(composePrompt({ ...input, sessionId: 'S' }, true)).toBe('and now?');
    expect(composePrompt(input, true)).toBe('Be brief.\n\nConversation so far:\nUser: hi\n\nAssistant: hello\n\nUser message:\nand now?');
    expect(composePrompt({ ...input, history: [] }, false)).toBe('and now?');
  });

  // Live, a tools-off Claude invented a file's content in fake tool markup
  // until it was told it has no tools.
  it('tells the model which tools it has', () => {
    expect(toolsInstruction(DEFAULT_TOOL_POLICY)).toMatch(/^Tools: no tools\. Never emit tool-call markup/);
    expect(toolsInstruction(policy(['write']))).toBe('Tools: read, write, inside your working folder only. Never emit tool-call markup.');
  });

  it('strips tool-call markup a tools-off model wrote as text', () => {
    expect(stripToolMarkup('ok <function_calls><invoke name="x"></invoke></function_calls>')).toMatchObject({ stripped: true });
    expect(stripToolMarkup('plain')).toEqual({ text: 'plain', stripped: false });
  });
});

// ── runCli against a real child process (node plays the CLI) ─────────────

const fakeCli = (script: (turn: CliTurn) => string): CliSpec => ({
  ...claudeSpec,
  label: 'Fake',
  buildArgs: t => ['-e', script(t)],
});

const runInput = (overrides: Partial<EngineRunInput> = {}) => {
  const events: EngineEvent[] = [];
  const deltas: string[] = [];
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'pcd-engine-spec-')));
  return {
    events,
    deltas,
    input: {
      prompt: 'hi',
      history: [],
      systemPrompt: '',
      signal: new AbortController().signal,
      onDelta: (text: string) => deltas.push(text),
      onEvent: (event: EngineEvent) => events.push(event),
      workspace,
      policy: DEFAULT_TOOL_POLICY,
      ...overrides,
    } satisfies EngineRunInput,
  };
};

const lines = (objs: unknown[]) => `for (const l of ${JSON.stringify(objs.map(o => JSON.stringify(o)))}) console.log(l);`;

describe('runCli', () => {
  it('streams deltas and tool events, returns the result text and the session', async () => {
    let seenSystemPrompt = '';
    const spec = fakeCli(t => {
      seenSystemPrompt = t.systemPrompt;
      return lines([
        { type: 'system', subtype: 'init', session_id: 'S-9' },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'engine ' } } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } }] } },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } },
        { type: 'result', result: 'engine ok' },
      ]);
    });
    const run = runInput({ systemPrompt: 'Be brief.' });
    const result = await runCli(spec, process.execPath, run.input);
    expect(result).toEqual({ text: 'engine ok', sessionId: 'S-9' });
    expect(run.deltas.join('')).toBe('engine ok');
    expect(run.events.map(e => e.type)).toEqual(['thinking', 'tool_use', 'done']);
    expect(run.input.workspace).toBe(realpathSync(run.input.workspace));
    expect(seenSystemPrompt).toBe(`Be brief.\n\n${toolsInstruction(DEFAULT_TOOL_POLICY)}`);
  });

  // A resume token the CLI no longer knows must not fail every later turn.
  it('drops a stale session and runs the turn fresh', async () => {
    const spec = fakeCli(t =>
      t.resume
        ? `console.error('No conversation found with session ID ${t.resume}'); process.exit(1);`
        : lines([{ type: 'system', subtype: 'init', session_id: 'NEW' }, { type: 'result', result: 'fresh' }]),
    );
    const run = runInput({ sessionId: 'OLD' });
    expect(await runCli(spec, process.execPath, run.input)).toEqual({ text: 'fresh', sessionId: 'NEW' });
  });

  it('rejects with the CLI error', async () => {
    const spec = fakeCli(() => lines([{ type: 'result', is_error: true, result: 'Credit balance is too low' }]));
    await expect(runCli(spec, process.execPath, runInput().input)).rejects.toThrow('Fake: Credit balance is too low');
  });

  // Stop must end a CLI that ignores SIGTERM: SIGKILL follows after 3 s.
  it('stops with SIGTERM, then SIGKILL after 3 s', async () => {
    const spec = fakeCli(() => `process.on('SIGTERM', () => {}); console.log('{}'); setInterval(() => {}, 1000);`);
    const controller = new AbortController();
    const run = runInput({ signal: controller.signal });
    const started = Date.now();
    const pending = runCli(spec, process.execPath, run.input);
    setTimeout(() => controller.abort(), 300);
    await expect(pending).rejects.toThrow('Stopped.');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(3_000);
    expect(elapsed).toBeLessThan(6_000);
  }, 10_000);
});
