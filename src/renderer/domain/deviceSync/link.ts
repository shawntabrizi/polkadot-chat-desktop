/**
 * M22b: the WebRTC side of device sync as the signaler and the engine see
 * it. `rtcLink.ts` implements it over `RTCPeerConnection` (Electron and
 * browsers); `testing/loopback.ts` implements it in memory for node, which
 * has no WebRTC.
 */

import type { LocalCandidate, RemoteCandidate } from './sdp';

/** An open data channel: raw frames (each one SCALE `DataChannelMessage`). */
export type DataPort = {
  send: (frame: Uint8Array) => void;
  onFrame: (listener: (frame: Uint8Array) => void) => VoidFunction;
  /** Fires once when the channel or its connection ends. */
  onClose: (listener: VoidFunction) => VoidFunction;
  close: VoidFunction;
};

export type PeerLink = {
  /** Creates the offer and sets it as the local description; the SDP text. */
  createOffer: () => Promise<string>;
  createAnswer: () => Promise<string>;
  applyRemote: (type: 'offer' | 'answer', sdp: string) => Promise<void>;
  /** `have-local-offer` while an initiator waits for its answer. */
  signalingState: () => string;
  addRemoteCandidate: (candidate: RemoteCandidate) => Promise<void>;
  onLocalCandidate: (listener: (candidate: LocalCandidate) => void) => VoidFunction;
  /** Resolves when the data channel opens. */
  opened: Promise<DataPort>;
  /** Fires once when the connection fails or closes before or after it opened. */
  onFailed: (listener: VoidFunction) => VoidFunction;
  close: VoidFunction;
};

/** The initiator creates the data channel (Android `InitiatorConnection`: label `dataChannel`). */
export type PeerLinkFactory = (role: 'initiator' | 'acceptor') => PeerLink;

export const DATA_CHANNEL_LABEL = 'dataChannel';
