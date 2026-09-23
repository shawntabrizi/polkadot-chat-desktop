// Copied from .refs/bot-core/lib/runners.mjs (toolActionTitle, the path
// helpers, assertEngineToolPolicy, toolPolicyEnforcement) and
// .refs/bot-core/lib/agent-runtime.mjs (stripToolMarkup, buildAgentEnvironment,
// the spawn/stream/idle-backstop loop of runEngine, killProcessGroup,
// STALE_RESUME_PATTERN) on 2026-09-23; changes: TypeScript; one turn per call
// (no per-peer queue, persistence, commands, attachments or artifact output:
// the app keeps the session id in Dexie and has one conversation); the kill
// grace is 3 s (M6 step 13), not 2 s; the markup note names the app's
// Settings, not `pca run`; the environment also passes the engine's declared
// credential variables, and PATH gets the CLI's own folder and the usual
// install folders (an app started from Finder has a minimal PATH); an abort
// signal replaces `/stop`; `detectCli` is new.

import { execFile, spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

import { type ToolPolicy, createToolPolicy, hasToolCapability, toolPolicyError } from '../toolPolicy';

import type { EngineDetection, EngineEvent, EngineRunInput, EngineRunResult, EngineUsage, Turn } from './types';

// ── Titles and markup ──────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

/** One-line titles for tool events, shared by every engine. */
export const toolActionTitle = (name: unknown, input: ToolInput = {}): string => {
  const n = String(name || '').toLowerCase();
  const text = (value: unknown): string => String(value ?? '');
  const base = (p: unknown) => text(p).split('/').filter(Boolean).pop() || text(p);
  if (n === 'bash' || n === 'shell') return `$ ${text(input.command ?? input.cmd).replace(/\s+/g, ' ').trim().slice(0, 80)}`;
  if (n === 'read') return `reading ${base(input.file_path ?? input.filePath ?? input.path)}`;
  if (n === 'write' || n === 'edit' || n === 'multiedit' || n === 'notebookedit') return `editing ${base(input.file_path ?? input.filePath ?? input.path)}`;
  if (n === 'grep' || n === 'glob') return `searching ${text(input.pattern)}`.trim();
  if (n === 'websearch') return `searching: ${text(input.query)}`.trim();
  if (n === 'webfetch') return `fetching ${text(input.url)}`.trim();
  if (n === 'task' || n === 'agent') return `subagent: ${text(input.description ?? input.subagent_type).slice(0, 60)}`.trim();
  return String(name || 'tool');
};

// A model with no tools sometimes writes a tool call as prose. The blocks are
// removed; a reply that was nothing but markup becomes an honest note.
const TOOL_MARKUP_BLOCK = /<function_calls>[\s\S]*?<\/function_calls>|<invoke\b[\s\S]*?<\/invoke>|<\/?function_calls>/g;
export const TOOL_MARKUP_NOTE = "Tools are off for the Assistant, so it can't run commands or read files here. Turn them on in Settings, Assistant, Tools.";
export const stripToolMarkup = (value: string): { text: string; stripped: boolean } => {
  if (!TOOL_MARKUP_BLOCK.test(value)) return { text: value, stripped: false };
  TOOL_MARKUP_BLOCK.lastIndex = 0;
  const cleaned = value.replace(TOOL_MARKUP_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned ? `${cleaned}\n\n${TOOL_MARKUP_NOTE}` : TOOL_MARKUP_NOTE, stripped: true };
};

// ── Paths for native permission rules ──────────────────────────────────

export const absolutePath = (value: string, label: string): string => {
  const resolved = resolve(String(value));
  // eslint-disable-next-line no-control-regex -- a NUL or newline in a path breaks the rule grammars.
  if (/[\x00\r\n]/.test(resolved)) throw toolPolicyError(`${label} contains an invalid path.`);
  return resolved;
};

export const isAncestorPath = (ancestor: string, candidate: string): boolean => candidate === ancestor || candidate.startsWith(ancestor + sep);

export const assertEngineToolPolicy = (engineName: string, policyInput: ToolPolicy): ToolPolicy => {
  const policy = createToolPolicy(policyInput);
  if (!['claude', 'codex', 'opencode'].includes(engineName)) {
    throw toolPolicyError(`No tool-policy adapter exists for "${engineName}".`);
  }
  return policy;
};

export type ToolEnforcement = { kind: string; detail: string; unscoped?: readonly string[] };

export const toolPolicyEnforcement = (engineName: string, policyInput: ToolPolicy): ToolEnforcement => {
  const policy = assertEngineToolPolicy(engineName, policyInput);
  if (!policy.capabilities.length) return { kind: 'none', detail: 'all native tools disabled' };
  const unscoped: string[] = [];
  if (hasToolCapability(policy, 'web')) unscoped.push('web tools reach any URL');
  if (hasToolCapability(policy, 'subagents')) unscoped.push('subagents inherit this same policy');
  const file = fileEnforcement(engineName, policy);
  return unscoped.length ? { ...file, detail: `${file.detail} (${unscoped.join('; ')})`, unscoped: Object.freeze([...unscoped]) } : file;
};

const fileEnforcement = (engineName: string, policy: ToolPolicy): ToolEnforcement => {
  if (hasToolCapability(policy, 'bash')) {
    return policy.scope === 'workspace'
      ? { kind: 'process-boundary', detail: 'native file tools are workspace-scoped; Bash follows the agent process boundary' }
      : { kind: 'process-boundary', detail: "selected tools run across the agent process's visible files" };
  }
  if (policy.scope === 'container') return { kind: 'process-boundary', detail: "selected tools run across the agent process's visible files" };
  if (engineName === 'claude') return { kind: 'native-rules', detail: 'Claude path-scoped file-tool rules' };
  if (engineName === 'codex') return { kind: 'native-sandbox', detail: 'Codex native workspace permission/sandbox profile' };
  return { kind: 'permission-policy', detail: 'OpenCode deny-first file-tool policy' };
};

/**
 * The input tokens an engine reports are the uncached remainder only; the
 * prompt is that plus what was read from or written to the prompt cache.
 */
export const totalInputTokens = (usage: Record<string, unknown> | undefined): number | null => {
  const parts = [usage?.input_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
};

// ── Environment ────────────────────────────────────────────────────────

// Agent CLIs get only what a normal interactive CLI needs. Never the app's
// own configuration, never provider credentials unless the engine declares
// that it needs one (`passEnv`).
const INHERITED_AGENT_ENV = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'TERM', 'COLORTERM', 'NO_COLOR',
  'TMPDIR', 'TMP', 'TEMP',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
];

/**
 * Never inherited (M6 step 10): another agent's session markers (a Claude
 * Code parent makes a child `claude` refuse to start), and credentials.
 */
export const isDroppedAgentEnvName = (name: string): boolean =>
  /^(?:CLAUDECODE|CLAUDE_CODE_|CODEX_|OPENCODE_)/.test(name) || /(?:_API_KEY|_TOKEN)$/.test(name);

/** Where CLIs are usually installed; an app started from Finder has none of these on PATH. */
export const extraBinDirs = (home: string = homedir()): string[] => [
  join(home, '.local/bin'),
  join(home, '.claude/local'),
  join(home, '.opencode/bin'),
  join(home, '.npm-global/bin'),
  join(home, '.bun/bin'),
  join(home, '.volta/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

const searchPath = (parentPath: string | undefined, home?: string): string[] => [
  ...new Set([...(parentPath ?? '').split(delimiter).filter(Boolean), ...extraBinDirs(home)]),
];

export const buildAgentEnvironment = ({
  parentEnv = process.env,
  passEnv = [],
  agentEnv = {},
  binaryDir,
}: {
  parentEnv?: NodeJS.ProcessEnv;
  /** Credential variables this engine needs, copied from the parent when set. */
  passEnv?: readonly string[];
  /** Generated, non-secret variables of this turn (OpenCode's permission config). */
  agentEnv?: Record<string, string>;
  /** The CLI's folder: a node-script CLI finds `node` next to itself (nvm). */
  binaryDir?: string;
} = {}): Record<string, string> => {
  const env: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of INHERITED_AGENT_ENV) {
    const value = parentEnv[key];
    if (typeof value === 'string' && value && !isDroppedAgentEnvName(key)) env[key] = value;
  }
  env.PATH = [...new Set([...(binaryDir ? [binaryDir] : []), ...searchPath(env.PATH ?? '/usr/bin:/bin', env.HOME)])].join(delimiter);
  for (const key of passEnv) {
    const value = parentEnv[key];
    if (typeof value === 'string' && value) env[key] = value;
  }
  for (const [key, value] of Object.entries(agentEnv)) env[key] = value;
  return env;
};

// ── Detection ──────────────────────────────────────────────────────────

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const findExecutable = (command: string, parentEnv: NodeJS.ProcessEnv = process.env): string | null => {
  for (const dir of searchPath(parentEnv.PATH, parentEnv.HOME)) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
};

const VERSION_TIMEOUT_MS = 15_000;

/** Finds the CLI and asks it for `--version`. Never throws. */
export const detectCli = (command: string, parentEnv: NodeJS.ProcessEnv = process.env): Promise<EngineDetection> => {
  const path = findExecutable(command, parentEnv);
  if (!path) return Promise.resolve({ installed: false });
  return new Promise(done => {
    execFile(
      path,
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, env: buildAgentEnvironment({ parentEnv, binaryDir: dirname(path) }) },
      (error, stdout) => {
        const version = String(stdout ?? '').trim().split('\n')[0]?.trim();
        if (error && !version) done({ installed: false, path });
        else done({ installed: true, path, ...(version ? { version } : {}) });
      },
    );
  });
};

// ── Prompt ─────────────────────────────────────────────────────────────

/**
 * What the model is told about its tools (from .refs/bot-core/lib/agent-context.mjs):
 * a prompt is not a guarantee, which is why stripToolMarkup exists too.
 */
export const toolsInstruction = (policy: ToolPolicy): string => {
  const tools = createToolPolicy(policy).capabilities;
  return tools.length
    ? `Tools: ${tools.join(', ')}, inside your working folder only. Never emit tool-call markup.`
    : 'Tools: no tools. Never emit tool-call markup. If a request needs a tool, say that tools are off and that the user can turn them on in Settings, Assistant, Tools.';
};

const HISTORY_CHARS = 24_000;

/**
 * A resumed session already holds the conversation and its instructions, so
 * it gets the new message only. A fresh one gets the earlier turns of the
 * room (the Assistant may have been answered by another engine), and, for an
 * engine without a system-prompt flag, the instructions first.
 */
export const composePrompt = ({ prompt, history, systemPrompt, sessionId }: Pick<EngineRunInput, 'prompt' | 'history' | 'systemPrompt' | 'sessionId'>, withInstructions: boolean): string => {
  if (sessionId) return prompt;
  const parts: string[] = [];
  if (withInstructions && systemPrompt.trim()) parts.push(systemPrompt.trim());
  const lines: string[] = [];
  let size = 0;
  for (const turn of [...history].reverse()) {
    const line = `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`;
    if (size + line.length > HISTORY_CHARS) break;
    lines.unshift(line);
    size += line.length;
  }
  if (lines.length) parts.push(`Conversation so far:\n${lines.join('\n\n')}`);
  if (!parts.length) return prompt;
  return `${parts.join('\n\n')}\n\nUser message:\n${prompt}`;
};

export const historyOf = (turns: readonly Turn[]): Turn[] => turns.filter(turn => turn.content.trim() !== '');

// ── The spawn/stream loop ──────────────────────────────────────────────

/** A normalized event of one CLI's JSONL stream (runners.mjs vocabulary). */
export type RunnerEvent =
  | { kind: 'started'; sessionId: string }
  | { kind: 'action'; name: string; title: string }
  | { kind: 'partial'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'result'; text: string; ok: true; usage?: EngineUsage }
  | { kind: 'error'; message: string };

export type CliTurn = { prompt: string; resume: string | null; systemPrompt: string; policy: ToolPolicy; workspace: string };

export type CliSpec = {
  id: 'claude' | 'codex' | 'opencode';
  label: string;
  command: string;
  /** The CLI streams answer text as `partial` events (else each `text` is shown as it comes). */
  streamsPartials: boolean;
  /** Whether the CLI takes the instructions through a flag (else they go in the first prompt). */
  systemPromptFlag: boolean;
  /** Credential variables the engine needs from the app's environment. */
  passEnv: readonly string[];
  buildArgs(turn: CliTurn): string[];
  buildEnvironment?(turn: CliTurn): Record<string, string>;
  parseEvent(obj: unknown): RunnerEvent[];
};

const IDLE_MS = 600_000;
const KILL_GRACE_MS = 3_000;
const OUTPUT_LIMIT = 1_000_000;
const EVENT_LINE_LIMIT = 64 * 1024;
// What the CLIs print when asked to resume a session they no longer have.
const STALE_RESUME_PATTERN = /session ["']?[^"'\n]*["']? not found|no conversation found|different directory/i;

type Child = ReturnType<typeof spawn>;

/** SIGTERM to the whole process group (agent-spawned shells too), SIGKILL after the grace. */
export const killProcessGroup = (child: Child, graceMs: number = KILL_GRACE_MS): void => {
  if (child.exitCode != null || child.signalCode != null || child.pid == null) return;
  const pid = child.pid;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      try {
        child.kill(name);
      } catch {
        // already gone
      }
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) signal('SIGKILL');
  }, graceMs);
  timer.unref?.();
};

