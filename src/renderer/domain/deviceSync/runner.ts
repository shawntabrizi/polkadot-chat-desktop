/**
 * M22b: the sync protocol over an open data channel, as the phone's
 * `DeviceSyncRunner.kt` runs it:
 *
 * - every frame is `DataChannelMessage { id, data }`; sync is id
 *   `device-sync`, a `SyncMessage` inside;
 * - an incoming `Update` is applied, then answered with `Ack(id)`;
 * - outgoing: collect what changed since the last acknowledged `timePoint`,
 *   send it as one or more `Update`s (each under 60 KB, the SCTP limit the
 *   spec warns about), one at a time, and move the checkpoint only when all
 *   are acknowledged. No ack in 30 s: the checkpoint stays and the round is
 *   tried again (the receiver ignores what it already has);
 * - ICE candidates the phone trickles after the channel opened arrive on
 *   `webrtc_renegotiation_internal_use_case` (`PeerChannelConnection.kt`
 *   sends them there once the channel is open); they go to the link.
 */

import {
  DEVICE_SYNC_USE_CASE,
  DataChannelMessageCodec,
  PeerConnectionSignalCodec,
  RENEGOTIATION_USE_CASE,
  type SyncEntity,
  SyncEntityCodec,
  SyncMessageCodec,
  type SyncUpdate,
} from './codec';
import type { DataPort } from './link';
import type { RemoteCandidate } from './sdp';

/** Android `DeviceSyncRunner.ACK_TIMEOUT`. */
export const ACK_TIMEOUT_MS = 30_000;
/** Spec: an update SHOULD stay under the data channel's 64 KB; 60 KB leaves room for the envelopes. */
export const MAX_UPDATE_BYTES = 60 * 1024;

export type SyncBookkeeping = {
  readCheckpoint: () => Promise<number>;
  writeCheckpoint: (timePoint: number) => Promise<void>;
  /** The next `SyncUpdate.id`: persisted, only grows (the phone drops repeated ids). */
  nextUpdateId: () => Promise<number>;
};

export type SyncRunner = {
  /** Something changed here: a round runs (or runs again after the current one). */
  push: VoidFunction;
  stop: VoidFunction;
};

type Item = { entity: SyncEntity['tag']; value: unknown; size: number };

/** Splits the entity lists so each update stays under `limit` bytes; order kept, one entity kind per piece. */
export const chunkEntities = (entities: SyncEntity[], limit = MAX_UPDATE_BYTES): SyncEntity[][] => {
  const chunks: SyncEntity[][] = [];
  let current: SyncEntity[] = [];
  let size = 0;
  for (const entity of entities) {
    const items: Item[] = (entity.value as unknown[]).map(value => ({
      entity: entity.tag,
      value,
      size: SyncEntityCodec.enc({ tag: entity.tag, value: [value] } as SyncEntity).length,
    }));
    let bucket: unknown[] = [];
    const close = () => {
      if (bucket.length === 0) return;
      current.push({ tag: entity.tag, value: bucket } as SyncEntity);
      bucket = [];
    };
    for (const item of items) {
      if (size + item.size > limit && (bucket.length > 0 || current.length > 0)) {
        close();
        chunks.push(current);
        current = [];
        size = 0;
      }
      bucket.push(item.value);
      size += item.size;
    }
    close();
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

export const runSync = (deps: {
  port: DataPort;
  collect: (since: number) => Promise<SyncEntity[]>;
  apply: (update: SyncUpdate) => Promise<void>;
  bookkeeping: SyncBookkeeping;
  onRemoteCandidates?: (candidates: RemoteCandidate[]) => void;
  /** An update went either way. */
  onActivity?: VoidFunction;
  now?: () => number;
  ackTimeoutMs?: number;
}): SyncRunner => {
  const now = deps.now ?? Date.now;
  const ackTimeout = deps.ackTimeoutMs ?? ACK_TIMEOUT_MS;
  let stopped = false;
  let running = false;
  let again = false;
  let inFlight: { id: number; resolve: (acked: boolean) => void } | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const send = (bytes: Uint8Array) => deps.port.send(DataChannelMessageCodec.enc({ id: DEVICE_SYNC_USE_CASE, data: bytes }));

  const awaitAck = (id: number): Promise<boolean> =>
    new Promise(resolve => {
      const timer = setTimeout(() => {
        inFlight = null;
        resolve(false);
      }, ackTimeout);
      inFlight = {
        id,
        resolve: acked => {
          clearTimeout(timer);
          inFlight = null;
          resolve(acked);
        },
      };
    });

  const round = async (): Promise<void> => {
    const checkpoint = await deps.bookkeeping.readCheckpoint();
    // Taken before collecting, so the next checkpoint covers exactly what was read.
    const timePoint = now();
    const entities = await deps.collect(checkpoint);
    for (const chunk of chunkEntities(entities)) {
      if (stopped) return;
      const id = await deps.bookkeeping.nextUpdateId();
      const acked = awaitAck(id);
      send(SyncMessageCodec.enc({ tag: 'Update', value: { id, entities: chunk, timePoint: BigInt(timePoint) } }));
      if (!(await acked)) {
        if (!stopped) console.warn('[device-sync] no ack for update %d in %d ms; trying again', id, ackTimeout);
        again = true;
        return;
      }
      deps.onActivity?.();
    }
    // Also when nothing was sent: the empty window is not read again.
    if (!stopped) await deps.bookkeeping.writeCheckpoint(timePoint);
  };

  const push = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    again = false;
    void round()
      .catch(error => console.warn('[device-sync] sync round failed', error))
      .finally(() => {
        running = false;
        if (again && !stopped) retry = setTimeout(push, 0);
      });
  };

  // Updates apply one after another, each acknowledged after it applied.
  let applying: Promise<void> = Promise.resolve();
  const onSync = (bytes: Uint8Array) => {
    let message: ReturnType<typeof SyncMessageCodec.dec>;
    try {
      message = SyncMessageCodec.dec(bytes);
    } catch (error) {
      console.warn('[device-sync] undecodable sync message (%d bytes)', bytes.length, error);
      return;
    }
    if (message.tag === 'Ack') {
      if (inFlight?.id === message.value.id) inFlight.resolve(true);
      return;
    }
    const update = message.value;
    applying = applying
      .then(() => deps.apply(update))
      .then(() => {
        if (stopped) return;
        send(SyncMessageCodec.enc({ tag: 'Ack', value: { id: update.id } }));
        deps.onActivity?.();
      })
      .catch(error => console.warn('[device-sync] update %d not applied', update.id, error));
  };

  const stopFrames = deps.port.onFrame(frame => {
    if (stopped) return;
    let envelope: ReturnType<typeof DataChannelMessageCodec.dec>;
    try {
      envelope = DataChannelMessageCodec.dec(frame);
    } catch {
      return;
    }
    if (envelope.id === DEVICE_SYNC_USE_CASE) onSync(envelope.data);
    else if (envelope.id === RENEGOTIATION_USE_CASE && deps.onRemoteCandidates) {
      try {
        const signal = PeerConnectionSignalCodec.dec(envelope.data);
        if (signal.tag === 'candidates') {
          deps.onRemoteCandidates(signal.value.map(c => ({ candidate: c.sdp, sdpMid: c.sdpMid ?? '0', sdpMLineIndex: c.sdpMLineIndex })));
        }
      } catch {
        // A renegotiation offer or answer: media, which sync never uses.
      }
    }
  });

  push();

  return {
    push,
    stop: () => {
      stopped = true;
      stopFrames();
      if (retry) clearTimeout(retry);
      inFlight?.resolve(false);
    },
  };
};
