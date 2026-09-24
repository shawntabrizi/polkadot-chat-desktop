// Test funds for the e2e scripts (owner ruling 2026-09-24: the pca faucet bot
// is retired). The same transfer as the app's embedded Faucet
// (src/main/chain/faucet.ts `dripDevnet`): devnet Asset Hub only, the first
// public dev account (//Alice, then //Bob … //Ferdie) that holds the amount
// plus the margin, a dry-run of `Balances.transfer_keep_alive`, then sign and
// submit. It waits for the first best block with the transfer; never for finality.

import type { AssetHubChain } from '../../src/main/chain/assetHub';
import { dripDevnet } from '../../src/main/chain/faucet';
import type { TxStatusEvent } from '../../src/shared/desktop-api';

/** A best block with the transfer, else the drip counts as lost. */
const IN_BLOCK_WAIT_MS = 90_000;
/** Two processes that drip at once pick the same account and nonce: the pool refuses one. */
const ATTEMPTS = 3;
const PLANCK_PER_PAS = 10_000_000_000;

export type Funded = { from: string; hash: string; block: number; attempt: number };

const delay = (ms: number) => new Promise(done => setTimeout(done, ms));

/** One drip; resolves at the first best block that holds it. */
const fundOnce = (chain: AssetHubChain, to: Uint8Array, value: bigint): Promise<Omit<Funded, 'attempt'>> =>
  new Promise((resolve, reject) => {
    let from = '';
    let done = false;
    const timer = setTimeout(() => end(new Error(`no best block with the transfer in ${IN_BLOCK_WAIT_MS / 1000} s`)), IN_BLOCK_WAIT_MS);
    const end = (error: Error | null, result?: Omit<Funded, 'attempt'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const onStatus = (event: TxStatusEvent) => {
      if (event.status === 'failed') end(new Error(`The transfer failed: ${event.error ?? 'no reason'}`));
      // `from` is set once broadcast; the in-block status can come after that only.
      else if (event.status === 'inBlock' && event.block !== null) setImmediate(() => end(null, { from, hash: event.hash, block: event.block! }));
    };
    dripDevnet(chain, chain.genesis, to, onStatus, value).then(
      drip => {
        from = drip.from;
      },
      (error: unknown) => end(error instanceof Error ? error : new Error(String(error))),
    );
  });

/**
 * Sends `amountPas` PAS to `to` (32-byte account) on the script's devnet Asset
 * Hub connection. A refused or failed submission (the nonce race) is tried
 * again after a random pause; any other error (no source, a failed dry-run,
 * no best block in time) is thrown at once.
 */
export async function fund(chain: AssetHubChain, to: Uint8Array, amountPas: number): Promise<Funded> {
  const value = BigInt(Math.round(amountPas * PLANCK_PER_PAS));
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...(await fundOnce(chain, to, value)), attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= ATTEMPTS || !/not accepted|failed/.test(message)) throw error;
      await delay(4_000 + Math.random() * 8_000);
    }
  }
}
