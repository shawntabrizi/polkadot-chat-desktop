/**
 * The lite-person proof on the desktop: `resources/summit-bandersnatch-cli.wasm`
 * through node:wasi (moved here from register.ts in M22a, unchanged, so
 * register.ts has no Node module; the web runs the same wasm in a Web Worker).
 */

import { closeSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resourcePath } from '../resources';

import { type LitePersonOutput, parseLitePersonOutput } from './register';

let wasmModule: WebAssembly.Module | null = null; // compiled once, instantiated per run (WASI starts are single-shot)
let wasiWarningFiltered = false;

/**
 * Runs `bandersnatch lite-person <entropyHex> <messageHex>` from
 * `resources/summit-bandersnatch-cli.wasm` in-process through node:wasi.
 * The output is deterministic: identical bytes to the native binary.
 */
export async function runLitePerson(entropyHex: string, messageHex: string): Promise<LitePersonOutput> {
  // node:wasi emits an ExperimentalWarning on import; filter that one warning only.
  if (!wasiWarningFiltered) {
    wasiWarningFiltered = true;
    const orig = process.emitWarning.bind(process);
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      if (String(warning).includes('WASI')) return;
      (orig as (warning: string | Error, ...rest: unknown[]) => void)(warning, ...rest);
    }) as typeof process.emitWarning;
  }
  const { WASI } = await import('node:wasi');
  wasmModule ??= await WebAssembly.compile(readFileSync(resourcePath('summit-bandersnatch-cli.wasm')));
  const tmp = join(tmpdir(), `bandersnatch-${process.pid}-${Date.now()}.out`);
  const fd = openSync(tmp, 'w+', 0o600); // not world-readable while the proof is written
  try {
    const wasi = new WASI({
      version: 'preview1',
      args: ['bandersnatch', 'lite-person', entropyHex, messageHex],
      stdout: fd,
      stderr: fd,
    });
    const instance = await WebAssembly.instantiate(wasmModule, wasi.getImportObject() as WebAssembly.Imports);
    const code = wasi.start(instance);
    return parseLitePersonOutput(code, readFileSync(tmp, 'utf8').trim());
  } finally {
    closeSync(fd);
    rmSync(tmp, { force: true });
  }
}
