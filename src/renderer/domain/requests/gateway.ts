// Ported from polkadot-desktop src/domains/chat/p2p/requests/gateway.ts
// (`chatRequestGateway`). Differences are listed in docs/decisions.md: the inner
// sr25519 signature and the identity proof are verified here (the desktop
// verifies neither), and an outer `Bytes()` wrapper around the envelope is
// tolerated because bot-core emits one.

/**
 * Chat request send and receive.
 *
 * A request is one statement on the recipient's discovery topics (full + day)
 * with its own channel. The data is `EncryptedRemoteModel`: an ephemeral X25519
 * key plus the `RemoteModel` encrypted to the recipient's identity chat key.
 * Inside, the `RequestMessage` carries the sender's identity account, the
 * kHash identity proof and the sending device's X25519 key, signed by the
 * sending device's sr25519 statement account.
 *
 * Requests are addressed to the identity, so any device holding the identity
 * chat private key can read them. This is not a session channel: the statement
 * goes out through `signAndSubmitStatement` on its own channel and is never
 * acknowledged.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import {
  type ExpiryAllocator,
  type StatementStoreAdapter,
  createEncryption,
  createSr25519Prover,
  deriveSr25519PublicKey,
  khash,
  signAndSubmitStatement,
  signWithSr25519Secret,
  verifySr25519Signature,
} from '@novasamatech/statement-store';
import { compact } from 'scale-ts';

import { bytesEqual, bytesToHex, randomId } from '../../app/bytes';
import type { PeerDevice } from '../../app/database';

import { EncryptedRemoteModel, IDENTITY_PROOF_CONTEXT, IdentityProofPayload, ProofPayload, RemoteModel } from './codec';
import { computeAllPeerTopic, computeChannelTopic, computePaginationTopic, getCurrentDay } from './topics';

const RETRY_DELAYS_MS = [500, 1500, 3000];
const ENCRYPTION_KEY_BYTES = 32;
/** The chain delivers a statement once when it first appears; polling covers the rest. */
const POLL_INTERVAL_MS = 10_000;

export type SendChatRequestParams = {
  recipientAccountId: Uint8Array;
  recipientChatPublicKey: Uint8Array;
  senderIdentityAccountId: Uint8Array;
  senderIdentityChatPrivateKey: Uint8Array;
  senderDeviceEncryptionPublicKey: Uint8Array;
  senderDeviceSeed: Uint8Array;
  welcomeMessage: string | null;
  statementStore: StatementStoreAdapter;
  allocator: ExpiryAllocator;
};

export const sendChatRequest = async (params: SendChatRequestParams): Promise<{ requestId: string; timestamp: number }> => {
  const currentDay = getCurrentDay();
  if (!currentDay) throw new Error('current time is before the chat request epoch');

  // Envelope: ephemeral ECDH against the recipient's identity chat key.
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const envelopeSecret = x25519.getSharedSecret(ephemeralPrivateKey, params.recipientChatPublicKey);

  // Identity proof: keyed by the PERSISTENT identity-to-identity secret, not the
  // envelope secret, so the receiver can recompute it with its own chat key.
  const signer = deriveSr25519PublicKey(params.senderDeviceSeed);
  const identitySecret = x25519.getSharedSecret(params.senderIdentityChatPrivateKey, params.recipientChatPublicKey);
  const proof = khash(
    identitySecret,
    IdentityProofPayload.enc({
      identityAccountId: params.senderIdentityAccountId,
      statementAccountId: signer,
      context: IDENTITY_PROOF_CONTEXT,
    }),
  );

  const requestId = randomId();
  const timestamp = Date.now();
  const message = {
    messageId: requestId,
    timestamp: BigInt(timestamp),
    content: {
      tag: 'v2' as const,
      value: {
        identityProof: { identityAccountId: params.senderIdentityAccountId, proof },
        deviceEncPubKey: params.senderDeviceEncryptionPublicKey,
        pushToken: undefined,
        welcomeMessage: params.welcomeMessage ? { text: params.welcomeMessage, attachments: undefined } : undefined,
      },
    },
  };

  const signature = signWithSr25519Secret(
    params.senderDeviceSeed,
    ProofPayload.enc({ message, requestAcceptorId: params.recipientAccountId }),
  );
  const encrypted = createEncryption(envelopeSecret).encrypt(
    RemoteModel.enc({ message, proof: { tag: 'sr25519', value: { signature, signer } } }),
  );
  if (encrypted.isErr()) throw encrypted.error;

  const channel = computeChannelTopic(ephemeralPublicKey, envelopeSecret);
  const result = await signAndSubmitStatement({
    statementStore: params.statementStore,
    prover: createSr25519Prover(params.senderDeviceSeed),
    allocator: params.allocator,
    channel,
    topics: [
      computeAllPeerTopic(params.recipientAccountId),
      computePaginationTopic(params.recipientAccountId, currentDay.day),
      channel,
    ],
    data: EncryptedRemoteModel.enc({ encryptionPubKey: ephemeralPublicKey, encryptedData: encrypted.value }),
    retry: {
      attempts: 2,
      priorityAttempts: RETRY_DELAYS_MS.length,
      delaysMs: RETRY_DELAYS_MS,
      onRetry: ({ attempt, error }) => console.warn('[chat-request] submit retry %d: %s', attempt, error.message),
    },
  });
  if (result.isErr()) throw result.error;
  return { requestId, timestamp };
};

