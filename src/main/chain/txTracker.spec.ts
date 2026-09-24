/**
 * Why: since M12c a peer never sends "finalized" and may send only
 * "submitted", so a reference bubble is right only if this client reads the
 * chain itself. A bubble must not turn "finalized" for a block that did not
 * hold the transaction, and a pending one must turn "in block" when it lands.
 */

import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { TxStatusEvent } from '../../shared/desktop-api';

import { createTxTracker, extrinsicHash } from './txTracker';

const EXTRINSIC = '0x1234';
const OTHER = '0x5678';
const HASH = extrinsicHash(EXTRINSIC);

const fakeChain = (canonical: Record<number, string>, bodies: Record<string, string[]>) => {
  const best = new Subject<{ hash: string; number: number }[]>();
  const finalized = new Subject<{ hash: string; number: number }>();
  return {
    best,
    finalized,
    chain: {
      bestBlocks$: best,
      finalizedBlock$: finalized,
      blockHashAt: async (number: number) => canonical[number] ?? null,
      extrinsicsOf: async (hash: string) => bodies[hash] ?? [],
    },
  };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createTxTracker', () => {
  it('computes the extrinsic hash as the chain does (blake2b-256 of the encoded extrinsic)', () => {
    // Asset Hub Paseo block #13622982, extrinsic 2 (chain_getBlock): the M12 faucet drip, whose
    // hash main reported when it was broadcast (docs/acceptance.md "## M12").
    const drip =
      '0x59028400d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d011a74b45bdf3e385faca2ff95bf7b870fbdeb6a044a23c77bab7cb5e77c85c662b3739efa6bb534afb65f867df77637e182c5cc635a06a96c4634df26ae72968a0000008503b9800000000a03008a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b0700e40b5402';
    expect(extrinsicHash(drip)).toBe('0xa7cc3ec67cb09c846a33ec1ccf7a511f631873b9dcc505a993c9fcdc86af6dc5');
  });

  it('marks a reference finalized once the finalized head passes its block and that block holds it', async () => {
    const { chain, finalized } = fakeChain({ 7: '0xb7' }, { '0xb7': [OTHER, EXTRINSIC] });
    const events: TxStatusEvent[] = [];
    const tracker = createTxTracker(chain, event => events.push(event));
    tracker.track(HASH, 7);
    finalized.next({ hash: '0xb6', number: 6 });
    await settle();
    expect(events).toEqual([]);
    finalized.next({ hash: '0xb8', number: 8 });
    await settle();
    expect(events).toEqual([{ hash: HASH, status: 'finalized', block: 7, error: null }]);
    tracker.dispose();
  });

  it('does not mark it finalized when the finalized block at that number does not hold it', async () => {
    const { chain, finalized } = fakeChain({ 7: '0xb7' }, { '0xb7': [OTHER] });
    const events: TxStatusEvent[] = [];
    const tracker = createTxTracker(chain, event => events.push(event));
    tracker.track(HASH, 7);
    finalized.next({ hash: '0xb9', number: 9 });
    await settle();
    expect(events).toEqual([]);
    tracker.dispose();
  });

  it('finds a pending reference in a new best block, then follows it to finality', async () => {
    const { chain, best, finalized } = fakeChain({ 11: '0xc11' }, { '0xc10': [OTHER], '0xc11': [EXTRINSIC] });
    const events: TxStatusEvent[] = [];
    const tracker = createTxTracker(chain, event => events.push(event));
    tracker.track(HASH, null);
    best.next([{ hash: '0xc10', number: 10 }]);
    await settle();
    expect(events).toEqual([]);
    best.next([
      { hash: '0xc11', number: 11 },
      { hash: '0xc10', number: 10 },
    ]);
    await settle();
    expect(events).toEqual([{ hash: HASH, status: 'inBlock', block: 11, error: null }]);
    finalized.next({ hash: '0xc11', number: 11 });
    await settle();
    expect(events.at(-1)).toEqual({ hash: HASH, status: 'finalized', block: 11, error: null });
    tracker.dispose();
  });
});
