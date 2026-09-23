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
    secrets: { statementSeed, chatPrivateKey: generateEncryptionPrivateKey() },
    accountId: deriveStatementAccountPublicKey(statementSeed),
  };
};

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('seedSelfIdentity', () => {
  // Single device: peers reach this app at the identity account and encrypt to
  // the identity chat key, so the device keys must be exactly those.
  it('makes the device keys the identity wallet and chat keys', async () => {
    const { secrets, accountId } = makeSecrets();
    await seedSelfIdentity(secrets, accountId);

    const device = await getDeviceKeys();
    expect(device.statementAccountSeed).toEqual(secrets.statementSeed);
    expect(device.statementAccountPublicKey).toEqual(accountId);
    expect(device.encryptionPrivateKey).toEqual(secrets.chatPrivateKey);
    expect(device.encryptionPublicKey).toEqual(deriveEncryptionPublicKey(secrets.chatPrivateKey));
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
      peerDeviceEncPubKey: deriveEncryptionPublicKey(secrets.chatPrivateKey),
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
