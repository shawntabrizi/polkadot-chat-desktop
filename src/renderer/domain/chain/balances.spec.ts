import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { readPeopleFree } from './balances';

describe('readPeopleFree', () => {
  // PLAN.md "Best block first": a balance read at the finalized block lags
  // the chip and the Pocket by a few blocks after every transfer.
  it('reads System.Account of the address at the best block', async () => {
    const getValue = vi.fn(async () => ({ data: { free: 42n } }));
    const client = {
      bestBlocks$: of([{ hash: '0x01', number: 1 }]),
      getMetadata: async () => new Uint8Array(),
      getUnsafeApi: () => ({ query: { System: { Account: { getValue } } } }),
    };
    const connection = { lazyClient: { getClient: () => client }, switchEndpoint: () => undefined } as never;
    expect(await readPeopleFree(connection, '5Grw')).toBe(42n);
    expect(getValue).toHaveBeenCalledWith('5Grw', { at: 'best' });
  });
});
