import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveIdentityKeys, generateMnemonic } from '../main/identity/keys';
import type { createIdentity as desktopCreateIdentity } from '../main/identity/service';

import { webDatabase } from './database';
import { RESET_GRACE_MS, type WebIdentityDeps, createWebIdentity } from './identity';
import { WRONG_PASSPHRASE, newVaultParams } from './vault';

// M22a: on the web the account lives in IndexedDB, so these pin what the
// passphrase must guarantee: no mnemonic in clear at rest, nothing opens
// without the passphrase after a reload, and a cancelled passphrase claims
// no username.

const PASSPHRASE = 'correct horse battery';
const mnemonic = generateMnemonic();
const accountHex = `0x${'ab'.repeat(32)}`;

/** Stands in for the desktop sign-up flow: saves as it would, after the backend claim. */
const fakeCreate = vi.fn<typeof desktopCreateIdentity>(async input => {
  if (await input.store.load()) throw new Error('This computer already has an identity.');
  input.onProgress?.('Claiming username');
  await input.store.save({ mnemonic, username: `${input.username}.07`, accountHex, profile: input.profile });
  return { username: `${input.username}.07`, accountHex, identifierKeyHex: '0x00', confirmed: true, finalized: false };
});

const deps = (overrides: Partial<WebIdentityDeps> = {}): WebIdentityDeps => ({
  db: webDatabase(),
  askNewPassphrase: async () => PASSPHRASE,
  backendFetch: vi.fn() as unknown as typeof fetch,
  clipboard: { writeText: async () => undefined, readText: async () => '', clear: () => undefined },
  createIdentity: fakeCreate,
  vaultParams: () => newVaultParams(1_000),
  ...overrides,
});

const signUp = (api = createWebIdentity(deps())) => api.create({ username: 'webtester', digits: null, profile: 'devnet' }).then(() => api);

beforeEach(async () => {
  fakeCreate.mockClear();
  await webDatabase().records.clear();
});
afterEach(() => vi.useRealTimers());

describe('web identity', () => {
  it('stores the public fields in clear and the mnemonic only sealed', async () => {
    await signUp();
    const record = await webDatabase().records.get('identity');
    expect(record).toMatchObject({ username: 'webtester.07', accountHex, profile: 'devnet' });
    const stored = JSON.stringify(record, (_key, value: unknown) => (value instanceof Uint8Array ? new TextDecoder().decode(value) : value));
    for (const word of mnemonic.split(' ')) expect(stored).not.toContain(` ${word} `);
    expect(stored).not.toContain(mnemonic);
  });

  it('hands the renderer the same derived keys as the desktop, never the mnemonic', async () => {
    const api = await signUp();
    const keys = deriveIdentityKeys(mnemonic);
    expect(await api.secretsForRenderer()).toEqual({
      statementSeed: keys.walletSecret64,
      chatPrivateKey: keys.chatPrivateKey,
      deviceEncryptionPrivateKey: keys.deviceEncryptionPrivateKey,
    });
  });

  it('after a reload stays locked until the right passphrase', async () => {
    const first = await signUp();
    const atRest = await first.atRestKey();
    const reloaded = createWebIdentity(deps());
    expect(await reloaded.get()).toEqual({ username: 'webtester.07', accountHex, profile: 'devnet' });
    expect(await reloaded.locked()).toBe(true);
    await expect(reloaded.secretsForRenderer()).rejects.toThrow('Unlock this account first.');
    await expect(reloaded.atRestKey()).rejects.toThrow('Unlock this account first.');
    await expect(reloaded.unlock('wrong passphrase')).rejects.toThrow(WRONG_PASSPHRASE);
    await reloaded.unlock(PASSPHRASE);
    expect(await reloaded.locked()).toBe(false);
    // The at-rest key survives the reload: the sealed `keys` table still opens.
    expect(await reloaded.atRestKey()).toEqual(atRest);
    expect(await reloaded.recoveryPhrase('reveal')).toBe(mnemonic);
  });

  it('claims nothing when the person cancels the passphrase', async () => {
    const api = createWebIdentity(deps({ askNewPassphrase: async () => null }));
    await expect(api.create({ username: 'webtester', digits: null, profile: 'devnet' })).rejects.toThrow('A passphrase is needed');
    expect(fakeCreate).not.toHaveBeenCalled();
    expect(await api.get()).toBeNull();
  });

  it('passes the /idb fetch to the backend calls', async () => {
    const backendFetch = vi.fn() as unknown as typeof fetch;
    const checkAvailability = vi.fn(async () => ({ status: 'AVAILABLE' as const, availableDigits: [1] }));
    const api = createWebIdentity(deps({ backendFetch, checkAvailability }));
    await api.available('webtester', 'devnet');
    expect(checkAvailability).toHaveBeenCalledWith('webtester', 'devnet', backendFetch);
    await api.create({ username: 'webtester', digits: null, profile: 'devnet' });
    expect(fakeCreate.mock.calls[0]?.[0].fetchImpl).toBe(backendFetch);
  });

  it('undoes a reset inside the grace time, and not after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const api = await signUp();
    await api.reset();
    expect(await api.get()).toBeNull();
    expect(await api.resetUndo()).toBe(true);
    expect(await api.get()).not.toBeNull();
    await api.reset();
    vi.advanceTimersByTime(RESET_GRACE_MS + 1);
    expect(await api.resetUndo()).toBe(false);
    await vi.waitFor(async () => expect(await webDatabase().records.count()).toBe(0));
  });

  it('forgets the account for good (a lost passphrase)', async () => {
    const api = await signUp();
    await api.forget();
    expect(await api.get()).toBeNull();
    expect(await webDatabase().records.count()).toBe(0);
  });
});
