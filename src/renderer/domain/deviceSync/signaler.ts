// Ported from .refs/polkadot-desktop src/domains/device-sync/signaler.ts on
// 2026-09-28; changes: the `PeerLink` and `SignalSession` seams in place of
// its PeerConnection and DeviceSessionChannel, timers in place of rxjs.

/**
 * M22b: one WebRTC connection attempt with the phone, signalled over the
 * Statement Store session. The rules are the phone's
 * (`SyncPeerChannelSignaling.kt`, `DeviceSyncEngine.kt`):
 *
 * - The device with the smaller statement account (unsigned bytes) is the
 *   initiator. It mints an `offerId` (a UUID) for its Offer; the acceptor
 *   adopts the Offer's id and answers with it. Answers and candidates of
 *   another id are dropped: the store hands old ones to a new subscriber.
 * - The first candidates (up to 4, or what 500 ms gathered) ride the Offer
 *   or the Answer inside `MinimalSetup`; later ones trickle as `Candidates`.
 * - `Reconnected(lastOfferId)` goes once per start when an id was saved: in
 *   the same request as the initiator's new Offer, alone from an acceptor.
 *   A matching `Reconnected`, or an Offer with a new id, asks the engine for
 *   a new attempt (`onReset`).
 */

import type { SyncSignalingEnvelope } from './codec';
import type { PeerLink } from './link';
import type { SignalSession } from './phoneSession';
import { type LocalCandidate, decodeCandidates, decodeSetup, encodeCandidates, encodeSetup } from './sdp';

export const ICE_BATCH_SIZE = 4;
export const ICE_BATCH_WINDOW_MS = 500;

export type SignalerRole = 'initiator' | 'acceptor';

export type Signaler = { offerId: () => string | null; close: VoidFunction };

/** Android `DeviceSyncEngine.isInitiator`: unsigned byte compare, the smaller one initiates. */
export const isInitiator = (own: Uint8Array, peer: Uint8Array): boolean => {
  for (let i = 0; i < Math.min(own.length, peer.length); i++) {
    if (own[i] !== peer[i]) return (own[i] ?? 0) < (peer[i] ?? 0);
  }
  return own.length < peer.length;
};

const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** Android `pairSessionId`: the id both ends log for this pair, smaller account first. */
export const pairSessionId = (own: Uint8Array, peer: Uint8Array): string =>
  isInitiator(own, peer) ? `device-sync:${hex(own)}:${hex(peer)}` : `device-sync:${hex(peer)}:${hex(own)}`;

