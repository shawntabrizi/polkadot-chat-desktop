import { describe, expect, it } from 'vitest';

import { type ChatMessage, streamChat } from './client';

const sse = (content: string, extra: Record<string, unknown> = {}): string =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content, ...extra } }] })}\n\n`;

/** A fake `fetch` whose body yields `chunks` one read at a time, and that records the request. */
const fakeFetch = (chunks: string[], status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status });
  }) as typeof fetch;
  return { impl, calls };
};

const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

describe('streamChat', () => {
  it('calls onDelta once per SSE chunk, in order, and resolves with the whole reply', async () => {
    const { impl, calls } = fakeFetch([sse('Hello'), sse(', '), sse('world'), 'data: [DONE]\n\n']);
    const deltas: string[] = [];
    const reply = await streamChat({ messages, onDelta: text => deltas.push(text), key: 'test-key', fetch: impl });

    expect(deltas).toEqual(['Hello', ', ', 'world']);
    expect(reply).toBe('Hello, world');
    // The request shape the OpenAI-format proxy expects.
    expect(calls[0]?.url).toBe('https://llm.substrate.dev/v1/chat/completions');
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer test-key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ model: 'auto/deepseek-v4.1-flash', messages, stream: true });
  });

  // Some proxy models stream their reasoning first with `content: ""`; that
  // text must never show up as the reply.
  it('ignores reasoning fields and empty content', async () => {
    const { impl } = fakeFetch([sse('', { reasoning_content: 'thinking…' }), sse('ok')]);
    const deltas: string[] = [];
    expect(await streamChat({ messages, onDelta: text => deltas.push(text), key: 'k', fetch: impl })).toBe('ok');
    expect(deltas).toEqual(['ok']);
  });

  // A network read can end in the middle of an event.
  it('joins an SSE line split across reads', async () => {
    const whole = sse('split');
    const { impl } = fakeFetch([whole.slice(0, 20), whole.slice(20)]);
    const deltas: string[] = [];
    await streamChat({ messages, onDelta: text => deltas.push(text), key: 'k', fetch: impl });
    expect(deltas).toEqual(['split']);
  });

  // The proxy's 401 body quotes part of the key; the error text ends up in
  // the renderer and in Dexie (the room's notice), where no key may go.
  it('rejects a refused key without any part of the key in the message', async () => {
    const { impl } = fakeFetch(['{"error":{"message":"Received=secr****alue"}}'], 401);
    const failure = streamChat({ messages, onDelta: () => undefined, key: 'secret-key-value', fetch: impl });
    await expect(failure).rejects.toThrow('The proxy refused the API key (HTTP 401).');
  });

  it('keeps other HTTP error bodies, with the key taken out', async () => {
    const { impl } = fakeFetch(['model not found; key secret-key-value, masked secr****alue'], 404);
    const failure = streamChat({ messages, onDelta: () => undefined, key: 'secret-key-value', fetch: impl });
    await expect(failure).rejects.toThrow('The proxy answered HTTP 404: model not found; key [key], masked [redacted]');
  });

  it('refuses to call the proxy without a key', async () => {
    const { impl, calls } = fakeFetch([]);
    await expect(streamChat({ messages, onDelta: () => undefined, key: '', fetch: impl })).rejects.toThrow(/No API key/);
    expect(calls).toHaveLength(0);
  });
});
