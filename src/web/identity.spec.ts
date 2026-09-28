import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveIdentityKeys, generateMnemonic } from '../main/identity/keys';
import type { createIdentity as desktopCreateIdentity } from '../main/identity/service';

import type { PairedIdentity } from '../shared/desktop-api';
import { NO_IDENTITY_BACKEND, PHONE_SIGNED_IN } from '../shared/desktop-api';

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

  // M22c: GitHub Pages has no proxy and the backend no CORS. Sign-up must say so before
  // it asks for a passphrase, and never start a claim it cannot finish.
  it('refuses sign-up and the availability check up front with no backend proxy', async () => {
    const askNewPassphrase = vi.fn(async () => PASSPHRASE);
    const checkAvailability = vi.fn();
    const api = createWebIdentity(deps({ backendFetch: null, askNewPassphrase, checkAvailability }));
    expect(api.backendFetch).toBeNull();
    await expect(api.available('webtester', 'devnet')).rejects.toThrow(NO_IDENTITY_BACKEND);
    await expect(api.create({ username: 'webtester', digits: null, profile: 'devnet' })).rejects.toThrow(NO_IDENTITY_BACKEND);
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(askNewPassphrase).not.toHaveBeenCalled();
    expect(fakeCreate).not.toHaveBeenCalled();
    expect(await api.get()).toBeNull();
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

// M10a: a phone sign-in holds the identity chat key and the device key the
// phone gave an allowance to. They get the same protection as a mnemonic, and
// every member that needs a seed says why it cannot run, instead of failing.
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);
const paired: PairedIdentity = {
  profile: 'devnet',
  username: 'alicephone.07',
  pairedAt: 1_790_000_000_000,
  identityAccountId: filled(32, 1),
  rootAccountId: filled(32, 2),
  identityChatPrivateKey: filled(32, 3),
  phoneDeviceEncPubKey: filled(32, 4),
  phoneStatementAccountId: filled(32, 5),
  ssoEncPubKey: filled(32, 6),
  rootEntropySource: filled(32, 7),
  deviceStatementSeed: filled(64, 8),
  deviceEncryptionPrivateKey: filled(32, 9),
};

describe('web phone sign-in', () => {
  it('asks for a passphrase for the phone sign-in and keeps no key in clear', async () => {
    const ask = vi.fn(async () => PASSPHRASE);
    const api = createWebIdentity(deps({ askNewPassphrase: ask }));
    await api.savePaired(paired);
    expect(ask).toHaveBeenCalledWith('paired');
    const record = await webDatabase().records.get('paired');
    expect(record).toMatchObject({ username: 'alicephone.07', profile: 'devnet', accountHex: `0x${'01'.repeat(32)}` });
    const stored = JSON.stringify(record, (_key, value: unknown) => (value instanceof Uint8Array ? Array.from(value).join(',') : value));
    expect(stored).not.toContain(Array.from(filled(32, 3)).join(','));
    expect(stored).not.toContain('0x' + '03'.repeat(32));
    expect(await api.get()).toEqual({ username: 'alicephone.07', accountHex: `0x${'01'.repeat(32)}`, profile: 'devnet', paired: true });
    expect(await api.pairedSecrets()).toEqual(paired);
  });

  it('keeps nothing when the passphrase is cancelled', async () => {
    const api = createWebIdentity(deps({ askNewPassphrase: async () => null }));
    await expect(api.savePaired(paired)).rejects.toThrow('A passphrase is needed');
    expect(await api.get()).toBeNull();
  });

  it('after a reload opens the phone sign-in only with the passphrase', async () => {
    await createWebIdentity(deps()).savePaired(paired);
    const reloaded = createWebIdentity(deps());
    expect(await reloaded.locked()).toBe(true);
    await expect(reloaded.pairedSecrets()).rejects.toThrow('Unlock this account first.');
    await expect(reloaded.unlock('wrong passphrase')).rejects.toThrow(WRONG_PASSPHRASE);
    await reloaded.unlock(PASSPHRASE);
    expect(await reloaded.pairedSecrets()).toEqual(paired);
    expect((await reloaded.atRestKey()).length).toBe(32);
  });

  it('refuses seed members with the phone text, and a second identity', async () => {
    const api = createWebIdentity(deps());
    await api.savePaired(paired);
    expect(() => api.mnemonic()).toThrow(PHONE_SIGNED_IN);
    await expect(api.secretsForRenderer()).rejects.toThrow(PHONE_SIGNED_IN);
    await expect(api.recoveryPhrase('reveal')).rejects.toThrow(PHONE_SIGNED_IN);
    await expect(api.create({ username: 'webtester', digits: null, profile: 'devnet' })).rejects.toThrow('Sign out first');
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  it('refuses a phone sign-in over a local account', async () => {
    const api = await signUp();
    await expect(api.savePaired(paired)).rejects.toThrow('already has an identity');
  });

  it('sign out forgets the phone sign-in', async () => {
    const api = createWebIdentity(deps());
    await api.savePaired(paired);
    await api.forgetPaired();
    expect(await api.get()).toBeNull();
    await expect(api.pairedSecrets()).rejects.toThrow('not signed in with a phone');
  });
});
