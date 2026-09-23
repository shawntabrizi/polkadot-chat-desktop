import { describe, expect, it } from 'vitest';

import { balanceOfCalldata, decodeUint256, isMeterTopUp, repliesFor, reviveAddressOf, unitsToPlanck } from './meter';

const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;
const bytes = (value: string) => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));

describe('Meter contract helpers (docs/spec/contracts/meter.md)', () => {
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

  it('builds the balanceOf calldata of meter.md', () => {
    expect(hex(balanceOfCalldata(bytes('0x9621dde636de098b43efb0fa9b61facfe328f99d')))).toBe(
      '0x70a082310000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d',
    );
  });

  it('reads a uint256 in contract units and turns it into planck and replies', () => {
    const word = new Uint8Array(32);
    word.set(bytes('0x0de0b6b3a7640000'), 24); // 10^18 = 1 PAS in contract units
    const units = decodeUint256(word);
    expect(units).toBe(10n ** 18n);
    expect(unitsToPlanck(units ?? 0n)).toBe(10_000_000_000n);
    expect(repliesFor(8_000_000_000n)).toBe(8n);
    expect(decodeUint256(new Uint8Array(31))).toBeNull();
  });

  it('knows a topUp call on the meter, and nothing else', () => {
    const base = { kind: 1, to: bytes('0x30b0c001431a1addb8c11a060ada4d6a7033cf21'), data: bytes('0xdc29f1de'), value: 1n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined };
    expect(isMeterTopUp(base)).toBe(true);
    expect(isMeterTopUp({ ...base, data: bytes('0x70a08231') })).toBe(false);
    expect(isMeterTopUp({ ...base, to: new Uint8Array(20) })).toBe(false);
    expect(isMeterTopUp({ ...base, kind: 0 })).toBe(false);
  });
});