/** Collects candidates into batches of 4 or 500 ms, whichever comes first; the first batch may be empty. */
const batchCandidates = (link: PeerLink, onBatch: (batch: LocalCandidate[], first: boolean) => void): VoidFunction => {
  let batch: LocalCandidate[] = [];
  let first = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const out = batch;
    batch = [];
    const wasFirst = first;
    first = false;
    onBatch(out, wasFirst);
  };
  // The first window opens now, so a peer that gathers nothing still answers.
  timer = setTimeout(flush, ICE_BATCH_WINDOW_MS);
  const stop = link.onLocalCandidate(candidate => {
    batch.push(candidate);
    if (batch.length >= ICE_BATCH_SIZE) flush();
    else timer ??= setTimeout(flush, ICE_BATCH_WINDOW_MS);
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
};

export const startSignaler = (params: {
  session: SignalSession;
  link: PeerLink;
  role: SignalerRole;
  /** A saved offerId from an earlier run: the peer may still hold that attempt. */
  reconnectOfferId?: string;
  /** The acceptor adopted an Offer, or the initiator got its Answer: save the id. */
  onAcceptedOfferId?: (offerId: string) => void;
  onReset: VoidFunction;
  newOfferId?: () => string;
}): Signaler => {
  const { session, link, role } = params;
  let offerId: string | null = role === 'initiator' ? (params.newOfferId ?? (() => crypto.randomUUID()))() : null;
  let closed = false;
  let resetAsked = false;
  const stops: VoidFunction[] = [];

  const reset = () => {
    if (resetAsked || closed) return;
    resetAsked = true;
    params.onReset();
  };

  const warn = (what: string) => (error: unknown) => {
    if (!closed) console.warn('[device-sync] %s failed: %s', what, error instanceof Error ? error.message : String(error));
  };

  /** Resolves with the first batch; later batches trickle as `Candidates` of the current attempt. */
  const gather = (): Promise<LocalCandidate[]> =>
    new Promise(resolve => {
      stops.push(
        batchCandidates(link, (batch, first) => {
          if (first) return resolve(batch);
          if (batch.length === 0 || offerId === null || closed) return;
          session.send([{ offerId, message: { tag: 'Candidates', value: { candidates: encodeCandidates(batch) } } }]).catch(warn('candidates'));
        }),
      );
    });

  const sendOffer = async (id: string) => {
    // Gathering starts with the offer, so the first window covers it.
    const gathered = gather();
    const sdp = await link.createOffer();
    const setup = encodeSetup(sdp, await gathered);
    if (closed) return;
    const envelopes: SyncSignalingEnvelope[] = [];
    if (params.reconnectOfferId !== undefined) envelopes.push({ offerId: params.reconnectOfferId, message: { tag: 'Reconnected', value: undefined } });
    envelopes.push({ offerId: id, message: { tag: 'Offer', value: { sdp: setup } } });
    await session.send(envelopes);
  };

  const sendAnswer = async (id: string) => {
    const gathered = gather();
    const sdp = await link.createAnswer();
    const setup = encodeSetup(sdp, await gathered);
    if (closed) return;
    await session.send([{ offerId: id, message: { tag: 'Answer', value: { sdp: setup } } }]);
  };

  const addCandidates = async (candidates: ReturnType<typeof decodeCandidates>) => {
    for (const candidate of candidates) {
      if (closed) return;
      // One bad or duplicate candidate must not stop the rest.
      await link.addRemoteCandidate(candidate).catch(warn('remote candidate'));
    }
  };

  const handle = async (envelope: SyncSignalingEnvelope): Promise<void> => {
    if (closed) return;
    const message = envelope.message;
    switch (message.tag) {
      case 'Reconnected':
        if (offerId !== null && envelope.offerId === offerId) reset();
        return;
      case 'Offer': {
        if (role !== 'acceptor') return;
        if (offerId === null) {
          // Adopted before answering, so candidates gathered meanwhile carry this id.
          offerId = envelope.offerId;
          params.onAcceptedOfferId?.(offerId);
          const setup = decodeSetup(message.value.sdp);
          await link.applyRemote('offer', setup.sdp);
          await addCandidates(setup.candidates);
          if (!closed) await sendAnswer(offerId);
          return;
        }
        // The same attempt read again: never applied twice. A new id: the initiator restarted.
        if (envelope.offerId !== offerId) reset();
        return;
      }
      case 'Answer': {
        if (role !== 'initiator' || envelope.offerId !== offerId || link.signalingState() !== 'have-local-offer') return;
        const setup = decodeSetup(message.value.sdp);
        await link.applyRemote('answer', setup.sdp);
        await addCandidates(setup.candidates);
        params.onAcceptedOfferId?.(envelope.offerId);
        return;
      }
      case 'Candidates':
        if (envelope.offerId !== offerId) return;
        await addCandidates(decodeCandidates(message.value.candidates));
        return;
    }
  };

  // One at a time: two Offers applied at once break the connection's state machine.
  let queue: Promise<void> = Promise.resolve();
  stops.push(
    session.subscribe(envelopes => {
      for (const envelope of envelopes) queue = queue.then(() => handle(envelope)).catch(warn(`incoming ${envelope.message.tag}`));
    }),
  );

  if (role === 'initiator' && offerId !== null) void sendOffer(offerId).catch(warn('offer'));
  else if (params.reconnectOfferId !== undefined) {
    session.send([{ offerId: params.reconnectOfferId, message: { tag: 'Reconnected', value: undefined } }]).catch(warn('reconnected'));
  }

  return {
    offerId: () => offerId,
    close: () => {
      closed = true;
      for (const stop of stops) stop();
      link.close();
    },
  };
};