export type SpawnFn = typeof spawn;

/**
 * Runs one turn of a CLI engine. Resolves with the answer (the terminal
 * result text, else the accumulated answer text, markup stripped) and the
 * session id the CLI reported. Rejects with a readable message: the CLI's
 * error event, its stderr tail, or "Stopped." after an abort.
 */
export const runCli = (
  spec: CliSpec,
  binary: string,
  input: EngineRunInput,
  options: { spawnImpl?: SpawnFn; parentEnv?: NodeJS.ProcessEnv; idleMs?: number } = {},
): Promise<EngineRunResult> => {
  const policy = assertEngineToolPolicy(spec.id, input.policy);
  const workspace = absolutePath(input.workspace, 'workspace');
  const spawnImpl = options.spawnImpl ?? spawn;
  const idleMs = options.idleMs ?? IDLE_MS;

  const once = (resume: string | null): Promise<EngineRunResult & { staleResume?: boolean }> =>
    new Promise((done, fail) => {
      if (input.signal.aborted) return fail(new Error('Stopped.'));
      const systemPrompt = [input.systemPrompt.trim(), toolsInstruction(policy)].filter(Boolean).join('\n\n');
      const turn: CliTurn = {
        prompt: composePrompt({ ...input, systemPrompt, sessionId: resume ?? undefined }, !spec.systemPromptFlag),
        resume,
        systemPrompt,
        policy,
        workspace,
      };
      let child: Child;
      try {
        child = spawnImpl(binary, spec.buildArgs(turn), {
          cwd: workspace,
          env: buildAgentEnvironment({
            parentEnv: options.parentEnv,
            passEnv: spec.passEnv,
            agentEnv: spec.buildEnvironment?.(turn) ?? {},
            binaryDir: dirname(binary),
          }),
          // stdin ignored: codex otherwise waits for "additional input".
          stdio: ['ignore', 'pipe', 'pipe'],
          // A process group of its own, so a kill reaps the CLI's children.
          detached: true,
        });
      } catch (cause) {
        return fail(new Error(`${spec.label} did not start: ${cause instanceof Error ? cause.message : String(cause)}`));
      }
      input.onEvent({ type: 'thinking' });

      let stderr = '';
      let lineBuf = '';
      let answer = '';
      let resultText: string | null = null;
      let usage: EngineUsage | undefined;
      let errored: string | null = null;
      let sessionId: string | undefined;
      let outputBytes = 0;
      let outputExceeded = false;
      let discardingLine = false;
      let settled = false;
      let idle: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(idle);
        input.signal.removeEventListener('abort', onAbort);
        outcome();
      };
      const onAbort = () => killProcessGroup(child);
      input.signal.addEventListener('abort', onAbort, { once: true });
      const bumpIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => killProcessGroup(child), idleMs);
        idle.unref?.();
      };
      bumpIdle();
      const noteOutput = (bytes: number) => {
        outputBytes += bytes;
        if (outputBytes > OUTPUT_LIMIT && !outputExceeded) {
          outputExceeded = true;
          killProcessGroup(child);
        }
      };

      const onLine = (line: string) => {
        if (!line.trim()) return;
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          return;
        }
        for (const event of spec.parseEvent(obj)) {
          switch (event.kind) {
            case 'started':
              sessionId ??= event.sessionId;
              break;
            case 'action':
              input.onEvent({ type: 'tool_use', name: event.name, title: event.title });
              break;
            // Partial text is display only; the complete messages own the answer.
            case 'partial':
              input.onDelta(event.text);
              break;
            case 'text':
              answer += event.text;
              if (!spec.streamsPartials) input.onDelta(event.text);
              break;
            case 'result':
              resultText = event.text || null;
              if (event.usage) usage = event.usage;
              break;
            case 'error':
              errored = event.message;
              break;
          }
        }
      };

      child.stdout?.on('data', (data: Buffer) => {
        bumpIdle();
        noteOutput(data.length);
        if (outputExceeded) return;
        let text = data.toString();
        if (discardingLine) {
          const nl = text.indexOf('\n');
          if (nl < 0) return;
          discardingLine = false;
          text = text.slice(nl + 1);
        }
        lineBuf += text;
        let nl: number;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          if (Buffer.byteLength(line) <= EVENT_LINE_LIMIT) onLine(line);
        }
        if (Buffer.byteLength(lineBuf) > EVENT_LINE_LIMIT) {
          lineBuf = '';
          discardingLine = true;
        }
      });
      child.stderr?.on('data', (data: Buffer) => {
        bumpIdle();
        noteOutput(data.length);
        if (stderr.length < 16_384) stderr += data.toString().slice(0, 16_384 - stderr.length);
      });
      child.on('error', cause => finish(() => fail(new Error(input.signal.aborted ? 'Stopped.' : `${spec.label} did not start: ${cause.message}`))));
      child.on('close', code => {
        if (lineBuf && !discardingLine && !outputExceeded) onLine(lineBuf);
        finish(() => {
          if (input.signal.aborted) return fail(new Error('Stopped.'));
          if (outputExceeded) return fail(new Error(`${spec.label} wrote more output than the app accepts.`));
          if (errored) return fail(new Error(`${spec.label}: ${String(errored).slice(0, 300)}`));
          const final = stripToolMarkup((resultText ?? answer).trim()).text;
          // A partial answer counts only when the CLI closed the turn with a result.
          if (code === 0 || (final && resultText !== null)) {
            input.onEvent({ type: 'done', ...(usage ? { usage } : {}) });
            return done({ text: final, ...(sessionId ? { sessionId } : {}) });
          }
          if (resume && STALE_RESUME_PATTERN.test(stderr)) return done({ text: '', staleResume: true });
          const tail = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-300);
          fail(new Error(`${spec.label} stopped with exit code ${String(code)}${tail ? `: ${tail}` : '.'}`));
        });
      });
    });

  const resume = input.sessionId ?? null;
  return once(resume).then(result => {
    // The session to resume is gone (wiped, or from another folder): run the
    // turn once more as a fresh session instead of failing every later turn.
    if (result.staleResume) return once(null);
    return result;
  });
};

/** An engine for one CLI: finds it on the machine, then runs turns through `runCli`. */
export const createCliEngine = (spec: CliSpec, options: { parentEnv?: NodeJS.ProcessEnv; spawnImpl?: SpawnFn } = {}) => ({
  id: spec.id,
  label: spec.label,
  detect: () => detectCli(spec.command, options.parentEnv),
  run: async (input: EngineRunInput): Promise<EngineRunResult> => {
    const binary = findExecutable(spec.command, options.parentEnv);
    if (!binary) throw new Error(`${spec.label} is not installed on this computer.`);
    return runCli(spec, binary, input, options);
  },
});

export type { EngineEvent };
