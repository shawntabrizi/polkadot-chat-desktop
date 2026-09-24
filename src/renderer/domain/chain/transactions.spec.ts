/**
 * Spec 0007 client rule 3 after the M12c revision. Why it matters: every
 * reference on the wire is one Statement Store submission for the whole
 * network (docs/spec/efficiency.md); three per transaction was the old cost,
 * one is the budget. The own row must still show every state at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxStatusEvent } from '../../../shared/desktop-api';
import type { TxReference } from '../chat/content';

import { REFERENCE_PENDING_MS, createTxRunner } from './transactions';

const PEER = '0xaa';
const HASH = `0x${'ab'.repeat(32)}`;

/** A fake main process: `sign` broadcasts at once and reports "submitted" before it resolves, as assetHub.ts does. */
const fakeChain = () => {
  const listeners = new Set<(event: TxStatusEvent) => void>();
  const emit = (event: TxStatusEvent) => listeners.forEach(listener => listener(event));
  return {
    emit,
    chain: {
      sign: async () => {
        emit({ hash: HASH, status: 'submitted', block: null, error: null });
        return { hash: HASH };
      },
      onTxStatus: (listener: (event: TxStatusEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
};

const request = { peer: PEER as `0x${string}`, dryRunId: 'd', chainId: '0x01', note: 'Top up', intentMessageId: 'm1' };

const setup = () => {
  const { chain, emit } = fakeChain();
  const sent: TxReference[] = [];
  const recorded: TxReference[] = [];
  const runner = createTxRunner({
    chain,
    sendReference: async (_peer, reference) => void sent.push(reference),
    recordReference: async (_peer, reference) => void recorded.push(reference),
  });
  return { runner, emit, sent, recorded };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createTxRunner (spec 0007 references, one per transaction)', () => {
  it('sends one reference, "in block", and keeps every other state on the own row only', async () => {
    const { runner, emit, sent, recorded } = setup();
    expect(await runner.run(request)).toBe(HASH);
    await vi.advanceTimersByTimeAsync(0);
    // The row shows "submitted" at once; the peer is told nothing yet.
    expect(recorded.map(r => r.status)).toContain('submitted');
    expect(sent).toEqual([]);

    emit({ hash: HASH, status: 'inBlock', block: 7, error: null });
    emit({ hash: HASH, status: 'inBlock', block: 7, error: null });
    emit({ hash: HASH, status: 'finalized', block: 7, error: null });
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS * 2);
    expect(sent.map(r => [r.status, r.block])).toEqual([['inBlock', 7]]);
    expect(sent[0]).toMatchObject({ note: 'Top up', intentMessageId: 'm1', chainId: '0x01' });
    // Finality reached the row without a message.
    expect(recorded.at(-1)).toMatchObject({ status: 'finalized', block: 7 });
  });

  it('sends "failed" as the one reference, and nothing after it', async () => {
    const { runner, emit, sent } = setup();
    await runner.run(request);
    emit({ hash: HASH, status: 'failed', block: 7, error: 'not enough funds' });
    emit({ hash: HASH, status: 'finalized', block: 7, error: null });
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS * 2);
    expect(sent.map(r => r.status)).toEqual(['failed']);
    expect(sent[0]?.error).toBe('not enough funds');
  });

  it('sends "submitted" only when no block took it in 30 s, then the end state', async () => {
    const { runner, emit, sent } = setup();
    await runner.run(request);
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map(r => r.status)).toEqual(['submitted']);
    emit({ hash: HASH, status: 'inBlock', block: 9, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map(r => r.status)).toEqual(['submitted', 'inBlock']);
  });

  // M14: in a group every reference is a statement on the group topic that every member
  // downloads; the brief's budget is one per transaction, so a slow block must not add a second.
  it('in a group, sends the end state only: no "submitted" after 30 s', async () => {
    const { runner, emit, sent, recorded } = setup();
    await runner.run({ ...request, peer: 'group:g-1' });
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS * 2);
    expect(sent).toEqual([]);
    // The own row still shows the state at once.
    expect(recorded.at(-1)?.status).toBe('submitted');
    emit({ hash: HASH, status: 'inBlock', block: 9, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map(r => [r.status, r.intentMessageId])).toEqual([['inBlock', 'm1']]);
  });

  it('never puts "finalized" on the wire, even when it is the first state it hears', async () => {
    const { runner, emit, sent, recorded } = setup();
    await runner.run(request);
    emit({ hash: HASH, status: 'finalized', block: 5, error: null });
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS);
    expect(sent.map(r => r.status)).toEqual(['inBlock']);
    expect(recorded.at(-1)?.status).toBe('finalized');
  });

  it('ignores transactions it did not start', async () => {
    const { emit, sent, recorded } = setup();
    emit({ hash: `0x${'cd'.repeat(32)}`, status: 'inBlock', block: 1, error: null });
    await vi.advanceTimersByTimeAsync(REFERENCE_PENDING_MS);
    expect(sent).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
