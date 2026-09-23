/**
 * People-chain read helpers shared by the main process (sign-up) and the
 * renderer (peer lookup). PLAN.md "Best block first": every read and every
 * wait uses the best block; finality is only reported.
 *
 * Browser-safe: no Node imports.
 */

import { type Observable, firstValueFrom } from 'rxjs';

/** The node answers with a best block (a dead endpoint fails fast). */
export const CONNECT_TIMEOUT_MS = 12_000;
/** A cache miss downloads the runtime metadata; public nodes take up to a minute. */
export const METADATA_TIMEOUT_MS = 90_000;
/** One storage read once the runtime is loaded. */
export const READ_TIMEOUT_MS = 15_000;

export type TimeoutError = Error & { timeout: true };

export const isTimeoutError = (error: unknown): error is TimeoutError =>
  error instanceof Error && (error as Partial<TimeoutError>).timeout === true;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  // Observe the original promise so a late rejection does not go unhandled.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`) as TimeoutError;
      error.timeout = true;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/** The part of a polkadot-api client the readiness wait needs. */
export type RuntimeClient = {
  bestBlocks$: Observable<readonly { hash: string; number: number }[]>;
  getMetadata: (hash: string) => Promise<Uint8Array>;
};

/**
 * Waits until the client can serve reads at the best block: the first
 * `bestBlocks$` emission (not the finalized block), then that block's runtime
 * metadata (from the disk cache when it has the runtime). A read's own
 * deadline then never covers the metadata download.
 */
export async function awaitBestRuntime(
  client: RuntimeClient,
  { connectMs = CONNECT_TIMEOUT_MS, metadataMs = METADATA_TIMEOUT_MS }: { connectMs?: number; metadataMs?: number } = {},
): Promise<{ hash: string; number: number }> {
  const blocks = await withTimeout(firstValueFrom(client.bestBlocks$), connectMs, 'chain connect');
  const best = blocks[0];
  if (!best) throw new Error('the node reported no best block');
  await withTimeout(client.getMetadata(best.hash), metadataMs, 'runtime metadata');
  return best;
}

/**
 * Runs `read`; when it times out, moves the connection to the next endpoint
 * of the profile and runs it once more. Other errors are not retried: a
 * slow node is the failure this covers, not a bad request.
 */
export async function retryOnNextEndpoint<T>(read: () => Promise<T>, switchEndpoint: () => void): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    switchEndpoint();
    return read();
  }
}
