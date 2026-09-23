/**
 * The LLM proxy client: one streamed OpenAI-format chat completion. It does
 * not import `electron`, so `scripts/e2e-assistant.mjs` runs it in plain Node.
 * The key goes only into the Authorization header; it is never part of an
 * error message.
 */

export const DEFAULT_BASE_URL = 'https://llm.substrate.dev';
export const DEFAULT_MODEL = 'auto/deepseek-v4.1-flash';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

export type StreamChatOptions = {
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  model?: string;
  signal?: AbortSignal;
  baseUrl?: string;
  /** Defaults to `process.env.LLM_PROXY_KEY`. */
  key?: string;
  fetch?: typeof fetch;
};

/** How much of an error body goes into the error message. */
const ERROR_BODY_CHARS = 300;

/** An error body must not carry the key, whole or masked (`sk-a****wxyz`). */
const redact = (body: string, key: string): string => body.split(key).join('[key]').replace(/\S*\*{3,}\S*/g, '[redacted]');

/**
 * The reply text of one SSE `data:` payload. Only `choices[0].delta.content`
 * is reply text: some proxy models stream a reasoning block first (in other
 * delta fields, with `content: ""`).
 */
export const deltaOf = (payload: string): string => {
  const chunk = JSON.parse(payload) as {
    choices?: { delta?: { content?: unknown } }[];
    error?: { message?: unknown };
  };
  if (chunk.error) throw new Error(`The proxy failed: ${String(chunk.error.message ?? 'unknown error')}`);
  const content = chunk.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
};

/**
 * Streams one completion. Calls `onDelta` for each non-empty piece of reply
 * text and resolves with the whole reply. Rejects on an HTTP error, a proxy
 * error chunk, or an abort (`signal`).
 */
export const streamChat = async ({
  messages,
  onDelta,
  model = DEFAULT_MODEL,
  signal,
  baseUrl = DEFAULT_BASE_URL,
  key = process.env.LLM_PROXY_KEY,
  fetch: fetchImpl = fetch,
}: StreamChatOptions): Promise<string> => {
  if (!key) throw new Error('No API key for the LLM proxy. Set one in Settings.');
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    // The proxy's auth error quotes part of the key it got; that body is not shown.
    throw new Error(`The proxy refused the API key (HTTP ${response.status}).`);
  }
  if (!response.ok || !response.body) {
    const body = redact((await response.text().catch(() => '')).slice(0, ERROR_BODY_CHARS), key);
    throw new Error(`The proxy answered HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let reply = '';
  // An SSE event can be split across reads, so only whole lines are parsed.
  const takeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false; // blank lines, `:` comments, `event:` fields
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return true;
    const text = deltaOf(payload);
    if (text) {
      reply += text;
      onDelta(text);
    }
    return false;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (takeLine(line)) {
        await reader.cancel();
        return reply;
      }
    }
  }
  takeLine(buffer);
  return reply;
};
