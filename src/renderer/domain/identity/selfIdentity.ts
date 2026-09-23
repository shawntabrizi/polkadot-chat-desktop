/**
 * A self-owned identity (minted by the desktop main process, no phone). It
 * fills the same Dexie rows a phone pairing fills, so nothing downstream
 * changes. Single device, as a `pca` bot and the mobile app: the device's
 * statement account IS the identity wallet account; the device encryption key
 * is its own key, never the identity chat key (equal keys put the device
 * session on the identity session's topics, which bot-core cannot read).
 */

import { DEVICE_ROW_ID, appDatabase, db } from '../../app/database';
import { bytesEqual, hexToBytes } from '../../app/bytes';
import { writeNetworkProfileId } from '../../app/settings';
import type { IdentitySummary, RendererSecrets } from '../../../shared/desktop-api';
import { ENCRYPTION_KEY_BYTES, STATEMENT_SEED_BYTES, deriveEncryptionPublicKey, deriveStatementAccountPublicKey } from '../device/keys';
import { forgetCachedDeviceKeys } from '../device/repository';

export const seedSelfIdentity = async (secrets: RendererSecrets, accountId: Uint8Array): Promise<void> => {
  const { statementSeed, chatPrivateKey, deviceEncryptionPrivateKey } = secrets;
  if (
    statementSeed.length !== STATEMENT_SEED_BYTES ||
    chatPrivateKey.length !== ENCRYPTION_KEY_BYTES ||
    deviceEncryptionPrivateKey.length !== ENCRYPTION_KEY_BYTES
  ) {
    throw new Error('identity secrets have the wrong size');
  }
  if (bytesEqual(deviceEncryptionPrivateKey, chatPrivateKey)) {
    throw new Error('the device encryption key must not be the identity chat key');
  }
  const statementAccountPublicKey = deriveStatementAccountPublicKey(statementSeed);
  // A seed that does not derive the registered account would sign statements
  // peers attribute to nobody; refuse it instead of chatting as a stranger.
  if (!bytesEqual(statementAccountPublicKey, accountId)) {
    throw new Error('identity secrets do not match the registered account');
  }
  const encryptionPublicKey = deriveEncryptionPublicKey(deviceEncryptionPrivateKey);
  const now = Date.now();
  await appDatabase.transaction('rw', db.device, db.secrets, db.userIdentity, async () => {
    await db.device.put({ id: DEVICE_ROW_ID, statementAccountPublicKey, encryptionPublicKey, createdAt: now });
    await db.secrets.bulkPut([
      { id: 'device.statementSeed', bytes: statementSeed },
      { id: 'device.encryptionPrivateKey', bytes: deviceEncryptionPrivateKey },
      { id: 'identity.chatPrivateKey', bytes: chatPrivateKey },
    ]);
    await db.userIdentity.put({
      id: DEVICE_ROW_ID,
      identityAccountId: accountId,
      rootAccountId: accountId,
      peerDeviceEncPubKey: encryptionPublicKey,
      peerStatementAccountId: accountId,
      pairedAt: now,
    });
  });
  // The cached device keys (if any were read) are the old ones.
  forgetCachedDeviceKeys();
};

/**
 * Makes Dexie hold the identity saved in the main process: seeds it when
 * there is no identity row, when the row belongs to another account (e.g. a
 * phone pairing from before), or when the device encryption key is still the
 * chat key (the M1 layout). `fetchSecrets` is only called then.
 */
export const ensureSelfIdentitySeeded = async (
  summary: IdentitySummary,
  fetchSecrets: () => Promise<RendererSecrets>,
): Promise<void> => {
  const accountId = hexToBytes(summary.accountHex);
  const row = await db.userIdentity.get(DEVICE_ROW_ID);
  const chatKey = await db.secrets.get('identity.chatPrivateKey');
  const deviceKey = await db.secrets.get('device.encryptionPrivateKey');
  const current = row && chatKey && deviceKey && bytesEqual(row.identityAccountId, accountId) && !bytesEqual(deviceKey.bytes, chatKey.bytes);
  if (current) return;
  await seedSelfIdentity(await fetchSecrets(), accountId);
  await writeNetworkProfileId(summary.profile);
};
