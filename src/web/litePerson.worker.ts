/**
 * M22a: the lite-person proof in a Web Worker, so the page stays responsive.
 * One request per message: `{ id, wasmUrl, args }` in, `{ id, code, output }`
 * or `{ id, error }` out. The module is compiled once per worker.
 */

import { runWasiCommand } from './wasi';

type Request = { id: number; wasmUrl: string; args: string[] };

let compiled: Promise<WebAssembly.Module> | null = null;

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const { id, wasmUrl, args } = event.data;
  compiled ??= WebAssembly.compileStreaming(fetch(wasmUrl));
  compiled
    .then(module => runWasiCommand(module, args))
    .then(
      run => self.postMessage({ id, code: run.code, output: run.output }),
      (cause: unknown) => {
        compiled = null;
        self.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
});
