/**
 * M10a "Sign in with Polkadot app": the identity the phone handed over, in
 * the Dexie rows the chat engine reads (the same rows `seedSelfIdentity`
 * fills for a local account). What differs from a local account:
 *
 * - the statement account is this device's own key, the one in the QR offer
 *   and the one the phone gave a Statement Store allowance. It is NOT the
 *   identity account: the phone keeps the identity's seed. The chat manager
 *   already signs with `device.statementSeed` and addresses the person by
 *   `identityAccountId`, so it needs no change (docs/decisions.md M10a);
 * - the identity chat key is the phone's, so this device reads what peers
 *   send to the identity;
 * - the peer device of the identity row is the phone (its encryption key and
 *   statement account), not this device.
 */

import { DEVICE_ROW_ID, appDatabase, db } from '../../app/database';
import { bytesEqual, hexToBytes } from '../../app/bytes';
import { writeNetworkProfileId } from '../../app/settings';
import type { IdentitySummary, PairedIdentity } from '../../../shared/desktop-api';
import type { NetworkProfileId } from '../../../shared/network';
import { type DeviceKeys, ENCRYPTION_KEY_BYTES, STATEMENT_SEED_BYTES, deriveEncryptionPublicKey, deriveStatementAccountPublicKey } from '../device/keys';
import { forgetCachedDeviceKeys } from '../device/repository';
import type { HandshakeSuccessState } from '../pairing/v2/state';

/** The phone's `Success` plus the device keys the offer carried: what the store keeps. */
export const pairedIdentityOf = (
  success: HandshakeSuccessState,
  device: DeviceKeys,
  profile: NetworkProfileId,
  username: string | null,
  now: number = Date.now(),
): PairedIdentity => ({
  profile,
  username,
  pairedAt: now,
  identityAccountId: success.identityAccountId,
  rootAccountId: success.rootAccountId,
  identityChatPrivateKey: success.identityChatPrivateKey,
  phoneDeviceEncPubKey: success.deviceEncPubKey,
  phoneStatementAccountId: success.peerStatementAccountId,
  ssoEncPubKey: success.ssoEncPubKey,
  rootEntropySource: success.rootEntropySource,
  deviceStatementSeed: device.statementAccountSeed,
  deviceEncryptionPrivateKey: device.encryptionPrivateKey,
});

export const seedPairedIdentity = async (paired: PairedIdentity): Promise<void> => {
  const { deviceStatementSeed, deviceEncryptionPrivateKey, identityChatPrivateKey } = paired;
  if (
    deviceStatementSeed.length !== STATEMENT_SEED_BYTES ||
    deviceEncryptionPrivateKey.length !== ENCRYPTION_KEY_BYTES ||
    identityChatPrivateKey.length !== ENCRYPTION_KEY_BYTES
  ) {
    throw new Error('the paired identity has keys of the wrong size');
  }
  // Same rule as a local account: equal keys put the device session on the identity session's topics.
  if (bytesEqual(deviceEncryptionPrivateKey, identityChatPrivateKey)) {
    throw new Error('the device encryption key must not be the identity chat key');
  }
  const statementAccountPublicKey = deriveStatementAccountPublicKey(deviceStatementSeed);
  const encryptionPublicKey = deriveEncryptionPublicKey(deviceEncryptionPrivateKey);
  const now = Date.now();
  await appDatabase.transaction('rw', db.device, db.secrets, db.userIdentity, async () => {
    await db.device.put({ id: DEVICE_ROW_ID, statementAccountPublicKey, encryptionPublicKey, createdAt: now });
    await db.secrets.bulkPut([
      { id: 'device.statementSeed', bytes: deviceStatementSeed },
      { id: 'device.encryptionPrivateKey', bytes: deviceEncryptionPrivateKey },
      { id: 'identity.chatPrivateKey', bytes: identityChatPrivateKey },
    ]);
    await db.userIdentity.put({
      id: DEVICE_ROW_ID,
      identityAccountId: paired.identityAccountId,
      rootAccountId: paired.rootAccountId,
      peerDeviceEncPubKey: paired.phoneDeviceEncPubKey,
      peerStatementAccountId: paired.phoneStatementAccountId,
      pairedAt: paired.pairedAt,
    });
  });
  forgetCachedDeviceKeys();
};

/**
 * The paired twin of `ensureSelfIdentitySeeded`, on every start before Chats
 * shows: seeds Dexie when a row or a secret is missing, when the row is of
 * another account, or when the device statement account is the identity
 * account (a local account's layout). `fetchPaired` is called only then.
 */
export const ensurePairedIdentitySeeded = async (summary: IdentitySummary, fetchPaired: () => Promise<PairedIdentity>): Promise<void> => {
  const accountId = hexToBytes(summary.accountHex);
  const row = await db.userIdentity.get(DEVICE_ROW_ID);
  const device = await db.device.get(DEVICE_ROW_ID);
  const statementSeed = await db.secrets.get('device.statementSeed');
  const chatKey = await db.secrets.get('identity.chatPrivateKey');
  const deviceKey = await db.secrets.get('device.encryptionPrivateKey');
  const current =
    row &&
    device &&
    statementSeed &&
    chatKey &&
    deviceKey &&
    bytesEqual(row.identityAccountId, accountId) &&
    !bytesEqual(device.statementAccountPublicKey, accountId) &&
    !bytesEqual(deviceKey.bytes, chatKey.bytes);
  if (current) return;
  const paired = await fetchPaired();
  if (!bytesEqual(paired.identityAccountId, accountId)) throw new Error('the saved sign-in does not match its summary');
  await seedPairedIdentity(paired);
  await writeNetworkProfileId(summary.profile);
};
