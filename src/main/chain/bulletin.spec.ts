import { describe, expect, it, vi } from 'vitest';

import { NETWORK_PROFILES } from '../../shared/network';
import { deriveIdentityKeys } from '../identity/keys';

import {
  BULLETIN_DEVNET_ONLY,
  RETRY_BACKOFF_MS,
  type StoreAttempt,
  allowanceOf,
  assertDevnetBulletin,
  budgetProblem,
  bulletinSigner,
  cidOf,
  contentHash,
  fetchVerified,
  httpsPrefix,
  storeWithRetry,
} from './bulletin';

// A throwaway mnemonic for key derivation only (the public BIP39 test phrase).
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const C1 = { c0: '7f926b25afe3bf3d9053b2593ccf8785d9d92181762c9f5eb36cf0a96d4554', cid: 'bafk2bzacedkhwk4hqr7cfe4526y7krkb7753jl7pycofql525ces2buc7sfiu' };
const bytes = (hexText: string) => Uint8Array.from(Buffer.from(hexText, 'hex'));

describe('the devnet grant', () => {
  it('runs only for the devnet Bulletin genesis: no other network is authorized by a dev key', () => {
    const devnet = NETWORK_PROFILES.devnet.bulletin?.genesis;
    expect(assertDevnetBulletin(devnet)).toBe(devnet);
    expect(() => assertDevnetBulletin(NETWORK_PROFILES.devnet.assetHub?.genesis)).toThrow(BULLETIN_DEVNET_ONLY);
    expect(() => assertDevnetBulletin('0x8cfe6717' + '0'.repeat(56))).toThrow(BULLETIN_DEVNET_ONLY);
    expect(() => assertDevnetBulletin(undefined)).toThrow(BULLETIN_DEVNET_ONLY);
    expect(NETWORK_PROFILES.paseo.bulletin).toBeNull();
  });
});

describe('the Bulletin signer', () => {
  it('is its own account (//allowance//bulletin//chat), not the identity wallet, and stable across runs', () => {
    const signer = bulletinSigner(TEST_MNEMONIC);
    expect(signer.publicKey).toEqual(bulletinSigner(TEST_MNEMONIC).publicKey);
    expect(signer.publicKey).not.toEqual(deriveIdentityKeys(TEST_MNEMONIC).accountId);
  });
});

describe('content addresses', () => {
  it('match vector C1: the CID a node serves the stored chunk under', () => {
    expect(cidOf(contentHash(bytes(C1.c0)))).toBe(C1.cid);
  });
});

describe('the budget check', () => {
  const now = Date.UTC(2026, 8, 24);
  const allowance = allowanceOf({ expires_at: 1_000 + 14_400, bytes_allowance: 8n * 1024n * 1024n, bytes_used: 7n * 1024n * 1024n, transactions_allowance: 100, transactions_used: 99 }, 1_000, now);

  it('lets an upload through only while transactions and bytes both remain (the chain would not stop it)', () => {
    expect(budgetProblem(allowance, [500_000])).toBeNull();
    expect(budgetProblem(allowance, [500_000, 10])).toMatch(/^Not enough Bulletin storage left: 1\.0 MB\. It refills on 2026-09-25\.$/);
    expect(budgetProblem(allowance, [2_000_016])).toMatch(/^Not enough Bulletin storage left/);
    expect(budgetProblem(null, [1])).toBe('This account has no Bulletin storage yet.');
  });
});

describe('storing one chunk (spec 0012 "Retry")', () => {
  const run = (results: StoreAttempt[], stored: boolean[] = []) => {
    const submit = vi.fn(async () => results.shift() ?? 'timeout');
    const isStored = vi.fn(async () => stored.shift() ?? false);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    return { promise: storeWithRetry({ submit, isStored, sleep }), submit, isStored, sleep };
  };

  it('is done at the first best block that holds it', async () => {
    const { promise, submit, sleep } = run(['stored']);
    await promise;
    expect(submit).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not store twice when a timed-out chunk is on chain after all', async () => {
    const { promise, submit } = run(['timeout'], [true]);
    await promise;
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('resubmits after 10 s, 30 s and 90 s, then fails the upload (no message is sent)', async () => {
    const { promise, submit, sleep } = run(['failed', 'timeout', 'failed', 'timeout']);
    await expect(promise).rejects.toThrow(/Upload failed/);
    expect(submit).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([...RETRY_BACKOFF_MS]);
  });
});

describe('fetching one chunk', () => {
  const good = bytes(C1.c0);
  const hash = contentHash(good);

  it('skips a source that returns other bytes, and takes the next one whose bytes hash right', async () => {
    const liar = { name: 'bitswap' as const, get: vi.fn(async () => Uint8Array.of(1, 2, 3)) };
    const honest = { name: 'gateway' as const, get: vi.fn<(cid: string) => Promise<Uint8Array>>(async () => good) };
    const result = await fetchVerified(hash, [liar, honest]);
    expect(result.source).toBe('gateway');
    expect(result.bytes).toEqual(good);
    expect(honest.get).toHaveBeenCalledWith(C1.cid);
  });

  it('fails when no source has the right bytes', async () => {
    await expect(fetchVerified(hash, [{ name: 'bitswap', get: async () => Promise.reject(new Error('not found')) }])).rejects.toThrow(/No source had the chunk \(bitswap: not found\)/);
  });

  it('gives up on a source after its time', async () => {
    const slow = { name: 'mirror' as const, get: () => new Promise<Uint8Array>(() => undefined) };
    await expect(fetchVerified(hash, [slow], 20)).rejects.toThrow(/mirror: mirror timed out/);
  });
});

describe('mirror prefixes from a message', () => {
  it('are https only', () => {
    expect(httpsPrefix('https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/')).toBe('https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/');
    expect(httpsPrefix('http://example.com/ipfs/')).toBeNull();
    expect(httpsPrefix('file:///etc/')).toBeNull();
    expect(httpsPrefix('https://user:pw@example.com/')).toBeNull();
    expect(httpsPrefix(null)).toBeNull();
  });
});
