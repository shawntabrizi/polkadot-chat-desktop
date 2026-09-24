/**
 * The shared shape of an Assistant engine: the LLM proxy, or a local
 * coding-agent CLI (Claude Code, Codex, OpenCode). Nothing here imports
 * `electron`, so `scripts/e2e-engines.mjs` runs the engines in plain Node.
 */

import type { AssistantEngineId } from '../../../shared/desktop-api';
import type { Directive, DirectiveKind } from '../../../shared/directives';
import type { ToolPolicy } from '../toolPolicy';

export type EngineId = AssistantEngineId;

export const ENGINE_IDS: readonly EngineId[] = ['proxy', 'claude', 'codex', 'opencode'];

export const isEngineId = (value: unknown): value is EngineId => typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);

/** One earlier message of the conversation. */
export type Turn = { role: 'user' | 'assistant'; content: string };

export type EngineUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number };

export type EngineEvent =
  | { type: 'tool_use'; name: string; title: string }
  | { type: 'thinking' }
  | { type: 'done'; usage?: EngineUsage }
  | { type: 'error'; message: string };

export type EngineDetection = { installed: boolean; version?: string; path?: string };

export type EngineRunInput = {
  prompt: string;
  history: Turn[];
  systemPrompt: string;
  /** The engine's own session id from an earlier turn of this conversation (resume). */
  sessionId?: string;
  signal: AbortSignal;
  onDelta(text: string): void;
  onEvent(event: EngineEvent): void;
  /** The folder a CLI engine runs in: `<userData>/assistant-workspace/`. */
  workspace: string;
  /** What tools a CLI engine may use. Default: none. */
  policy: ToolPolicy;
  /**
   * M13: the structured directives this turn may produce. An engine with
   * tool calling (the proxy) gets them as tools; the others ignore this and
   * keep the fenced block in the text.
   */
  directives?: readonly DirectiveKind[];
  /** Proxy only: the model name and the proxy. */
  model?: string;
  baseUrl?: string;
  key?: string;
};

export type EngineRunResult = {
  text: string;
  sessionId?: string;
  /** M13: the directive the turn's tool calls produced (the fenced block's JSON); absent for text-only engines. */
  directive?: Directive | null;
  /** Tool calls that broke the rules and were dropped (for the log). */
  directiveInvalid?: string[];
};

export type Engine = {
  id: EngineId;
  label: string;
  detect(): Promise<EngineDetection>;
  run(input: EngineRunInput): Promise<EngineRunResult>;
};
