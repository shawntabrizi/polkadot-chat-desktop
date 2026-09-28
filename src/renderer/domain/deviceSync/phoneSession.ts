/**
 * M22b: the Statement Store session between this device and the phone, the
 * signalling path of device sync. Parameters as the phone's
 * `DevicesSessionManager.createSession` (Android ba3e15749, :60-111):
 *
 *   shared  = X25519(own device encryption key, peer device encryption key)
 *   topic   = SessionId(own statement account, peer statement account),
 *             listening on SessionId(peer, own), keyed by `shared`
 *   payload = ChaCha20-Poly1305(HKDF-SHA256(shared)), base-spec Request /
 *             Response, each Request element one SCALE `SyncSignalingEnvelope`
 *   size    = statements of at most 2 KB (`MAX_STATEMENT_SIZE`)
 *
 * The phone's device is its identity account (`RealOurDevicesProvider`: the
 * mobile device is `walletAccount.defaultAccountId()`), with the device
 * encryption key its pairing answer gave. This is the SDK's single-device
 * session, the one pairing and the identity channels already use; its
 * request and response channels keep ONE statement each, so the session
 * costs this device at most two live statements however often it signals.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import {
  type ExpiryAllocator,
  type StatementProver,
  type StatementStoreAdapter,
  createAccountId,
  createEncryption,
  createSession,
} from '@novasamatech/statement-store';

import { type SyncSignalingEnvelope, SyncSignalingEnvelopeCodec } from './codec';

/** Android `DevicesSessionManager.MAX_STATEMENT_SIZE`. */
export const PHONE_SESSION_MAX_STATEMENT = 2 * 1024;

export type SignalDevice = { statementAccountId: Uint8Array; encryptionPublicKey: Uint8Array };

export type SignalSession = {
  /** One request statement carrying these envelopes, in order (with any the peer has not acked). */
  send: (envelopes: SyncSignalingEnvelope[]) => Promise<void>;
  /** Envelopes of each new request, in order; of several Offers in one request only the last. */
  subscribe: (listener: (envelopes: SyncSignalingEnvelope[]) => void) => VoidFunction;
  dispose: VoidFunction;
};

/** mds.md "Data channel signaling": when one request holds several Offers, only the last counts. */
export const lastOfferOnly = (envelopes: SyncSignalingEnvelope[]): SyncSignalingEnvelope[] => {
  const last = envelopes.map(envelope => envelope.message.tag).lastIndexOf('Offer');
  return envelopes.filter((envelope, index) => envelope.message.tag !== 'Offer' || index === last);
};

export const createSignalSession = (params: {
  own: { statementAccountId: Uint8Array; encryptionPrivateKey: Uint8Array };
  peer: SignalDevice;
  prover: StatementProver;
  allocator: ExpiryAllocator;
  statementStore: StatementStoreAdapter;
}): SignalSession => {
  const shared = x25519.getSharedSecret(params.own.encryptionPrivateKey, params.peer.encryptionPublicKey);
  const session = createSession({
    localAccount: { accountId: createAccountId(params.own.statementAccountId), pin: undefined },
    remoteAccount: { accountId: createAccountId(params.peer.statementAccountId), publicKey: params.peer.encryptionPublicKey, pin: undefined },
    statementStore: params.statementStore,
    encryption: createEncryption(shared),
    prover: params.prover,
    allocator: params.allocator,
    sessionKey: shared,
    maxRequestSize: PHONE_SESSION_MAX_STATEMENT,
  });

  // Every request is answered, or the peer's session re-sends it for ever.
  const stopResponding = session.respondToRequests(SyncSignalingEnvelopeCodec, request => (request.payload.status === 'parsed' ? 'success' : 'decodingFailed'));
  const listeners = new Set<(envelopes: SyncSignalingEnvelope[]) => void>();
  // A request is read again after each reconnect of the store subscription; it is handled once.
  const seen = new Set<string>();
  const stopReading = session.subscribe(SyncSignalingEnvelopeCodec, messages => {
    const byRequest = new Map<string, SyncSignalingEnvelope[]>();
    for (const message of messages) {
      if (message.type !== 'request' || message.payload.status !== 'parsed' || seen.has(message.requestId)) continue;
      const list = byRequest.get(message.requestId) ?? [];
      list.push(message.payload.value);
      byRequest.set(message.requestId, list);
    }
    for (const [requestId, envelopes] of byRequest) {
      seen.add(requestId);
      const kept = lastOfferOnly(envelopes);
      for (const listener of listeners) listener(kept);
    }
  });

  return {
    send: async envelopes => {
      // Queued in one task, so the session puts them in one batch, in this order.
      const submitted = await Promise.all(envelopes.map(envelope => session.submitRequestMessage(SyncSignalingEnvelopeCodec, envelope)));
      const failed = submitted.find(result => result.isErr());
      if (failed?.isErr()) throw failed.error;
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      stopReading();
      stopResponding();
      listeners.clear();
      session.dispose();
    },
  };
};
