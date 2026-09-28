/**
 * M10a: the web build's `chain.faucetDrip` and `chain.balance` must work for
 * a phone sign-in (`identity.paired`) as well as a local account, and the
 * recipient must always come from the identity the deps hand over, never
 * from the `chainId` argument a caller controls. `openAssetHub`/`dripDevnet`
 * touch a real chain, so they are mocked; `deriveIdentityKeys` is plain
 * crypto and runs for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetHubChain } from '../main/chain/assetHub';
import { deriveIdentityKeys } from '../main/identity/keys';

const dripDevnetMock = vi.fn(async (_chain: unknown, chainId: string, to: Uint8Array) => {
  void to;
  return { hash: '0xhash', from: '//Alice', chainId };
});
const readAccountBalanceMock = vi.fn(async (_chain: unknown, address: string) => ({ chainId: 'chain', free: address, reserved: '0', frozen: '0' }));
const fakeTxService = { onStatus: () => undefined, onBestBlock: () => undefined, dispose: () => undefined, balance: async () => ({ chainId: 'chain', free: '0', reserved: '0', frozen: '0' }) };
const createTxServiceMock = vi.fn((chain: unknown, signer: unknown) => {
  void chain;
  void signer;
  return fakeTxService;
});

const fakeChain = { genesis: 'chain', client: { bestBlocks$: { subscribe: () => ({ unsubscribe: () => undefined }) } } } as unknown as AssetHubChain;
const openAssetHubMock = vi.fn(async (profile: unknown) => {
  void profile;
  return fakeChain;
});

vi.mock('../main/chain/assetHub', () => ({
  openAssetHub: (profile: unknown) => openAssetHubMock(profile),
  createTxService: (chain: unknown, signer: unknown) => createTxServiceMock(chain, signer),
  readAccountBalance: (chain: unknown, address: string) => readAccountBalanceMock(chain, address),
}));
vi.mock('../main/chain/faucet', () => ({
  assertDevnetChain: (chainId: unknown) => chainId as string,
  dripDevnet: (chain: unknown, chainId: string, to: Uint8Array) => dripDevnetMock(chain, chainId, to),
}));

const { createWebChain } = await import('./chain');

const MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
const hex = (bytes: Uint8Array): string => `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;

beforeEach(() => {
  dripDevnetMock.mockClear();
  readAccountBalanceMock.mockClear();
  createTxServiceMock.mockClear();
});

describe('web chain.faucetDrip: who it pays, decided from the identity, never the chainId argument', () => {
  it('a local account: the drip pays the seed-derived account, from the mnemonic dep', async () => {
    const { chain } = createWebChain({
      identity: async () => ({ profile: 'devnet', accountHex: hex(deriveIdentityKeys(MNEMONIC).accountId) }),
      mnemonic: () => MNEMONIC,
      onBulletinTransaction: () => undefined,
    });
    await chain.faucetDrip('any-chain-id-the-caller-sent');
    expect(dripDevnetMock).toHaveBeenCalledTimes(1);
    const [, chainId, to] = dripDevnetMock.mock.calls[0] ?? [];
    expect(chainId).toBe('any-chain-id-the-caller-sent');
    expect(to).toEqual(deriveIdentityKeys(MNEMONIC).accountId);
  });

  it('a phone sign-in: the drip pays the paired identity account, and never touches the mnemonic', async () => {
    const identityAccountId = new Uint8Array(32).fill(7);
    const mnemonic = vi.fn(() => {
      throw new Error('Not available when signed in with your phone.');
    });
    const { chain } = createWebChain({
      identity: async () => ({ profile: 'devnet', accountHex: hex(identityAccountId), paired: true }),
      mnemonic,
      onBulletinTransaction: () => undefined,
    });
    const result = await chain.faucetDrip('any-chain-id-the-caller-sent');
    expect(result.hash).toBe('0xhash');
    expect(dripDevnetMock).toHaveBeenCalledTimes(1);
    const [, , to] = dripDevnetMock.mock.calls[0] ?? [];
    expect(to).toEqual(identityAccountId);
    expect(mnemonic).not.toHaveBeenCalled();
    expect(createTxServiceMock).not.toHaveBeenCalled();
  });
});

describe('web chain.balance: a phone sign-in reads without a signer', () => {
  it('reads the paired identity account, and never touches the mnemonic', async () => {
    const identityAccountId = new Uint8Array(32).fill(9);
    const mnemonic = vi.fn(() => {
      throw new Error('Not available when signed in with your phone.');
    });
    const { chain } = createWebChain({
      identity: async () => ({ profile: 'devnet', accountHex: hex(identityAccountId), paired: true }),
      mnemonic,
      onBulletinTransaction: () => undefined,
    });
    await chain.balance();
    expect(readAccountBalanceMock).toHaveBeenCalledTimes(1);
    expect(mnemonic).not.toHaveBeenCalled();
    expect(createTxServiceMock).not.toHaveBeenCalled();
  });
});
