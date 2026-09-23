/**
 * The paired user identity: what the phone handed over in the V2 handshake
 * `Success`. The chat private key goes to the secrets table; the rest is public.
 */

import { DEVICE_ROW_ID, appDatabase, db } from '../../app/database';
import { deriveIdentityChatPublicKey } from '../pairing/scale/handshakeV2';
import type { HandshakeSuccessState } from '../pairing/v2/state';

export type UserIdentity = {
  identityAccountId: Uint8Array;
  rootAccountId: Uint8Array;
  identityChatPrivateKey: Uint8Array;
  identityChatPublicKey: Uint8Array;
  peerDeviceEncPubKey: Uint8Array;
  peerStatementAccountId: Uint8Array | null;
  pairedAt: number;
};

const CHAT_KEY_BYTES = 32;

export const saveUserIdentity = (success: HandshakeSuccessState): Promise<void> =>
  appDatabase.transaction('rw', db.userIdentity, db.secrets, async () => {
    await db.userIdentity.put({
      id: DEVICE_ROW_ID,
      identityAccountId: success.identityAccountId,
      rootAccountId: success.rootAccountId,
      peerDeviceEncPubKey: success.deviceEncPubKey,
      peerStatementAccountId: success.peerStatementAccountId,
      pairedAt: Date.now(),
    });
    await db.secrets.put({ id: 'identity.chatPrivateKey', bytes: success.identityChatPrivateKey });
  });

export const readUserIdentity = async (): Promise<UserIdentity | null> => {
  const row = await db.userIdentity.get(DEVICE_ROW_ID);
  if (!row) return null;
  const secret = await db.secrets.get('identity.chatPrivateKey');
  // Without the chat key nothing addressed to the identity can be read; treat
  // the pairing as gone so the user re-pairs instead of seeing a silent chat.
  if (secret?.bytes.length !== CHAT_KEY_BYTES) {
    console.warn('[identity] persisted identity has no usable chat key');
    return null;
  }
  return {
    identityAccountId: row.identityAccountId,
    rootAccountId: row.rootAccountId,
    identityChatPrivateKey: secret.bytes,
    identityChatPublicKey: deriveIdentityChatPublicKey(secret.bytes),
    peerDeviceEncPubKey: row.peerDeviceEncPubKey,
    peerStatementAccountId: row.peerStatementAccountId,
    pairedAt: row.pairedAt,
  };
};

/**
 * Logout. Wipes the identity and its chat key only: the device keys stay, so a
 * re-pair presents the same device to the phone (it rejects a duplicate
 * otherwise), and so does the processed-statement marker that keeps the old
 * `Success` on the pairing topic from replaying.
 */
export const clearUserIdentity = (): Promise<void> =>
  appDatabase.transaction('rw', db.userIdentity, db.secrets, async () => {
    await db.userIdentity.delete(DEVICE_ROW_ID);
    await db.secrets.delete('identity.chatPrivateKey');
  });
