/**
 * The per-peer session registry: one multi-device session and one live
 * roster per contact. Message status moves here; message content is handed
 * to the manager, which owns the repositories.
 */

import type { ExpiryAllocator, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';

import { type HexString, hexToBytes } from '../../app/bytes';
import type { ContactRow, PeerDevice } from '../../app/database';
import type { DeviceKeys } from '../device/keys';
import type { UserIdentity } from '../identity/userIdentity';

import type { ChatContent } from './identityEvents';
import { markDeliveredBefore, setMessageStatus } from './messages';
import { type PeerRosterHandle, createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, type PeerSession, createPeerSession } from './peerSession';

export type SessionRegistry = {
  /** Open the session for a contact; a no-op when one is already running. */
  start: (contact: ContactRow) => void;
  has: (peer: HexString) => boolean;
  /** Apply a roster change to the running session without a teardown. */
  publishRoster: (peer: HexString, devices: PeerDevice[]) => void;
  send: (peer: HexString, content: ChatContent, ids: { messageId: string; timestamp: number }) => Promise<void>;
  stopAll: VoidFunction;
};

export const createSessionRegistry = (deps: {
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  prover: StatementProver;
  allocator: ExpiryAllocator;
  statementStore: StatementStoreAdapter;
  onMessage: (peer: HexString, message: IncomingChatMessage) => void;
}): SessionRegistry => {
  const sessions = new Map<HexString, { session: PeerSession; roster: PeerRosterHandle }>();

  return {
    start: contact => {
      if (sessions.has(contact.accountId)) return;
      const peer = contact.accountId;
      const roster = createPeerRoster(contact.devices);
      // Rows restored from a previous run have no waiter; the first batch ack
      // after start settles them. Later acks would rescan for nothing.
      const startedAt = Date.now();
      let batchChecked = false;
      const session = createPeerSession({
        identity: deps.identity,
        deviceKeys: deps.deviceKeys,
        peerIdentityAccountId: hexToBytes(peer),
        peerIdentityChatPublicKey: contact.chatPublicKey,
        peerRoster: roster,
        prover: deps.prover,
        allocator: deps.allocator,
        statementStore: deps.statementStore,
        onMessage: message => deps.onMessage(peer, message),
        onSent: messageId => void setMessageStatus(messageId, 'sent'),
        onDelivered: messageId => void setMessageStatus(messageId, 'delivered'),
        onBatchDelivered: () => {
          if (batchChecked) return;
          batchChecked = true;
          void markDeliveredBefore(peer, startedAt);
        },
      });
      sessions.set(peer, { session, roster });
    },
    has: peer => sessions.has(peer),
    publishRoster: (peer, devices) => sessions.get(peer)?.roster.set(devices),
    send: async (peer, content, ids) => {
      const entry = sessions.get(peer);
      if (!entry) throw new Error(`no session with ${peer}`);
      await entry.session.send(content, ids);
    },
    stopAll: () => {
      for (const { session } of sessions.values()) session.dispose();
      sessions.clear();
    },
  };
};
