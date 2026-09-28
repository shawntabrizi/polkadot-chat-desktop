/**
 * The web's `LitePersonRunner` (register.ts): the vendored wasm in a Web
 * Worker (litePerson.worker.ts) through the WASI shim (wasi.ts). The wasm is
 * served as a static asset of the web build.
 */

import wasmUrl from '../../resources/summit-bandersnatch-cli.wasm?url';

import { type LitePersonOutput, type LitePersonRunner, parseLitePersonOutput } from '../main/identity/register';

type Reply = { id: number; code: number; output: string } | { id: number; error: string };

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (value: LitePersonOutput) => void; reject: (error: Error) => void }>();

const workerFor = (): Worker => {
  if (worker) return worker;
  const created = new Worker(new URL('./litePerson.worker.ts', import.meta.url), { type: 'module' });
  created.addEventListener('message', (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const entry = waiting.get(reply.id);
    if (!entry) return;
    waiting.delete(reply.id);
    if ('error' in reply) entry.reject(new Error(`identity proof helper failed: ${reply.error}`));
    else {
      try {
        entry.resolve(parseLitePersonOutput(reply.code, reply.output.trim()));
      } catch (cause) {
        entry.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  });
  created.addEventListener('error', event => {
    for (const entry of waiting.values()) entry.reject(new Error(`identity proof helper could not start: ${event.message}`));
    waiting.clear();
    worker = null;
  });
  worker = created;
  return created;
};

export const runLitePerson: LitePersonRunner = (entropyHex, messageHex) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    workerFor().postMessage({ id, wasmUrl: new URL(wasmUrl, location.href).href, args: ['bandersnatch', 'lite-person', entropyHex, messageHex] });
  });
