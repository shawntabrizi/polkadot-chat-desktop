import { describe, expect, it } from 'vitest';

import { DEVNET_ASSET_HUB_GENESIS, DEVNET_ONLY, NO_SOURCE, SOURCE_MIN_PLANCK, assertDevnetChain, pickSource } from './faucet';

const PAS = 10_000_000_000n;

describe('embedded faucet: which dev account pays', () => {
  it('skips a drained //Alice and pays from //Bob', () => {
    expect(pickSource([
      { account: 'Alice', free: PAS / 10n },
      { account: 'Bob', free: 40n * PAS },
      { account: 'Charlie', free: 90n * PAS },
    ])).toBe('Bob');
  });

  it('takes the first account in the fixed order, not the richest', () => {
    expect(pickSource([
      { account: 'Ferdie', free: 1_000n * PAS },
      { account: 'Charlie', free: SOURCE_MIN_PLANCK },
    ])).toBe('Charlie');
  });

  it('refuses an account just under 1.5 PAS (1 PAS + fee + existential deposit must fit)', () => {
    expect(pickSource([{ account: 'Alice', free: SOURCE_MIN_PLANCK - 1n }])).toBeNull();
  });

  it('with every account empty there is no source (the room says: all accounts are empty)', () => {
    expect(pickSource(['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Ferdie'].map(account => ({ account: account as 'Alice', free: 0n })))).toBeNull();
    expect(NO_SOURCE).toBe('All devnet faucet accounts are empty.');
  });
});

describe('faucet:drip chain guard', () => {
  it('accepts devnet Asset Hub only', () => {
    expect(assertDevnetChain(DEVNET_ASSET_HUB_GENESIS)).toBe(DEVNET_ASSET_HUB_GENESIS);
    expect(DEVNET_ASSET_HUB_GENESIS).toBe('0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2');
  });

  it('refuses any other chain id, a malformed one, and no id at all', () => {
    for (const other of ['0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3', `0x${'00'.repeat(32)}`, 'devnet', '', undefined, 42]) {
      expect(() => assertDevnetChain(other)).toThrow(DEVNET_ONLY);
    }
  });
});
