/**
 * Spec 0007 revision 2026-09-23: a peer sends one `transactionReference` per
 * transaction and never "finalized", so every client follows a reference's
 * transaction on the chain itself, by hash and block:
 *
 * - no block known (status 0): each new best block is searched for the
 *   extrinsic hash; found → "in block" at that number;
 * - block N known: when the finalized head reaches N, the canonical block N
 *   is read; if it holds the extrinsic → "finalized". If it does not, the
 *   block was not the one that got finalized: the search goes on.
 *
 * Nothing here blocks on finality (PLAN.md "Best block first"): the states
 * are events, emitted as the chain moves. Legacy `chain_getBlockHash` and
 * `chain_getBlock` are used because they serve any block, pinned or not.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import type { Observable, Subscription } from 'rxjs';

import type { TxStatusEvent } from '../../shared/desktop-api';

/** A hash no block took in this long is no longer searched (the row keeps its state). */
export const TRACK_PENDING_MS = 10 * 60_000;
/** Best blocks already searched, remembered so a block is read once. */
const SCANNED_LIMIT = 512;

export type TrackerChain = {
  /** Best block first, the finalized block last (polkadot-api `bestBlocks$`). */
  bestBlocks$: Observable<readonly { hash: string; number: number }[]>;
  finalizedBlock$: Observable<{ hash: string; number: number }>;
  /** The canonical block hash at `number` (null when the node has none). */
  blockHashAt: (number: number) => Promise<string | null>;
  /** The 0x-hex extrinsics of a block, as the node encodes them (with the length prefix). */
  extrinsicsOf: (blockHash: string) => Promise<readonly string[]>;
};

export type TxTracker = {
  /** Follow `hash`; `block` is where a reference says it is (null: not known yet). */
  track: (hash: string, block: number | null) => void;
  dispose: () => void;
};

type Entry = { block: number | null; since: number; checking: boolean };

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
/** The extrinsic hash: blake2b-256 of the encoded extrinsic, as the chain and wallets compute it. */
export const extrinsicHash = (extrinsicHex: string): string => `0x${Buffer.from(blake2b(hexBytes(extrinsicHex), { dkLen: 32 })).toString('hex')}`;

export const createTxTracker = (chain: TrackerChain, emit: (event: TxStatusEvent) => void, now: () => number = Date.now): TxTracker => {
  const entries = new Map<string, Entry>();
  const scanned = new Set<string>();
  let finalized = -1;
  let scanning = false;
  let disposed = false;

  const warn = (what: string, cause: unknown) => console.warn(`[tx-tracker] ${what}`, cause instanceof Error ? cause.message : cause);

  const checkFinal = async (hash: string, entry: Entry): Promise<void> => {
    if (entry.block === null || entry.block > finalized || entry.checking) return;
    entry.checking = true;
    try {
      const blockHash = await chain.blockHashAt(entry.block);
      const found = blockHash ? (await chain.extrinsicsOf(blockHash)).some(extrinsic => extrinsicHash(extrinsic) === hash) : false;
      if (disposed || entries.get(hash) !== entry) return;
      if (found) {
        entries.delete(hash);
        emit({ hash, status: 'finalized', block: entry.block, error: null });
      } else {
        // Not in the finalized block N: search the best blocks again.
        entry.block = null;
        entry.since = now();
      }
    } catch (cause) {
      warn('finality check failed', cause);
    } finally {
      entry.checking = false;
    }
  };

  const scan = async (blocks: readonly { hash: string; number: number }[]): Promise<void> => {
    if (scanning) return;
    const searching = () => [...entries].filter(([, entry]) => entry.block === null);
    for (const [hash, entry] of searching()) if (now() - entry.since > TRACK_PENDING_MS) entries.delete(hash);
    if (searching().length === 0) return;
    scanning = true;
    try {
      // Oldest first, so the lowest block that holds it is the one reported.
      for (const block of [...blocks].reverse()) {
        if (scanned.has(block.hash)) continue;
        const hashes = new Set((await chain.extrinsicsOf(block.hash)).map(extrinsicHash));
        if (disposed) return;
        scanned.add(block.hash);
        if (scanned.size > SCANNED_LIMIT) scanned.delete(scanned.values().next().value as string);
        for (const [hash, entry] of searching()) {
          if (!hashes.has(hash)) continue;
          entry.block = block.number;
          emit({ hash, status: 'inBlock', block: block.number, error: null });
          void checkFinal(hash, entry);
        }
      }
    } catch (cause) {
      warn('block search failed', cause);
    } finally {
      scanning = false;
    }
  };

  const subscriptions: Subscription[] = [
    chain.bestBlocks$.subscribe({ next: blocks => void scan(blocks), error: cause => warn('best blocks stopped', cause) }),
    chain.finalizedBlock$.subscribe({
      next: block => {
        finalized = Math.max(finalized, block.number);
        for (const [hash, entry] of entries) void checkFinal(hash, entry);
      },
      error: cause => warn('finalized blocks stopped', cause),
    }),
  ];

  return {
    track: (rawHash, block) => {
      const hash = rawHash.toLowerCase();
      const existing = entries.get(hash);
      if (existing) {
        if (existing.block === null && block !== null) existing.block = block;
        void checkFinal(hash, existing);
        return;
      }
      const entry: Entry = { block, since: now(), checking: false };
      entries.set(hash, entry);
      void checkFinal(hash, entry);
    },
    dispose: () => {
      disposed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      entries.clear();
    },
  };
};
