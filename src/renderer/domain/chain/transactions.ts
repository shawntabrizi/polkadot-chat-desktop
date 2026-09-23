/**
 * Spec 0007 client rule 3, the renderer's half: after the main process signed
 * and broadcast a dry-run, every state of the transaction goes to the peer
 * that sent the intent as a `transactionReference`, and into one row that
 * moves submitted → in block → finalized (or failed). Nothing waits for
 * finality: each state is sent when main reports it (PLAN.md "Best block
 * first").
 *
 * Lives as long as the chat manager, not a room: closing the room does not
 * stop the references.
 */

import type { DesktopChainApi, TxStatusEvent } from '../../../shared/desktop-api';
import type { HexString } from '../../app/bytes';
import type { TxReference } from '../chat/content';

export type TxRunnerDeps = {
  chain: Pick<DesktopChainApi, 'sign' | 'onTxStatus'>;
  sendReference: (peer: HexString, reference: TxReference) => Promise<void>;
};

export type TxRunRequest = {
  peer: HexString;
  dryRunId: string;
  /** The genesis hash the intent named (the reference's `chainId`). */
  chainId: string;
  /** "Top up": the intent's title, the reference's note. */
  note: string;
  /** The buttons message the intent came in. */
  intentMessageId: string;
};

export type TxRunner = {
  /** Signs the dry-run and starts the references; resolves with the hash once broadcast. */
  run: (request: TxRunRequest) => Promise<string>;
  dispose: () => void;
};

type Tracked = Omit<TxRunRequest, 'dryRunId'> & { last: TxStatusEvent['status'] | null; queue: Promise<void> };

const final = (status: TxStatusEvent['status'] | null): boolean => status === 'finalized' || status === 'failed';

export const createTxRunner = ({ chain, sendReference }: TxRunnerDeps): TxRunner => {
  const tracked = new Map<string, Tracked>();
  // Main may report "submitted" before `sign` resolves with the hash: the
  // latest event of a hash nobody claimed yet waits here.
  const early = new Map<string, TxStatusEvent>();

  const post = (entry: Tracked, event: TxStatusEvent) => {
    if (final(entry.last) || entry.last === event.status) return;
    entry.last = event.status;
    const reference: TxReference = {
      chainId: entry.chainId,
      hash: event.hash,
      status: event.status,
      block: event.block,
      note: entry.note,
      intentMessageId: entry.intentMessageId,
      error: event.error,
    };
    // In order, one after the other: the peer must see the states as they happened.
    entry.queue = entry.queue.then(() => sendReference(entry.peer, reference)).catch((cause: unknown) => console.warn('[tx] reference not sent', cause));
  };

  const stop = chain.onTxStatus(event => {
    const entry = tracked.get(event.hash.toLowerCase());
    if (entry) post(entry, event);
    else early.set(event.hash.toLowerCase(), event);
  });

  return {
    run: async ({ dryRunId, ...request }) => {
      const { hash } = await chain.sign(dryRunId);
      const key = hash.toLowerCase();
      const entry: Tracked = { ...request, last: null, queue: Promise.resolve() };
      tracked.set(key, entry);
      // "Submitted" first, always; then whatever main already reported.
      post(entry, { hash: key, status: 'submitted', block: null, error: null });
      const seen = early.get(key);
      early.delete(key);
      if (seen && seen.status !== 'submitted') post(entry, seen);
      return key;
    },
    dispose: () => {
      stop();
      tracked.clear();
      early.clear();
    },
  };
};
