import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import { readNetworkProfileId } from '../../app/settings';
import type { RendererSecrets } from '../../../shared/desktop-api';
import {
  deriveEncryptionPublicKey,
  deriveStatementAccountPublicKey,
  generateEncryptionPrivateKey,
  generateStatementAccountSeed,
} from '../device/keys';
import { forgetCachedDeviceKeys, getDeviceKeys } from '../device/repository';

import { ensureSelfIdentitySeeded, seedSelfIdentity } from './selfIdentity';
import { readUserIdentity } from './userIdentity';

// Random keys per test: the shape of what the main process sends, no real identity.
const makeSecrets = (): { secrets: RendererSecrets; accountId: Uint8Array } => {
  const statementSeed = generateStatementAccountSeed();
  return {
    secrets: { statementSeed, chatPrivateKey: generateEncryptionPrivateKey(), deviceEncryptionPrivateKey: generateEncryptionPrivateKey() },
    accountId: deriveStatementAccountPublicKey(statementSeed),
  };
};

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('seedSelfIdentity', () => {
  // Single device: peers reach this app at the identity account, as they reach
  // a mobile app. The encryption key is the device's own: equal to the chat
  // key, the device session would sit on the identity session's topics, where
  // bot-core decrypts with the identity key and drops every message.
  it('makes the statement account the identity wallet and keeps the device encryption key apart', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);

    const device = await getDeviceKeys();
    expect(device.statementAccountSeed).toEqual(secrets.statementSeed);
    expect(device.statementAccountPublicKey).toEqual(accountId);
    expect(device.encryptionPrivateKey).toEqual(secrets.deviceEncryptionPrivateKey);
    expect(device.encryptionPublicKey).toEqual(deriveEncryptionPublicKey(secrets.deviceEncryptionPrivateKey));
    expect(device.encryptionPrivateKey).not.toEqual(secrets.chatPrivateKey);
  });

  it('refuses a device encryption key equal to the chat key', async () => {
    const { secrets, accountId } = makeSecrets();
    await expect(seedSelfIdentity({ ...secrets, deviceEncryptionPrivateKey: secrets.chatPrivateKey }, accountId)).rejects.toThrow(/must not be/);
    expect(await db.secrets.count()).toBe(0);
  });

  it('writes the identity row as its own peer device', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);

    const identity = await readUserIdentity();
    expect(identity).toMatchObject({
      identityAccountId: accountId,
      rootAccountId: accountId,
      identityChatPrivateKey: secrets.chatPrivateKey,
      identityChatPublicKey: deriveEncryptionPublicKey(secrets.chatPrivateKey),
      peerDeviceEncPubKey: deriveEncryptionPublicKey(secrets.deviceEncryptionPrivateKey),
      peerStatementAccountId: accountId,
    });
  });

  it('replaces device keys minted before sign-up and drops the stale cache', async () => {
    const minted = await getDeviceKeys();
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);
    const after = await getDeviceKeys();
    expect(after.statementAccountPublicKey).not.toEqual(minted.statementAccountPublicKey);
    expect(after.statementAccountPublicKey).toEqual(accountId);
  });

  it('refuses secrets that do not derive the registered account, and writes nothing', async () => {
    const { secrets } = makeSecrets();
    const other = makeSecrets().accountId;
    await expect(seedSelfIdentity(secrets, other)).rejects.toThrow(/do not match/);
    expect(await db.userIdentity.count()).toBe(0);
    expect(await db.secrets.count()).toBe(0);
  });
});

describe('ensureSelfIdentitySeeded', () => {
  it('seeds on first launch and records the identity network', async () => {
    const { secrets, accountId } = makeSecrets();
    const fetchSecrets = vi.fn(async () => secrets);
    await ensureSelfIdentitySeeded({ username: 'alicebob.07', accountHex: bytesToHex(accountId), profile: 'paseo' }, fetchSecrets);
    expect(fetchSecrets).toHaveBeenCalledOnce();
    expect((await readUserIdentity())?.identityAccountId).toEqual(accountId);
    expect(await readNetworkProfileId()).toBe('paseo');
  });

  // Secrets cross IPC only when needed.
  it('does not ask for secrets when Dexie already holds this identity', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);
    const fetchSecrets = vi.fn(async () => secrets);
    await ensureSelfIdentitySeeded({ username: 'alicebob.07', accountHex: bytesToHex(accountId), profile: 'devnet' }, fetchSecrets);
    expect(fetchSecrets).not.toHaveBeenCalled();
  });

  // M1 seeded the chat key as the device key; such an install must move to
  // its own device key on the next start, or bots keep dropping its messages.
  it('re-seeds when the device encryption key is still the chat key', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);
    await db.secrets.put({ id: 'device.encryptionPrivateKey', bytes: secrets.chatPrivateKey });
    const fetchSecrets = vi.fn(async () => secrets);
    await ensureSelfIdentitySeeded({ username: 'alicebob.07', accountHex: bytesToHex(accountId), profile: 'devnet' }, fetchSecrets);
    expect(fetchSecrets).toHaveBeenCalledOnce();
    expect((await db.secrets.get('device.encryptionPrivateKey'))?.bytes).toEqual(secrets.deviceEncryptionPrivateKey);
  });

  // Restart safety: identity.json in the main process is the source of truth.
  // A start that finds Dexie short of any piece rebuilds it from there instead
  // of showing Chats with keys that cannot sign or decrypt.
  it.each(['device.statementSeed', 'device.encryptionPrivateKey', 'identity.chatPrivateKey'] as const)(
    'restores the identity on start when the %s secret is missing',
    async missing => {
      const { secrets, accountId } = makeSecrets();
      await seedSelfIdentity(secrets, accountId);
      await db.secrets.delete(missing);
      forgetCachedDeviceKeys();
      const fetchSecrets = vi.fn(async () => secrets);
      await ensureSelfIdentitySeeded({ username: 'alicebob.07', accountHex: bytesToHex(accountId), profile: 'devnet' }, fetchSecrets);
      expect(fetchSecrets).toHaveBeenCalledOnce();
      expect(await db.secrets.count()).toBe(3);
      const device = await getDeviceKeys();
      expect(device.statementAccountPublicKey).toEqual(accountId);
      expect(device.encryptionPrivateKey).toEqual(secrets.deviceEncryptionPrivateKey);
    },
  );

  it('restores the identity on start when the userIdentity row is missing, and keeps the chats', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);
    const peer = `0x${'44'.repeat(32)}` as const;
    await db.contacts.put({ accountId: peer, username: 'peer.01', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 1, updatedAt: 1 });
    await db.userIdentity.clear();
    const fetchSecrets = vi.fn(async () => secrets);
    await ensureSelfIdentitySeeded({ username: 'alicebob.07', accountHex: bytesToHex(accountId), profile: 'devnet' }, fetchSecrets);
    expect(fetchSecrets).toHaveBeenCalledOnce();
    expect((await readUserIdentity())?.identityAccountId).toEqual(accountId);
    expect(await db.contacts.get(peer)).toBeDefined();
  });

  it('re-seeds when Dexie holds a different identity', async () => {
    const old = makeSecrets();
    await seedSelfIdentity(old.secrets, old.accountId);
    const current = makeSecrets();
    await ensureSelfIdentitySeeded(
      { username: 'alicebob.07', accountHex: bytesToHex(current.accountId), profile: 'devnet' },
      async () => current.secrets,
    );
    expect((await readUserIdentity())?.identityAccountId).toEqual(current.accountId);
  });
});
