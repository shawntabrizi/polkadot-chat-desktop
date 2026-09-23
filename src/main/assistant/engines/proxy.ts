/**
 * The LLM proxy as an engine: wraps `streamChat` (client.ts). The proxy is
 * stateless, so every turn sends the system prompt and the history; there is
 * no session id and no tool.
 */

import { DEFAULT_BASE_URL, DEFAULT_MODEL, streamChat } from '../client';

import type { Engine, EngineRunInput, EngineRunResult } from './types';

export const proxyEngine: Engine = {
  id: 'proxy',
  label: 'Proxy',
  detect: () => Promise.resolve({ installed: true, version: 'LLM proxy' }),
  run: async (input: EngineRunInput): Promise<EngineRunResult> => {
    input.onEvent({ type: 'thinking' });
    const text = await streamChat({
      model: input.model ?? DEFAULT_MODEL,
      baseUrl: input.baseUrl ?? DEFAULT_BASE_URL,
      key: input.key,
      signal: input.signal,
      onDelta: input.onDelta,
      messages: [
        ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
        ...input.history,
        { role: 'user' as const, content: input.prompt },
      ],
    });
    input.onEvent({ type: 'done' });
    return { text };
  },
};