export type DecodedChatRequest = {
  requestId: string;
  timestamp: number;
  welcomeMessage: string | null;
  /** The sender's identity account (V2) or its signer (V1, no identity proof). */
  senderIdentityAccountId: Uint8Array;
  /** V2 only; V1 requests carry no identity proof and cannot be verified. */
  identityProof: Uint8Array | null;
  /** V2 only: the device to address for multi-device transport. */
  senderDevice: PeerDevice | null;
};

// bot-core wraps the envelope in one more `Bytes()`; the apps do not. A raw
// envelope starts with compact(32) followed by the key, so reading a `Bytes()`
// prefix that spans exactly the whole payload identifies the wrapped form.
const unwrapOuterBytes = (data: Uint8Array): Uint8Array => {
  try {
    const length = Number(compact.dec(data));
    const prefix = compact.enc(length).length;
    if (prefix + length === data.length && length !== ENCRYPTION_KEY_BYTES) return data.slice(prefix);
  } catch {
    // not a compact prefix: fall through to the raw form
  }
  return data;
};

/**
 * Decrypt a request addressed to `ownAccountId` and check the inner signature.
 * `null` for anything that is not a request to us (other recipients share no
 * topic, so in practice: wrong key, corrupt data, or a forged signature).
 */
export const decodeChatRequest = (
  data: Uint8Array,
  ownAccountId: Uint8Array,
  ownIdentityChatPrivateKey: Uint8Array,
): DecodedChatRequest | null => {
  try {
    const envelope = EncryptedRemoteModel.dec(unwrapOuterBytes(data));
    if (envelope.encryptionPubKey.length !== ENCRYPTION_KEY_BYTES) return null;
    const secret = x25519.getSharedSecret(ownIdentityChatPrivateKey, envelope.encryptionPubKey);
    const plain = createEncryption(secret).decrypt(envelope.encryptedData);
    if (plain.isErr()) return null;

    const remote = RemoteModel.dec(plain.value);
    if (remote.proof.tag !== 'sr25519') {
      console.warn('[chat-request] unsupported proof type', remote.proof.tag);
      return null;
    }
    const payload = ProofPayload.enc({ message: remote.message, requestAcceptorId: ownAccountId });
    if (!verifySr25519Signature(payload, remote.proof.value.signature, remote.proof.value.signer)) {
      console.warn('[chat-request] dropped a request with a bad device signature');
      return null;
    }

    const { content } = remote.message;
    const base = {
      requestId: remote.message.messageId,
      timestamp: Number(remote.message.timestamp),
      welcomeMessage: content.value.welcomeMessage?.text ?? null,
    };
    if (content.tag === 'v1') {
      return { ...base, senderIdentityAccountId: remote.proof.value.signer, identityProof: null, senderDevice: null };
    }
    return {
      ...base,
      senderIdentityAccountId: content.value.identityProof.identityAccountId,
      identityProof: content.value.identityProof.proof,
      senderDevice: {
        statementAccountId: remote.proof.value.signer,
        encryptionPublicKey: content.value.deviceEncPubKey,
      },
    };
  } catch (error) {
    console.warn('[chat-request] failed to decode a request', error);
    return null;
  }
};

/**
 * mds.md: the acceptor MUST verify `proof == kHash(K(B,A), payload)` with the
 * sender's CURRENT on-chain identity chat key, so a rotated key bans the
 * devices that only know the old one.
 */
export const verifyIdentityProof = (
  request: DecodedChatRequest,
  ownIdentityChatPrivateKey: Uint8Array,
  senderIdentityChatPublicKey: Uint8Array,
): boolean => {
  if (!request.identityProof || !request.senderDevice) return false;
  const secret = x25519.getSharedSecret(ownIdentityChatPrivateKey, senderIdentityChatPublicKey);
  const expected = khash(
    secret,
    IdentityProofPayload.enc({
      identityAccountId: request.senderIdentityAccountId,
      statementAccountId: request.senderDevice.statementAccountId,
      context: IDENTITY_PROOF_CONTEXT,
    }),
  );
  return bytesEqual(expected, request.identityProof);
};

/**
 * Watch the identity's discovery topics. Every statement is handed over once
 * (by data bytes); the caller dedups by request id. A live subscription is
 * combined with a poll because the chain delivers a statement only when it
 * first appears on a topic, and the day topic rolls over at midnight UTC.
 */
export const subscribeToIncomingRequests = (
  params: { ownAccountId: Uint8Array; statementStore: StatementStoreAdapter; pollIntervalMs?: number },
  onStatementData: (data: Uint8Array) => void,
): VoidFunction => {
  const { ownAccountId, statementStore, pollIntervalMs = POLL_INTERVAL_MS } = params;
  const allPeerTopic = computeAllPeerTopic(ownAccountId);
  const seen = new Set<string>();

  const handle = (data: Uint8Array | undefined) => {
    if (!data) return;
    const key = bytesToHex(data);
    if (seen.has(key)) return;
    seen.add(key);
    onStatementData(data);
  };

  const topics = () => {
    const day = getCurrentDay();
    return day ? [allPeerTopic, computePaginationTopic(ownAccountId, day.day)] : [allPeerTopic];
  };

  const poll = () =>
    statementStore.queryStatements({ matchAny: topics() }).match(
      statements => statements.forEach(statement => handle(statement.data)),
      error => console.warn('[chat-request] poll failed: %s', error.message),
    );

  const unsubscribe = statementStore.subscribeStatements({ matchAny: topics() }, page =>
    page.statements.forEach(statement => handle(statement.data)),
  );
  void poll();
  const timer = setInterval(() => void poll(), pollIntervalMs);

  return () => {
    clearInterval(timer);
    unsubscribe();
  };
};
