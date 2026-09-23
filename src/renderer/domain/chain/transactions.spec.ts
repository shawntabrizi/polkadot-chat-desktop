import { describe, expect, it } from 'vitest';

import type { TxStatusEvent } from '../../../shared/desktop-api';
import type { TxReference } from '../chat/content';

import { createTxRunner } from './transactions';

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

describe('createTxRunner (spec 0007 references)', () => {
  it('tells the peer each state once, in order, as main reports it, without waiting for finality', async () => {
    const { chain, emit } = fakeChain();
    const sent: TxReference[] = [];
    const runner = createTxRunner({ chain, sendReference: async (_peer, reference) => void sent.push(reference) });
    expect(await runner.run(request)).toBe(HASH);
    await Promise.resolve();
    // "Submitted" goes out before any block: the UI does not wait for the chain.
    expect(sent.map(r => r.status)).toEqual(['submitted']);
    emit({ hash: HASH, status: 'inBlock', block: 7, error: null });
    emit({ hash: HASH, status: 'inBlock', block: 7, error: null });
    emit({ hash: HASH, status: 'finalized', block: 7, error: null });
    await new Promise(done => setTimeout(done, 0));
    expect(sent.map(r => [r.status, r.block])).toEqual([
      ['submitted', null],
      ['inBlock', 7],
      ['finalized', 7],
    ]);
    expect(sent[1]).toMatchObject({ note: 'Top up', intentMessageId: 'm1', chainId: '0x01' });
  });

  it('sends nothing after a final state (a late event cannot undo "failed")', async () => {
    const { chain, emit } = fakeChain();
    const sent: TxReference[] = [];
    const runner = createTxRunner({ chain, sendReference: async (_peer, reference) => void sent.push(reference) });
    await runner.run(request);
    emit({ hash: HASH, status: 'failed', block: 7, error: 'not enough funds' });
    emit({ hash: HASH, status: 'finalized', block: 7, error: null });
    await new Promise(done => setTimeout(done, 0));
    expect(sent.map(r => r.status)).toEqual(['submitted', 'failed']);
    expect(sent[1]?.error).toBe('not enough funds');
  });

  it('ignores transactions it did not start', async () => {
    const { chain, emit } = fakeChain();
    const sent: TxReference[] = [];
    createTxRunner({ chain, sendReference: async (_peer, reference) => void sent.push(reference) });
    emit({ hash: `0x${'cd'.repeat(32)}`, status: 'inBlock', block: 1, error: null });
    await new Promise(done => setTimeout(done, 0));
    expect(sent).toEqual([]);
  });
});
