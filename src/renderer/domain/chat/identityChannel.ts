// Ported from polkadot-desktop src/domains/chat/p2p/identityChannel.ts.

/**
 * The identity-level channel with a peer, as a statement-store session.
 *
 *   topic   = SessionId(A, B), listening on SessionId(B, A)
 *   K(A, B) = ECDH(ownIdentityChatPriv, peerIdentityChatPub)
 *
 * It carries `deviceChatAccepted` (the acceptor's DeviceInfo) and the
 * `deviceAdded` / `deviceRemoved` roster fan-out, which cannot ride the
 * per-device session because they are what makes that session possible.
 * Android runs the same single-device session next to its multi-device one.
 * Going through a session means these events are acknowledged and
 * retransmitted until they land, unlike a one-shot statement.
 */

import { ChatMessage as ChatMessageCodec } from '@novasamatech/host-chat/codec/message';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  type ExpiryAllocator,
  type StatementProver,
  type StatementStoreAdapter,
  createAccountId,
  createEncryption,
  createSession,
} from '@novasamatech/statement-store';

import { randomId } from '../../app/bytes';

import { type ChatContent, type ChatMessageWire, type IdentityChannelEvent, toIdentityChannelEvent } from './identityEvents';

export type IdentityChannel = {
  /** Publish an identity-level content variant. Resolves once the session queued it. */
  post: (content: ChatContent) => Promise<void>;
  dispose: VoidFunction;
};

export const createIdentityChannel = (params: {
  ownIdentityAccountId: Uint8Array;
  ownIdentityChatPrivateKey: Uint8Array;
  peerIdentityAccountId: Uint8Array;
  peerIdentityChatPublicKey: Uint8Array;
  /** Statements are signed per device; the identity key never signs. */
  prover: StatementProver;
  allocator: ExpiryAllocator;
  statementStore: StatementStoreAdapter;
  onEvent: (event: IdentityChannelEvent) => void;
}): IdentityChannel => {
  const sharedSecret = x25519.getSharedSecret(params.ownIdentityChatPrivateKey, params.peerIdentityChatPublicKey);

  const session = createSession({
    localAccount: { accountId: createAccountId(params.ownIdentityAccountId), pin: undefined },
    remoteAccount: {
      accountId: createAccountId(params.peerIdentityAccountId),
      publicKey: params.peerIdentityChatPublicKey,
      pin: undefined,
    },
    statementStore: params.statementStore,
    encryption: createEncryption(sharedSecret),
    prover: params.prover,
    allocator: params.allocator,
    // The topic is keyed by the ECDH shared secret, not the raw peer pubkey.
    sessionKey: sharedSecret,
  });

  // Every statement the peer publishes carries all of its un-acked messages
  // (base-spec batching), so one message arrives once per statement until the
  // ack lands. Transport dedup is the SDK's; message dedup is ours.
  const seen = new Set<string>();

  // Answering is also what opens the store subscription, so every incoming
  // statement is both delivered and acknowledged from here.
  const stopResponding = session.respondToRequests(ChatMessageCodec, request => {
    if (request.payload.status !== 'parsed') return 'decodingFailed';
    const message = request.payload.value;
    if (!seen.has(message.messageId)) {
      seen.add(message.messageId);
      const event = toIdentityChannelEvent(message);
      if (event) params.onEvent(event);
    }
    return 'success';
  });

  return {
    post: async content => {
      const payload: ChatMessageWire = {
        messageId: randomId(),
        timestamp: BigInt(Date.now()),
        versioned: { tag: 'v1', value: content },
      };
      const submitted = await session.submitRequestMessage(ChatMessageCodec, payload);
      if (submitted.isErr()) throw submitted.error;
    },
    dispose: () => {
      stopResponding();
      session.dispose();
    },
  };
};
