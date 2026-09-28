import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import { readNetworkProfileId } from '../../app/settings';
import type { IdentitySummary, PairedIdentity } from '../../../shared/desktop-api';
import { deriveEncryptionPublicKey, deriveStatementAccountPublicKey, generateEncryptionPrivateKey, generateStatementAccountSeed, toDeviceKeys } from '../device/keys';
import { forgetCachedDeviceKeys, getDeviceKeys } from '../device/repository';
import type { HandshakeSuccessState } from '../pairing/v2/state';

import { ensurePairedIdentitySeeded, pairedIdentityOf, seedPairedIdentity } from './pairedIdentity';
import { ensureSelfIdentitySeeded } from './selfIdentity';
import { readUserIdentity } from './userIdentity';

// M10a: signed in with the phone, this device signs with its OWN statement
// account (the one the phone gave an allowance), while peers still address
// the person by the identity account and encrypt to the identity chat key.
// If the seeding mixed the two up, statements would be refused (no
// allowance) or messages to the person unreadable.

const random32 = () => crypto.getRandomValues(new Uint8Array(32));

const makeSuccess = (): HandshakeSuccessState => {
  const identityChatPrivateKey = generateEncryptionPrivateKey();
  return {
    tag: 'Success',
    identityAccountId: random32(),
    rootAccountId: random32(),
    identityChatPrivateKey,
    identityChatPublicKey: deriveEncryptionPublicKey(identityChatPrivateKey),
    deviceEncPubKey: random32(),
    ssoEncPubKey: random32(),
    rootEntropySource: random32(),
    peerStatementAccountId: random32(),
  };
};

const makePaired = (): { paired: PairedIdentity; success: HandshakeSuccessState; device: ReturnType<typeof toDeviceKeys> } => {
  const success = makeSuccess();
  const device = toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey());
  return { paired: pairedIdentityOf(success, device, 'paseo', 'alicephone.07', 1_790_000_000_000), success, device };
};

const summaryOf = (paired: PairedIdentity): IdentitySummary => ({ username: 'alicephone.07', accountHex: bytesToHex(paired.identityAccountId), profile: paired.profile, paired: true });

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('seedPairedIdentity', () => {
  it('signs with the offer device key, not the identity account', async () => {
    const { paired, device } = makePaired();
    await seedPairedIdentity(paired);
    const keys = await getDeviceKeys();
    expect(keys.statementAccountSeed).toEqual(device.statementAccountSeed);
    expect(keys.statementAccountPublicKey).toEqual(device.statementAccountPublicKey);
    expect(keys.encryptionPublicKey).toEqual(device.encryptionPublicKey);
    expect(keys.statementAccountPublicKey).not.toEqual(paired.identityAccountId);
  });

  it('reads as the identity with the phone chat key, and names the phone as the peer device', async () => {
    const { paired, success } = makePaired();
    await seedPairedIdentity(paired);
    const identity = await readUserIdentity();
    expect(identity).toMatchObject({
      identityAccountId: success.identityAccountId,
      rootAccountId: success.rootAccountId,
      identityChatPrivateKey: success.identityChatPrivateKey,
      identityChatPublicKey: success.identityChatPublicKey,
      peerDeviceEncPubKey: success.deviceEncPubKey,
      peerStatementAccountId: success.peerStatementAccountId,
      pairedAt: 1_790_000_000_000,
    });
  });

  it('refuses a device key equal to the identity chat key', async () => {
    const { paired } = makePaired();
    await expect(seedPairedIdentity({ ...paired, deviceEncryptionPrivateKey: paired.identityChatPrivateKey })).rejects.toThrow(/must not be/);
    expect(await db.secrets.count()).toBe(0);
  });
});

describe('ensurePairedIdentitySeeded', () => {
  it('seeds a fresh database and writes the network, then asks for the keys no more', async () => {
    const { paired } = makePaired();
    const fetch = vi.fn(async () => paired);
    await ensurePairedIdentitySeeded(summaryOf(paired), fetch);
    expect(await readNetworkProfileId()).toBe('paseo');
    await ensurePairedIdentitySeeded(summaryOf(paired), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('replaces a local account left in the database (the device account was the identity)', async () => {
    const seed = generateStatementAccountSeed();
    const local = { statementSeed: seed, chatPrivateKey: generateEncryptionPrivateKey(), deviceEncryptionPrivateKey: generateEncryptionPrivateKey() };
    const localAccount = deriveStatementAccountPublicKey(seed);
    await ensureSelfIdentitySeeded({ username: 'local.01', accountHex: bytesToHex(localAccount), profile: 'devnet' }, async () => local);
    const { paired, device } = makePaired();
    await ensurePairedIdentitySeeded(summaryOf(paired), async () => paired);
    expect((await getDeviceKeys()).statementAccountPublicKey).toEqual(device.statementAccountPublicKey);
    expect((await readUserIdentity())?.identityAccountId).toEqual(paired.identityAccountId);
  });

  it('refuses keys that belong to another account than the summary', async () => {
    const { paired } = makePaired();
    const other = makePaired().paired;
    await expect(ensurePairedIdentitySeeded(summaryOf(paired), async () => other)).rejects.toThrow(/does not match/);
    expect(await readUserIdentity()).toBeNull();
  });
});
