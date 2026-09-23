// Ported from polkadot-desktop src/domains/chat/p2p/chatSessionV2.ts.

/**
 * The per-peer multi-device transport: a thin adapter over
 * `createMultiDeviceSession`, which owns the `multiRequest` / `multiResponse`
 * envelope, per-device topic derivation, batching, statement dedup, expiry
 * allocation, submit retries and the restore of the un-acked batch from the
 * store at init. What stays here: message dedup by id, and mapping the
 * session's signals to message status.
 *
 * Statements are signed with this device's sr25519; the identity key only
 * derives topics and encryption.
 */

import { ChatMessage as ChatMessageCodec } from '@novasamatech/host-chat/codec/message';
import {
  type ExpiryAllocator,
  type PeerRoster,
  type StatementProver,
  type StatementStoreAdapter,
  createAccountId,
  createMultiDeviceSession,
} from '@novasamatech/statement-store';

import type { DeviceKeys } from '../device/keys';
import type { UserIdentity } from '../identity/userIdentity';

import type { ChatContent, ChatMessageWire } from './identityEvents';

export type IncomingChatMessage = { messageId: string; timestamp: number; content: ChatContent };

export type PeerSessionParams = {
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  peerIdentityAccountId: Uint8Array;
  peerIdentityChatPublicKey: Uint8Array;
  /** The peer's devices, read live (see `peerRoster.ts`). */
  peerRoster: PeerRoster;
  prover: StatementProver;
  allocator: ExpiryAllocator;
  statementStore: StatementStoreAdapter;
  /** Every chat message decoded from incoming statements, once per id. */
  onMessage: (message: IncomingChatMessage) => void;
  /** The message is on a submitted statement: `sending` → `sent`. */
  onSent: (messageId: string) => void;
  /** The peer acknowledged this message: `sent` → `delivered`. */
  onDelivered: (messageId: string) => void;
  /**
   * The peer acknowledged the outgoing batch, which carries every message it
   * has not acked yet. Messages sent in THIS run resolve through
   * `onDelivered`; this covers the ones restored from a previous run, whose
   * waiters the SDK cannot restore.
   */
  onBatchDelivered: () => void;
};

export type PeerSession = {
  /** Resolves once the session queued the message; rejects when it can never go out. */
  send: (content: ChatContent, ids: { messageId: string; timestamp: number }) => Promise<void>;
  dispose: VoidFunction;
};

export const createPeerSession = (params: PeerSessionParams): PeerSession => {
  const session = createMultiDeviceSession({
    localDevice: {
      statementAccountId: params.deviceKeys.statementAccountPublicKey,
      encryptionPrivateKey: params.deviceKeys.encryptionPrivateKey,
    },
    localIdentity: {
      accountId: createAccountId(params.identity.identityAccountId),
      chatPrivateKey: params.identity.identityChatPrivateKey,
    },
    remoteIdentity: {
      accountId: createAccountId(params.peerIdentityAccountId),
      chatPublicKey: params.peerIdentityChatPublicKey,
    },
    peerRoster: params.peerRoster,
    statementStore: params.statementStore,
    prover: params.prover,
    allocator: params.allocator,
  });

  const seen = new Set<string>();

  const unsubscribe = session.subscribe(ChatMessageCodec, messages => {
    for (const message of messages) {
      if (message.type === 'response') {
        if (message.responseCode === 'success') params.onBatchDelivered();
        continue;
      }
      // One undecodable entry is one message this build cannot read; the
      // rest of the batch is unaffected.
      if (message.payload.status !== 'parsed') continue;
      const wire = message.payload.value;
      if (seen.has(wire.messageId)) continue;
      seen.add(wire.messageId);
      params.onMessage({ messageId: wire.messageId, timestamp: Number(wire.timestamp), content: wire.versioned.value });
    }
  });

  // ACK only what decoded, so the peer advances its own rows to `delivered`
  // for messages we actually have. A blanket 'success' would claim a message
  // this build silently dropped.
  const stopResponding = session.respondToRequests(ChatMessageCodec, request =>
    request.payload.status === 'parsed' ? 'success' : 'decodingFailed',
  );

  return {
    send: async (content, ids) => {
      const payload: ChatMessageWire = {
        messageId: ids.messageId,
        timestamp: BigInt(ids.timestamp),
        versioned: { tag: 'v1', value: content },
      };
      const submitted = await session.submitRequestMessage(ChatMessageCodec, payload);
      if (submitted.isErr()) throw submitted.error;
      // The SDK accepts into the outgoing batch here, not when the statement
      // lands, so `sent` is optimistic and nothing walks it back.
      params.onSent(ids.messageId);
      void session.waitForResponseMessage(submitted.value.requestId).match(
        () => params.onDelivered(ids.messageId),
        // Also fires on dispose, where the message is still live in the store;
        // treating that as a failure would drop a good row on every teardown.
        error => console.warn('[peer-session] no ack for %s: %s', ids.messageId, error.message),
      );
    },
    dispose: () => {
      stopResponding();
      unsubscribe();
      session.dispose();
    },
  };
};
