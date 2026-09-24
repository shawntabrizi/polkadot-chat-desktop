/**
 * Spec 0007 client rule 3, the renderer's half: after the main process
 * signed and broadcast a dry-run, the peer that sent the intent gets ONE
 * `transactionReference` (revision 2026-09-23, docs/spec/efficiency.md):
 * status 1 when a best block holds the transaction, or 3 when it failed.
 * Status 0 goes out only when no block took it in 30 s; the in-block or
 * failed state then follows, as pca's bots do, so the peer's bubble does not
 * stay pending. Status 2 (finalized) is never sent: every client follows
 * finality from the chain (`finality.ts`).
 *
 * The own row exists from the moment of signing (local, "submitted") and
 * takes every state locally; only the posts above go on the wire. Nothing
 * waits for finality (PLAN.md "Best block first").
 *
 * In a group (M14) the peer is the group: the reference goes on the group
 * topic as content, and only the end state goes out, never the 30 s status 0,
 * so a transaction costs the group's topic exactly one statement.
 *
 * Lives as long as the chat manager, not a room: closing the room does not
 * stop the reference.
 */

import type { DesktopChainApi, TxStatusEvent } from '../../../shared/desktop-api';
import type { TxDisplay } from '../../../shared/txIntent';
import { isGroupPeer } from '../../app/database';
import type { TxReference } from '../chat/content';
import type { ChatTargetId } from '../chat/manager';

/** A reference's note: "Top up (1 PAS)", what it was and how much (spec 0007 `note`). */
export const referenceNote = (display: TxDisplay): string =>
  display.amount ? `${display.title} (${display.amount}${display.asset ? ` ${display.asset}` : ''})` : display.title;

/** A transaction no block took in this long is reported as submitted (status 0). */
export const REFERENCE_PENDING_MS = 30_000;

export type TxRunnerDeps = {
  chain: Pick<DesktopChainApi, 'sign' | 'onTxStatus'>;
  /** Puts the reference on the wire (and on the own row). */
  sendReference: (peer: ChatTargetId, reference: TxReference) => Promise<void>;
  /** The own row only; nothing is sent. */
  recordReference: (peer: ChatTargetId, reference: TxReference) => Promise<void>;
  timers?: { set: (run: VoidFunction, ms: number) => ReturnType<typeof setTimeout>; clear: (timer: ReturnType<typeof setTimeout>) => void };
};

export type TxRunRequest = {
  /** The contact that sent the intent, or the group it was posted in (M14). */
  peer: ChatTargetId;
  dryRunId: string;
  /** The genesis hash the intent named (the reference's `chainId`). */
  chainId: string;
  /** "Top up": the intent's title, the reference's note. */
  note: string;
  /** The buttons message the intent came in; null for a transfer this client started (M12g Send). */
  intentMessageId: string | null;
};

export type TxRunner = {
  /** Signs the dry-run and starts the reference; resolves with the hash once broadcast. */
  run: (request: TxRunRequest) => Promise<string>;
  dispose: () => void;
};

type Tracked = Omit<TxRunRequest, 'dryRunId'> & {
  hash: string;
  /** The peer knows the end state (in block or failed). */
  told: boolean;
  /** Status 0 went out: the end state still follows. */
  toldPending: boolean;
  ended: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  queue: Promise<void>;
};

const realTimers = { set: (run: VoidFunction, ms: number) => setTimeout(run, ms), clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) };

export const createTxRunner = ({ chain, sendReference, recordReference, timers = realTimers }: TxRunnerDeps): TxRunner => {
  const tracked = new Map<string, Tracked>();
  // Main may report states before `sign` resolves with the hash: the events
  // of a hash nobody claimed yet wait here, in order.
  const early = new Map<string, TxStatusEvent[]>();

  const referenceOf = (entry: Tracked, event: Pick<TxStatusEvent, 'status' | 'block' | 'error'>): TxReference => ({
    chainId: entry.chainId,
    hash: entry.hash,
    status: event.status,
    block: event.block,
    note: entry.note,
    intentMessageId: entry.intentMessageId,
    error: event.error,
  });

  // In order, one after the other: the row and the peer see the states as they happened.
  const enqueue = (entry: Tracked, work: () => Promise<void>) => {
    entry.queue = entry.queue.then(work).catch((cause: unknown) => console.warn('[tx] reference not sent', cause));
  };

  const stopTimer = (entry: Tracked) => {
    if (entry.timer !== null) timers.clear(entry.timer);
    entry.timer = null;
  };

  const onEvent = (entry: Tracked, event: TxStatusEvent) => {
    if (entry.ended) return;
    const done = event.status === 'inBlock' || event.status === 'finalized' || event.status === 'failed';
    if (event.status === 'finalized' || event.status === 'failed') entry.ended = true;
    if (!done) {
      // A reorg put it back to pending: the row shows it; the peer follows the chain.
      enqueue(entry, () => recordReference(entry.peer, referenceOf(entry, event)));
      return;
    }
    stopTimer(entry);
    if (entry.told) {
      enqueue(entry, () => recordReference(entry.peer, referenceOf(entry, event)));
      return;
    }
    entry.told = true;
    // Never status 2 on the wire: a first event that is already final is sent as "in block".
    const wire = event.status === 'finalized' ? { ...event, status: 'inBlock' as const } : event;
    enqueue(entry, () => sendReference(entry.peer, referenceOf(entry, wire)));
    if (event.status === 'finalized') enqueue(entry, () => recordReference(entry.peer, referenceOf(entry, event)));
  };

  const stop = chain.onTxStatus(event => {
    const key = event.hash.toLowerCase();
    const entry = tracked.get(key);
    if (entry) onEvent(entry, event);
    else early.set(key, [...(early.get(key) ?? []), event]);
  });

  return {
    run: async ({ dryRunId, ...request }) => {
      const { hash } = await chain.sign(dryRunId);
      const key = hash.toLowerCase();
      const entry: Tracked = { ...request, hash: key, told: false, toldPending: false, ended: false, timer: null, queue: Promise.resolve() };
      tracked.set(key, entry);
      // The row first, at once: the UI never waits for the chain.
      enqueue(entry, () => recordReference(entry.peer, referenceOf(entry, { status: 'submitted', block: null, error: null })));
      // A group hears the end state only: one statement per transaction on its topic (M14).
      if (!isGroupPeer(entry.peer)) entry.timer = timers.set(() => {
        entry.timer = null;
        if (entry.told || entry.toldPending) return;
        entry.toldPending = true;
        enqueue(entry, () => sendReference(entry.peer, referenceOf(entry, { status: 'submitted', block: null, error: null })));
      }, REFERENCE_PENDING_MS);
      for (const event of early.get(key) ?? []) onEvent(entry, event);
      early.delete(key);
      return key;
    },
    dispose: () => {
      stop();
      for (const entry of tracked.values()) stopTimer(entry);
      tracked.clear();
      early.clear();
    },
  };
};
