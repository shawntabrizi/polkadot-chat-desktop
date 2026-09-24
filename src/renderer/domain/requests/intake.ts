/**
 * Turning a statement on the identity's discovery topics into a pending
 * request row, or nothing. Every drop is logged: the sender sees no error.
 * Resolves the new row (M16b: a group admin's client may accept a join
 * request's opener at once), or null.
 */

import { bytesEqual, bytesToHex } from '../../app/bytes';
import type { RequestRow } from '../../app/database';
import { isUsablePeerDevice } from '../device/keys';
import type { IdentityLookup } from '../identity/lookup';
import type { UserIdentity } from '../identity/userIdentity';

import { isBlocked } from '../chat/chatActions';

import { decodeChatRequest, verifyIdentityProof } from './gateway';
import { addRequest, getRequest } from './repository';

export const intakeRequestStatement = async (
  deps: { identity: UserIdentity; lookup: IdentityLookup },
  data: Uint8Array,
): Promise<RequestRow | null> => {
  const { identity, lookup } = deps;
  const decoded = decodeChatRequest(data, identity.identityAccountId, identity.identityChatPrivateKey);
  if (!decoded) return null;
  if (bytesEqual(decoded.senderIdentityAccountId, identity.identityAccountId)) return null;
  if (await getRequest(decoded.requestId)) return null;
  // M12e: a blocked sender's request is dropped (not stored, so it can show after an unblock).
  if (await isBlocked(bytesToHex(decoded.senderIdentityAccountId))) return null;

  const peer = await lookup.getPeerIdentity(decoded.senderIdentityAccountId);
  if (!peer) {
    console.warn('[chat] dropped request %s: sender has no usable People-chain identity', decoded.requestId);
    return null;
  }
  // mds.md: verified against the sender's CURRENT on-chain chat key.
  if (!verifyIdentityProof(decoded, identity.identityChatPrivateKey, peer.chatPublicKey)) {
    console.warn('[chat] dropped request %s: identity proof does not verify', decoded.requestId);
    return null;
  }
  if (!decoded.senderDevice || !isUsablePeerDevice(decoded.senderDevice)) {
    console.warn('[chat] dropped request %s: no usable sender device', decoded.requestId);
    return null;
  }
  const row: RequestRow = {
    requestId: decoded.requestId,
    peerAccountId: bytesToHex(peer.accountId),
    peerUsername: peer.username,
    peerChatPublicKey: peer.chatPublicKey,
    direction: 'incoming',
    status: 'pending',
    welcomeMessage: decoded.welcomeMessage,
    timestamp: decoded.timestamp,
    senderDevice: decoded.senderDevice,
    createdAt: Date.now(),
  };
  return (await addRequest(row)) ? row : null;
};
