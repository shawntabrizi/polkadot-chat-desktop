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

/** A tool the model may call (OpenAI format); M13 structured directives. */
export type ChatTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
/** A finished tool call: the function name and its whole arguments text. */
export type ChatToolCall = { name: string; arguments: string };

export type StreamChatOptions = {
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  model?: string;
  signal?: AbortSignal;
  baseUrl?: string;
  /** Defaults to `process.env.LLM_PROXY_KEY`. */
  key?: string;
  fetch?: typeof fetch;
  /** Tools the model may call. Their calls never reach `onDelta`: they come whole to `onToolCalls`. */
  tools?: ChatTool[];
  /** Called once, before the promise resolves, with the turn's tool calls (only when there are any). */
  onToolCalls?: (calls: ChatToolCall[]) => void;
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
type StreamChunk = {
  choices?: { delta?: { content?: unknown; tool_calls?: unknown } }[];
  error?: { message?: unknown };
};

const parseChunk = (payload: string): StreamChunk => {
  const chunk = JSON.parse(payload) as StreamChunk;
  if (chunk.error) throw new Error(`The proxy failed: ${String(chunk.error.message ?? 'unknown error')}`);
  return chunk;
};

export const deltaOf = (payload: string): string => {
  const content = parseChunk(payload).choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
};

/**
 * Tool-call pieces of one SSE payload (`delta.tool_calls`), added to `calls`
 * by their `index`: the name comes once, the arguments text in pieces.
 */
const addToolCallPieces = (payload: string, calls: Map<number, ChatToolCall>): void => {
  const pieces = parseChunk(payload).choices?.[0]?.delta?.tool_calls;
  if (!Array.isArray(pieces)) return;
  for (const piece of pieces as { index?: unknown; function?: { name?: unknown; arguments?: unknown } }[]) {
    const index = typeof piece.index === 'number' ? piece.index : 0;
    const call = calls.get(index) ?? { name: '', arguments: '' };
    if (typeof piece.function?.name === 'string') call.name += piece.function.name;
    if (typeof piece.function?.arguments === 'string') call.arguments += piece.function.arguments;
    calls.set(index, call);
  }
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
  tools,
  onToolCalls,
}: StreamChatOptions): Promise<string> => {
  if (!key) throw new Error('No API key for the LLM proxy. Set one in Settings.');
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
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
  const toolCalls = new Map<number, ChatToolCall>();
  const finish = (): string => {
    const calls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter(call => call.name);
    if (calls.length > 0) onToolCalls?.(calls);
    return reply;
  };
  // An SSE event can be split across reads, so only whole lines are parsed.
  const takeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false; // blank lines, `:` comments, `event:` fields
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return true;
    if (tools?.length) addToolCallPieces(payload, toolCalls);
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
        return finish();
      }
    }
  }
  takeLine(buffer);
  return finish();
};
