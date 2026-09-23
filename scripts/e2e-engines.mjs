#!/usr/bin/env node
// M6 step 14: every Assistant engine installed on this machine answers one
// prompt with tools off, in an empty throwaway workspace:
//   npm run e2e:engines
// Prints `ENGINE <id> ok|fail <first 60 chars>` per installed engine, then
// ENGINES_OK when every one answered, else exits 6. The proxy engine runs
// only when LLM_PROXY_KEY is set. Claude Code refuses to start inside
// another Claude Code session; that prints `ENGINE claude skipped (nested
// session)` and is not a failure. Prints no secret.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { ENGINES, ENGINE_IDS } = await import(pathToFileURL(join(root, 'src/main/assistant/engines/index.ts')).href);
const { DEFAULT_TOOL_POLICY } = await import(pathToFileURL(join(root, 'src/main/assistant/toolPolicy.ts')).href);

const PROMPT = 'Reply with exactly: engine ok';
const SYSTEM_PROMPT = 'You are the assistant inside Polkadot Chat. Answer briefly in markdown.';
const TIMEOUT_MS = 180_000;
const NESTED = /inside another Claude Code session|nested session|cannot be launched inside/i;

const oneLine = text => text.replace(/\s+/g, ' ').trim().slice(0, 60);
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'pcd-e2e-engines-')));
console.log(`workspace ${workspace} (empty, tools off)`);
console.log(`prompt: ${PROMPT}`);

let installed = 0;
let failed = 0;
for (const id of ENGINE_IDS) {
  const engine = ENGINES[id];
  if (id === 'proxy' && !process.env.LLM_PROXY_KEY) {
    console.log('ENGINE proxy not run (LLM_PROXY_KEY is not set)');
    continue;
  }
  const detected = await engine.detect();
  if (!detected.installed) {
    console.log(`ENGINE ${id} not installed`);
    continue;
  }
  installed += 1;
  const started = Date.now();
  const events = [];
  let deltas = 0;
  try {
    const result = await engine.run({
      prompt: PROMPT,
      history: [],
      systemPrompt: SYSTEM_PROMPT,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      onDelta: () => {
        deltas += 1;
      },
      onEvent: event => events.push(event.type),
      workspace,
      policy: DEFAULT_TOOL_POLICY,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const ok = result.text.toLowerCase().includes('engine ok');
    if (!ok) failed += 1;
    console.log(`ENGINE ${id} ${ok ? 'ok' : 'fail'} ${oneLine(result.text)}`);
    console.log(`  ${detected.version ?? ''} · ${seconds}s · ${deltas} deltas · events ${[...new Set(events)].join(',')} · session ${result.sessionId ? 'yes' : 'no'}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (id === 'claude' && NESTED.test(message)) {
      installed -= 1;
      console.log('ENGINE claude skipped (nested session)');
      continue;
    }
    failed += 1;
    console.log(`ENGINE ${id} fail ${oneLine(message)}`);
    console.log(`  ${detected.version ?? ''} · error: ${message.slice(0, 300)}`);
  }
}

rmSync(workspace, { recursive: true, force: true });
if (installed === 0) {
  console.log('no engine is installed');
  process.exit(6);
}
if (failed > 0) {
  console.log(`ENGINES_FAIL ${failed} of ${installed} did not answer`);
  process.exit(6);
}
console.log('ENGINES_OK');
