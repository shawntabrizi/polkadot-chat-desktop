/**
 * M12g, the main process's half of payments. Why: the main process is the
 * last guard before a signature (the renderer shows remote content), so the
 * over-balance refusal lives here; and "Paid" on a request rests on what
 * `balanceTransfers` reads from the block, so it must read only the paying
 * extrinsic's own transfers. And the limits of a Revive call: the signer
 * never signs below the author's worst case, nor below what the chain needs now.
 */

import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { describe, expect, it } from 'vitest';

import { type ChainEvent, DEPOSIT_FLOOR, balanceProblem, balanceTransfers, gasFactor, reviveLimits } from './assetHub';

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

describe('reviveLimits: per field, the larger of the intent limit and the estimate + 20 % (spec 0007, 2026-09-24)', () => {
  const noLimits = { gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined };
  const estimate = { refTime: 1_000_000_000n, proofSize: 100_000n, deposit: 50_000_000n };
  const ownMargin = { refTime: 1_200_000_001n, proofSize: 120_001n, deposit: 60_000_001n };

  it('0.1 PAS is the deposit floor (PAS has 10 decimals)', () => {
    expect(DEPOSIT_FLOOR).toBe(PAS / 10n);
  });

  it('signs with the intent limits when they are larger: the author sized the worst contract path, the dry-run only one', () => {
    const intent = { gasRefTime: 3_000_000_000n, gasProofSize: 300_000n, storageDepositLimit: 2_000_000_000n };
    expect(reviveLimits(intent, estimate)).toEqual({ refTime: 3_000_000_000n, proofSize: 300_000n, deposit: 2_000_000_000n });
  });

  it('signs with the estimate + margin when the intent limits are smaller: a stale or low intent must not fail a call the chain can run now', () => {
    const intent = { gasRefTime: 10n, gasProofSize: 10n, storageDepositLimit: 10n };
    expect(reviveLimits(intent, estimate)).toEqual(ownMargin);
  });

  it('floors the deposit of an intent without limits at estimate + 0.1 PAS, and keeps gas at estimate + 20 %', () => {
    expect(reviveLimits(noLimits, estimate)).toEqual({ ...ownMargin, deposit: estimate.deposit + DEPOSIT_FLOOR });
    // The flip race: a settling stake dry-runs with a refund (deposit 0) but may run as a first stake.
    expect(reviveLimits(noLimits, { ...estimate, deposit: 0n }).deposit).toBe(DEPOSIT_FLOOR);
  });

  it('keeps estimate + 20 % for a deposit so large that 20 % exceeds 0.1 PAS', () => {
    expect(reviveLimits(noLimits, { ...estimate, deposit: PAS }).deposit).toBe(PAS + PAS / 5n + 1n);
  });

  it('passes the flip stake intent of pca 8d0b959 through unchanged when the estimate is lower (dry-run on the settling path)', () => {
    const flip = { gasRefTime: 2_272_954_276n, gasProofSize: 156_861n, storageDepositLimit: 1_052_800_000n };
    const settlingPath = { refTime: 1_000_000_000n, proofSize: 100_000n, deposit: 0n };
    expect(reviveLimits(flip, settlingPath)).toEqual({ refTime: 2_272_954_276n, proofSize: 156_861n, deposit: 1_052_800_000n });
  });
});

describe('gasFactor: the caps line shows the signed gas over the estimate', () => {
  it('rounds to one decimal and drops a trailing .0', () => {
    expect(gasFactor(1_500_000_000n, 1_000_000_000n)).toBe('1.5');
    expect(gasFactor(2_000_000_000n, 1_000_000_000n)).toBe('2');
    expect(gasFactor(1_200_000_001n, 1_000_000_000n)).toBe('1.2');
  });

  it('never divides by a zero estimate', () => {
    expect(gasFactor(5n, 0n)).toBe('1');
  });
});
