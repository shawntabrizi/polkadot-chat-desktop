/**
 * A self-owned identity (minted by the desktop main process, no phone). It
 * fills the same Dexie rows a phone pairing fills, so nothing downstream
 * changes. Single device, as a `pca` bot: the device's statement account IS the
 * identity wallet account, and the device encryption key IS the identity chat key.
 */

import { DEVICE_ROW_ID, appDatabase, db } from '../../app/database';
import { bytesEqual, hexToBytes } from '../../app/bytes';
import { writeNetworkProfileId } from '../../app/settings';
import type { IdentitySummary, RendererSecrets } from '../../../shared/desktop-api';
import { ENCRYPTION_KEY_BYTES, STATEMENT_SEED_BYTES, deriveEncryptionPublicKey, deriveStatementAccountPublicKey } from '../device/keys';
import { forgetCachedDeviceKeys } from '../device/repository';

export const seedSelfIdentity = async (secrets: RendererSecrets, accountId: Uint8Array): Promise<void> => {
  const { statementSeed, chatPrivateKey } = secrets;
  if (statementSeed.length !== STATEMENT_SEED_BYTES || chatPrivateKey.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error('identity secrets have the wrong size');
  }
  const statementAccountPublicKey = deriveStatementAccountPublicKey(statementSeed);
  // A seed that does not derive the registered account would sign statements
  // peers attribute to nobody; refuse it instead of chatting as a stranger.
  if (!bytesEqual(statementAccountPublicKey, accountId)) {
    throw new Error('identity secrets do not match the registered account');
  }
  const encryptionPublicKey = deriveEncryptionPublicKey(chatPrivateKey);
  const now = Date.now();
  await appDatabase.transaction('rw', db.device, db.secrets, db.userIdentity, async () => {
    await db.device.put({ id: DEVICE_ROW_ID, statementAccountPublicKey, encryptionPublicKey, createdAt: now });
    await db.secrets.bulkPut([
      { id: 'device.statementSeed', bytes: statementSeed },
      { id: 'device.encryptionPrivateKey', bytes: chatPrivateKey },
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
 * there is no identity row, or when the row belongs to another account
 * (e.g. a phone pairing from before). `fetchSecrets` is only called then.
 */
export const ensureSelfIdentitySeeded = async (
  summary: IdentitySummary,
  fetchSecrets: () => Promise<RendererSecrets>,
): Promise<void> => {
  const accountId = hexToBytes(summary.accountHex);
  const row = await db.userIdentity.get(DEVICE_ROW_ID);
  const chatKey = await db.secrets.get('identity.chatPrivateKey');
  if (row && chatKey && bytesEqual(row.identityAccountId, accountId)) return;
  await seedSelfIdentity(await fetchSecrets(), accountId);
  await writeNetworkProfileId(summary.profile);
};
