/**
 * M12g, the main process's half of payments. Why: the main process is the
 * last guard before a signature (the renderer shows remote content), so the
 * over-balance refusal lives here; and "Paid" on a request rests on what
 * `balanceTransfers` reads from the block, so it must read only the paying
 * extrinsic's own transfers.
 */

import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { describe, expect, it } from 'vitest';

import { type ChainEvent, balanceProblem, balanceTransfers } from './assetHub';

const PAS = 10_000_000_000n;
const ED = PAS / 100n;
const FEE = PAS / 1000n;

describe('balanceProblem: never more than the balance less the fee and the existential deposit', () => {
  it('lets a send through when amount + fee + existential deposit fit exactly', () => {
    expect(balanceProblem(PAS + FEE + ED, FEE, PAS, ED)).toBeNull();
  });

  it('refuses one planck more, and says what could still be sent', () => {
    expect(balanceProblem(PAS + FEE + ED - 1n, FEE, PAS, ED)).toBe('Not enough PAS: 0.9999 available after fees.');
  });

  it('refuses a send of the whole balance: keep-alive must leave the deposit, and the fee is paid too', () => {
    expect(balanceProblem((PAS * 4n) / 10n + FEE + ED, FEE, PAS, ED)).toBe('Not enough PAS: 0.4 available after fees.');
  });

  it('never shows a negative amount', () => {
    expect(balanceProblem(0n, FEE, PAS, ED)).toBe('Not enough PAS: 0 available after fees.');
  });
});

describe('balanceTransfers: the paying extrinsic only', () => {
  const alice = new Uint8Array(32).fill(1);
  const bob = new Uint8Array(32).fill(2);
  const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;
  const transferEvent = (index: number, from: Uint8Array, to: Uint8Array, amount: bigint): ChainEvent => ({
    phase: { type: 'ApplyExtrinsic', value: index },
    event: { type: 'Balances', value: { type: 'Transfer', value: { from: ss58Address(from, 0), to: ss58Address(to, 0), amount } } },
  });

  it('reads the transfer of that extrinsic, accounts as hex whatever the address prefix', () => {
    const events: ChainEvent[] = [
      { phase: { type: 'ApplyExtrinsic', value: 2 }, event: { type: 'Balances', value: { type: 'Withdraw', value: { who: ss58Address(bob, 42), amount: 1n } } } },
      transferEvent(2, bob, alice, PAS),
    ];
    expect(balanceTransfers(events, 2)).toEqual([{ from: hex(bob), to: hex(alice), amount: String(PAS) }]);
  });

  it('does not count a transfer of another extrinsic in the same block', () => {
    expect(balanceTransfers([transferEvent(3, bob, alice, PAS)], 2)).toEqual([]);
    expect(balanceTransfers([{ ...transferEvent(2, bob, alice, PAS), phase: { type: 'Finalization' } }], 2)).toEqual([]);
  });
});
