import { describe, expect, it } from 'vitest';

import { type BalanceHint, decodeUint256, formatPas, headerParts, hintCalldata, hintLine, pendingOf, planckInHintUnits, repliesFor, reviveAddressOf, spendable } from './balanceHint';

const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;
const bytes = (value: string) => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));

/** The hint pcdmeter declares for the Meter (docs/spec/contracts/meter.md). */
const meter: BalanceHint = {
  chainId: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
  contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
  selector: '0x70a08231',
  decimals: 18,
  unit: 'PAS',
  perReply: '100000000000000000',
  label: 'with Meter',
};

describe('balance hint reads (spec 0008 v2)', () => {
  // A wrong address reads someone else's balance, or none: these are the
  // values meter.md and the live chain gave on 2026-09-23.
  it('maps an AccountId32 to the H160 pallet-revive uses (ReviveApi_address)', () => {
    const alice = bytes('0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d');
    expect(hex(reviveAddressOf(alice))).toBe('0x9621dde636de098b43efb0fa9b61facfe328f99d');
    // The e2e identity; ReviveApi_address answered this at the best block.
    expect(hex(reviveAddressOf(bytes('0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653')))).toBe('0x469a4447be834da00d85582ce51c33fb132a553b');
    const eth = new Uint8Array([...new Uint8Array(20).fill(7), ...new Uint8Array(12).fill(0xee)]);
    expect(reviveAddressOf(eth)).toEqual(new Uint8Array(20).fill(7));
  });

  it('builds `selector(caller)` calldata: the balanceOf example of meter.md, byte for byte', () => {
    expect(hex(hintCalldata(meter.selector, bytes('0x9621dde636de098b43efb0fa9b61facfe328f99d')))).toBe(
      '0x70a082310000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d',
    );
  });

  it('reads one uint256 word, and nothing else', () => {
    const word = new Uint8Array(32);
    word.set(bytes('0x0de0b6b3a7640000'), 24); // 10^18 = 1 PAS in contract units
    expect(decodeUint256(word)).toBe(10n ** 18n);
    expect(decodeUint256(new Uint8Array(31))).toBeNull();
  });
});

describe('the header line (M11b step 1)', () => {
  it('shows label, value in the hint decimals and unit, and the replies it pays for', () => {
    // 0.8 PAS in contract units at 0.1 PAS a reply: 8 replies.
    expect(hintLine(meter, 8n * 10n ** 17n)).toBe('with Meter: 0.8 PAS (~8 replies)');
    expect(hintLine(meter, 10n ** 17n)).toBe('with Meter: 0.1 PAS (~1 reply)');
    expect(repliesFor(meter, 10n ** 17n - 1n)).toBe(0n);
  });

  it('has no replies part for a hint without a price (a stake)', () => {
    const stake = { ...meter, perReply: null, label: 'your stake' };
    expect(hintLine(stake, 5n * 10n ** 17n)).toBe('your stake: 0.5 PAS');
    expect(repliesFor(stake, 10n ** 18n)).toBeNull();
  });

  // The strip's "After this" adds the PAS a call sends to what the contract
  // holds; pallet-revive keeps it with 18 decimals, the chain with 10.
  it('converts native planck into the hint units only for a PAS hint', () => {
    expect(planckInHintUnits(meter, 10_000_000_000n)).toBe(10n ** 18n);
    expect(planckInHintUnits({ ...meter, unit: 'USDT' }, 1n)).toBeNull();
    expect(planckInHintUnits({ ...meter, decimals: 6 }, 1n)).toBeNull();
  });
});

describe('formatPas (the balance chip)', () => {
  it('shows planck as PAS with at most 4 decimals and no trailing zeros', () => {
    expect(formatPas(12_340_000_000n)).toBe('1.234 PAS');
    expect(formatPas(12_345_678_901n)).toBe('1.2345 PAS');
    expect(formatPas(123_000_000_000n)).toBe('12.3 PAS');
    expect(formatPas(0n)).toBe('0 PAS');
    // A dust amount is not "0": the chip must not say the account is empty.
    expect(formatPas(1n)).toBe('<0.0001 PAS');
  });
});

describe('the header number (spec 0008 v3 pending, M12f)', () => {
  // The owner saw "1 PAS" in the header while /balance said 0.7: the bot
  // charges in batches, so the chain lags by what it metered. The header must
  // show the bot's number, and the split only in the tooltip.
  const PAS = 10n ** 18n;
  const withPending = (pending: bigint): BalanceHint => ({ ...meter, pending: pending.toString() });

  it('shows balance − pending as the one number, with the replies it pays for', () => {
    const parts = headerParts(withPending((3n * PAS) / 10n), PAS);
    expect(parts).toMatchObject({ label: 'with Meter', amount: '0.7 PAS', replies: '~7 replies' });
    expect(parts.split).toBe('1 PAS on chain · 0.3 not yet charged');
  });

  // A v2 bot (or pcdflip) sends no pending: the number is the chain's, and no tooltip.
  it('treats a hint without pending (v2) or with pending 0 as nothing owed, with no split', () => {
    expect(headerParts(meter, PAS)).toEqual({ label: 'with Meter', amount: '1 PAS', replies: '~10 replies', split: null });
    expect(headerParts(withPending(0n), PAS).split).toBeNull();
    expect(pendingOf(meter)).toBe(0n);
  });

  // The charge can land in a best block a moment before the bot's botInfo with
  // the new pending: never show a negative balance meanwhile.
  it('never goes below 0', () => {
    expect(spendable(withPending(2n * PAS), PAS)).toBe(0n);
  });
});
