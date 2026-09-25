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

import { x25519 } from '@noble/curves/ed25519.js';
import {
  type DeviceTarget,
  type Encryption,
  type ExpiryAllocator,
  type PeerRoster,
  Request,
  type Statement,
  StatementData,
  type StatementProver,
  type StatementStoreAdapter,
  createAccountId,
  createEncryption,
  createEnvelope,
  createMultiDeviceSession,
  createSessionId,
} from '@novasamatech/statement-store';

import { bytesToHex } from '../../app/bytes';

import type { DeviceKeys } from '../device/keys';
import type { UserIdentity } from '../identity/userIdentity';

import { isAccountFullStop } from './accountSpace';
import { type ChatContent, ChatMessageCodec, type ChatMessageWire } from './identityEvents';

/**
 * `device`: the statement account of the peer device that sent it (spec 0013
 * keys capabilities by it); absent on the identity channel and when unknown.
 */
export type IncomingChatMessage = { messageId: string; timestamp: number; content: ChatContent; device?: Uint8Array };

/** How many request ids the sender map keeps per session (a batch repeats its id until acked). */
const SENDER_MEMORY = 512;

/**
 * Spec 0013 needs the device that sent a message; the SDK's `RequestMessage`
 * (0.10.2) does not say it. The statement does: each peer device writes on
 * its own topic `SessionId(D(B'), A)` (mds.md), keyed by
 * `x25519(ownIdentityChatPrivate, D(B').encryptionPublic)`, and signs with
 * its statement account. This wraps the adapter the session reads through:
 * each incoming statement is matched to a roster device by its topic, opened
 * with that device's key (the SDK opens it again after), and its request id
 * is mapped to the device. The SDK decodes asynchronously, so the map is
 * written before the message is delivered. A statement whose proof names
 * another signer is not attributed.
 */
export const createSenderTracker = (params: {
  ownIdentityAccountId: Uint8Array;
  ownIdentityChatPrivateKey: Uint8Array;
  ownStatementAccountId: Uint8Array;
  ownEncryptionPrivateKey: Uint8Array;
  roster: () => DeviceTarget[];
}) => {
  const envelope = createEnvelope({ ownStatementAccountId: params.ownStatementAccountId, ownEncryptionPrivateKey: params.ownEncryptionPrivateKey });
  const local = { accountId: createAccountId(params.ownIdentityAccountId), pin: undefined };
  type Spec = { device: DeviceTarget; encryption: Encryption };
  let cached: { devices: DeviceTarget[]; specs: Map<string, Spec> } | null = null;
  const specs = (): Map<string, Spec> => {
    const devices = params.roster();
    if (cached?.devices === devices) return cached.specs;
    const map = new Map<string, Spec>();
    for (const device of devices) {
      try {
        const secret = x25519.getSharedSecret(params.ownIdentityChatPrivateKey, device.encryptionPublicKey);
        const topic = createSessionId(secret, { accountId: createAccountId(device.statementAccountId), pin: undefined }, local);
        map.set(bytesToHex(topic).toLowerCase(), { device, encryption: createEncryption(secret) });
      } catch {
        // A malformed roster entry: the SDK skips it too.
      }
    }
    cached = { devices, specs: map };
    return map;
  };
  const senders = new Map<string, Uint8Array>();

  const requestIdOf = (spec: Spec, data: Uint8Array): string | null => {
    const plain = spec.encryption.decrypt(data);
    if (plain.isErr()) return null;
    try {
      const decoded = StatementData.dec(plain.value);
      if (decoded.tag === 'request') return decoded.value.requestId;
      if (decoded.tag !== 'multiRequest') return null;
      const inner = envelope.unwrapForOwnDevice(decoded.value.encryptedRequest, decoded.value.devicesInfo, spec.device.encryptionPublicKey);
      return inner.isOk() ? Request.dec(inner.value).requestId : null;
    } catch {
      return null;
    }
  };

  const note = (statement: Statement): void => {
    if (!statement.data) return;
    const all = specs();
    const spec = (statement.topics ?? []).map(topic => all.get(String(topic).toLowerCase())).find(found => found !== undefined);
    if (!spec) return;
    const signer = (statement.proof as { value?: { signer?: Uint8Array | string } } | undefined)?.value?.signer;
    if (signer !== undefined) {
      const hex = typeof signer === 'string' ? signer.toLowerCase() : bytesToHex(signer).toLowerCase();
      if (hex !== bytesToHex(spec.device.statementAccountId).toLowerCase()) return;
    }
    const requestId = requestIdOf(spec, statement.data);
    if (requestId === null) return;
    senders.delete(requestId);
    senders.set(requestId, spec.device.statementAccountId);
    if (senders.size > SENDER_MEMORY) senders.delete(senders.keys().next().value as string);
  };

  return {
    /** The device that sent request `requestId`, if one of its statements was seen. */
    senderOf: (requestId: string): Uint8Array | undefined => senders.get(requestId),
    /** The adapter to hand the session: reads note each statement first; submits pass through. */
    wrap: (store: StatementStoreAdapter): StatementStoreAdapter => ({
      queryStatements: (filter, destination) =>
        store.queryStatements(filter, destination).map(statements => {
          for (const statement of statements) note(statement);
          return statements;
        }),
      subscribeStatements: (filter, callback) =>
        store.subscribeStatements(filter, page => {
          for (const statement of page.statements) note(statement);
          return callback(page);
        }),
      submitStatement: statement => store.submitStatement(statement),
    }),
  };
};

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
  /**
   * The store refused the batch for good (`AccountFullStop`, accountSpace.ts).
   * Other errors do not come here: dispose also rejects the waiters.
   */
  onFailed?: (messageId: string, error: Error) => void;
};

export type PeerSession = {
  /** Resolves once the session queued the message; rejects when it can never go out. */
  send: (content: ChatContent, ids: { messageId: string; timestamp: number }) => Promise<void>;
  dispose: VoidFunction;
};

export const createPeerSession = (params: PeerSessionParams): PeerSession => {
  const senders = createSenderTracker({
    ownIdentityAccountId: params.identity.identityAccountId,
    ownIdentityChatPrivateKey: params.identity.identityChatPrivateKey,
    ownStatementAccountId: params.deviceKeys.statementAccountPublicKey,
    ownEncryptionPrivateKey: params.deviceKeys.encryptionPrivateKey,
    roster: () => params.peerRoster.current(),
  });
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
    statementStore: senders.wrap(params.statementStore),
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
      const device = senders.senderOf(message.requestId);
      params.onMessage({ messageId: wire.messageId, timestamp: Number(wire.timestamp), content: wire.versioned.value, ...(device ? { device } : {}) });
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
        error => {
          const failure: unknown = error;
          if (isAccountFullStop(failure)) params.onFailed?.(ids.messageId, failure);
          else console.warn('[peer-session] no ack for %s: %s', ids.messageId, error.message);
        },
      );
    },
    dispose: () => {
      stopResponding();
      unsubscribe();
      session.dispose();
    },
  };
};
