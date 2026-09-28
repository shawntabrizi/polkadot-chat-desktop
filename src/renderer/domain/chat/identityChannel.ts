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

import { x25519 } from '@noble/curves/ed25519.js';
import {
  type ExpiryAllocator,
  type StatementProver,
  type StatementStoreAdapter,
  type Statement,
  StatementData,
  createAccountId,
  createEncryption,
  createSession,
  createSessionId,
} from '@novasamatech/statement-store';

import { bytesToHex, randomId } from '../../app/bytes';
import type { PeerDevice } from '../../app/database';

import { type ChatContent, ChatMessageCodec, type ChatMessageWire, type IdentityChannelEvent, toIdentityChannelEvent } from './identityEvents';

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
  // Spec 0013 (as pca keys it): a `capabilities` on the identity session is the
  // set of the device the same batch accepted with. A batch arrives message by
  // message in one task, so a set waits one turn for its batch's accept.
  const acceptedIn = new Map<string, Uint8Array>();

  // Answering is also what opens the store subscription, so every incoming
  // statement is both delivered and acknowledged from here.
  const stopResponding = session.respondToRequests(ChatMessageCodec, request => {
    if (request.payload.status !== 'parsed') return 'decodingFailed';
    const message = request.payload.value;
    // A batch extended by a later message is a new request that repeats the accept: note it for every request it is in.
    const content = message.versioned.value;
    if (content.tag === 'deviceChatAccepted') acceptedIn.set(request.requestId, content.value.device.statementAccountId);
    if (!seen.has(message.messageId)) {
      seen.add(message.messageId);
      const event = toIdentityChannelEvent(message);
      if (event?.tag === 'message' && event.content.tag === 'capabilities') {
        setTimeout(() => {
          const device = acceptedIn.get(request.requestId);
          params.onEvent(device ? { ...event, device } : event);
        }, 0);
      } else if (event) params.onEvent(event);
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

/**
 * mds.md "Accepting a Chat Request": the device that accepts posts
 * `DeviceChatAccepted` on the identity session SessionId(B, A), keyed
 * K(A, B) = ECDH(EPk(B), EPb(A)). Every device of B holds EPk(B), so this
 * device can read what ANOTHER of our devices (the phone) posted there, on
 * our own outgoing topic, which the channel above never listens to.
 *
 * Read only: nothing is answered (an answer would go on the peer's topic as
 * if from us). Only statements signed by one of `ownSigners` count: the peer
 * holds K(A, B) too, and must not be able to accept its own request for us.
 */
export const watchOwnAccepts = (params: {
  ownIdentityAccountId: Uint8Array;
  ownIdentityChatPrivateKey: Uint8Array;
  peerIdentityAccountId: Uint8Array;
  peerIdentityChatPublicKey: Uint8Array;
  /** Our devices' statement accounts (the phone, this device). */
  ownSigners: readonly Uint8Array[];
  /** Checks a statement's proof (any prover verifies any signer). */
  prover: StatementProver;
  statementStore: StatementStoreAdapter;
  onAccepted: (accepted: { requestId: string; device: PeerDevice; timestamp: number }) => void;
}): VoidFunction => {
  const sharedSecret = x25519.getSharedSecret(params.ownIdentityChatPrivateKey, params.peerIdentityChatPublicKey);
  const topic = createSessionId(
    sharedSecret,
    { accountId: createAccountId(params.ownIdentityAccountId), pin: undefined },
    { accountId: createAccountId(params.peerIdentityAccountId), pin: undefined },
  );
  const encryption = createEncryption(sharedSecret);
  const signers = new Set(params.ownSigners.map(bytesToHex));
  const seenStatements = new Set<string>();
  const seenMessages = new Set<string>();
  let stopped = false;

  const handle = async (statement: Statement): Promise<void> => {
    const { data, proof } = statement;
    if (!data || proof?.type !== 'sr25519') return;
    const key = bytesToHex(data);
    if (seenStatements.has(key)) return;
    seenStatements.add(key);
    if (!signers.has(String(proof.value.signer).toLowerCase() as `0x${string}`)) return;
    const verified = await params.prover.verifyMessageProof(statement);
    if (stopped || !verified.isOk() || !verified.value) return;
    const decrypted = encryption.decrypt(data);
    if (decrypted.isErr()) return;
    let body: ReturnType<typeof StatementData.dec>;
    try {
      body = StatementData.dec(decrypted.value);
    } catch {
      return;
    }
    if (body.tag !== 'request') return;
    for (const bytes of body.value.data) {
      let message: ChatMessageWire;
      try {
        message = ChatMessageCodec.dec(bytes);
      } catch {
        continue;
      }
      if (seenMessages.has(message.messageId)) continue;
      seenMessages.add(message.messageId);
      const content = message.versioned.value;
      if (content.tag !== 'deviceChatAccepted') continue;
      params.onAccepted({ requestId: content.value.requestId, device: content.value.device, timestamp: Number(message.timestamp) });
    }
  };
  const take = (statements: Statement[]) => {
    for (const statement of statements) void handle(statement).catch(error => console.warn('[chat] own accept not read', error));
  };

  const unsubscribe = params.statementStore.subscribeStatements({ matchAll: [topic] }, page => take(page.statements));
  void params.statementStore.queryStatements({ matchAll: [topic] }).match(take, error => console.warn('[chat] own accept query failed: %s', error.message));
  return () => {
    stopped = true;
    unsubscribe();
  };
};
