/**
 * A minimal WASI preview1 host for one command-line wasm run in the browser
 * (M22a): `resources/summit-bandersnatch-cli.wasm` imports only these eight
 * functions. No file system, no environment, no clock. stdout and stderr go
 * to one buffer, as the desktop runner (main/identity/litePerson.ts) writes
 * both to one file.
 */

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

/** `proc_exit` unwinds the wasm stack with this. */
class WasiExit {
  constructor(readonly code: number) {}
}

export type WasiRun = { code: number; output: string };

/** Runs `_start` of `module` with `args` (args[0] is the program name) to its end. */
export const runWasiCommand = async (module: WebAssembly.Module, args: readonly string[]): Promise<WasiRun> => {
  let memory: WebAssembly.Memory | null = null;
  const view = (): DataView => {
    if (!memory) throw new Error('wasm memory is not ready');
    return new DataView(memory.buffer);
  };
  const bytes = (): Uint8Array<ArrayBuffer> => {
    if (!memory) throw new Error('wasm memory is not ready');
    // This module's memory is not shared.
    return new Uint8Array(memory.buffer as ArrayBuffer);
  };
  const encoded = args.map(arg => new TextEncoder().encode(`${arg}\0`));
  const output: Uint8Array[] = [];

  const imports = {
    wasi_snapshot_preview1: {
      args_sizes_get: (argcPtr: number, bufSizePtr: number): number => {
        view().setUint32(argcPtr, encoded.length, true);
        view().setUint32(bufSizePtr, encoded.reduce((total, arg) => total + arg.length, 0), true);
        return ERRNO_SUCCESS;
      },
      args_get: (argvPtr: number, bufPtr: number): number => {
        let offset = bufPtr;
        encoded.forEach((arg, index) => {
          view().setUint32(argvPtr + index * 4, offset, true);
          bytes().set(arg, offset);
          offset += arg.length;
        });
        return ERRNO_SUCCESS;
      },
      environ_sizes_get: (countPtr: number, bufSizePtr: number): number => {
        view().setUint32(countPtr, 0, true);
        view().setUint32(bufSizePtr, 0, true);
        return ERRNO_SUCCESS;
      },
      environ_get: (): number => ERRNO_SUCCESS,
      random_get: (bufPtr: number, length: number): number => {
        // getRandomValues fills at most 65536 bytes per call.
        for (let offset = 0; offset < length; offset += 65_536) {
          crypto.getRandomValues(bytes().subarray(bufPtr + offset, bufPtr + Math.min(length, offset + 65_536)));
        }
        return ERRNO_SUCCESS;
      },
      fd_write: (fd: number, iovsPtr: number, iovsLength: number, writtenPtr: number): number => {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        let written = 0;
        for (let index = 0; index < iovsLength; index += 1) {
          const pointer = view().getUint32(iovsPtr + index * 8, true);
          const length = view().getUint32(iovsPtr + index * 8 + 4, true);
          output.push(bytes().slice(pointer, pointer + length));
          written += length;
        }
        view().setUint32(writtenPtr, written, true);
        return ERRNO_SUCCESS;
      },
      proc_exit: (code: number): never => {
        throw new WasiExit(code);
      },
      sched_yield: (): number => ERRNO_SUCCESS,
    },
  };

  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory as WebAssembly.Memory;
  let code = 0;
  try {
    (instance.exports._start as () => void)();
  } catch (cause) {
    if (!(cause instanceof WasiExit)) throw cause;
    code = cause.code;
  }
  const total = output.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of output) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return { code, output: new TextDecoder().decode(joined) };
};
