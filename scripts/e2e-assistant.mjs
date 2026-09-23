#!/usr/bin/env node
// One prompt through the main-process LLM proxy client, streamed:
//   LLM_PROXY_KEY=... npm run e2e:assistant
// Prints the reply as it streams, then ASSISTANT_OK when it contains
// "proxy ok" (any case), else exits 5. Exit 2 when LLM_PROXY_KEY is not set.
// The key is read from the environment only; it is never printed.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_BASE_URL, DEFAULT_MODEL, streamChat } = await import(pathToFileURL(join(root, 'src/main/assistant/client.ts')).href);

const PROMPT = 'Reply with exactly: proxy ok';
const TIMEOUT_MS = 120_000;

if (!process.env.LLM_PROXY_KEY) {
  console.error('LLM_PROXY_KEY is not set');
  process.exit(2);
}

console.log(`proxy ${DEFAULT_BASE_URL} model ${DEFAULT_MODEL}`);
console.log(`prompt: ${PROMPT}`);
process.stdout.write('reply: ');
let deltas = 0;
try {
  const reply = await streamChat({
    messages: [{ role: 'user', content: PROMPT }],
    signal: AbortSignal.timeout(TIMEOUT_MS),
    onDelta: (text) => {
      deltas += 1;
      process.stdout.write(text);
    },
  });
  process.stdout.write('\n');
  console.log(`deltas ${deltas}, ${reply.length} chars`);
  if (!reply.toLowerCase().includes('proxy ok')) {
    console.log('ASSISTANT_FAIL reply does not contain "proxy ok"');
    process.exit(5);
  }
  console.log('ASSISTANT_OK');
} catch (cause) {
  process.stdout.write('\n');
  console.log(`ASSISTANT_FAIL ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(5);
}
