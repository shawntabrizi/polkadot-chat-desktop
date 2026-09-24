/**
 * The LLM proxy as an engine: wraps `streamChat` (client.ts). The proxy is
 * stateless, so every turn sends the system prompt and the history; there is
 * no session id. M13: when the turn may produce directives, they are offered
 * as tools (shared/directives.ts); a tool call becomes the result's
 * `directive` and never streams as text.
 */

import { type Directive, directiveFromToolCalls, directiveTools, directiveToolsHint } from '../../../shared/directives';
import { type ChatToolCall, DEFAULT_BASE_URL, DEFAULT_MODEL, streamChat } from '../client';

import type { Engine, EngineRunInput, EngineRunResult } from './types';

export const proxyEngine: Engine = {
  id: 'proxy',
  label: 'Proxy',
  detect: () => Promise.resolve({ installed: true, version: 'LLM proxy' }),
  run: async (input: EngineRunInput): Promise<EngineRunResult> => {
    input.onEvent({ type: 'thinking' });
    const kinds = input.directives ?? [];
    let calls: ChatToolCall[] = [];
    const systemPrompt = kinds.length > 0 ? [input.systemPrompt, directiveToolsHint(kinds)].filter(Boolean).join('\n') : input.systemPrompt;
    const text = await streamChat({
      model: input.model ?? DEFAULT_MODEL,
      baseUrl: input.baseUrl ?? DEFAULT_BASE_URL,
      key: input.key,
      signal: input.signal,
      onDelta: input.onDelta,
      ...(kinds.length > 0 ? { tools: directiveTools(kinds), onToolCalls: (found: ChatToolCall[]) => (calls = found) } : {}),
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...input.history,
        { role: 'user' as const, content: input.prompt },
      ],
    });
    input.onEvent({ type: 'done' });
    if (kinds.length === 0) return { text };
    const { directive, invalid }: { directive: Directive | null; invalid: string[] } = directiveFromToolCalls(calls, kinds);
    return { text, directive, directiveInvalid: invalid };
  },
};
