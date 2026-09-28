// Ported from .refs/polkadot-desktop src/shared/peer-channel/peerConnection.ts
// on 2026-09-28; changes: the `PeerLink` shape, no rxjs, no TURN (Google
// STUN only, as the phone uses when its TURN fetch fails).

/**
 * M22b: `PeerLink` over the platform's `RTCPeerConnection` (Electron's
 * renderer and every browser have it; node does not). Data channel only.
 */

import { DATA_CHANNEL_LABEL, type DataPort, type PeerLink, type PeerLinkFactory } from './link';

/** The STUN servers the phone configures (`PeerChannelConnection.kt`). */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302', 'stun:stun4.l.google.com:19302'] },
];

const portOf = (channel: RTCDataChannel, connection: RTCPeerConnection): DataPort => {
  channel.binaryType = 'arraybuffer';
  const closes = new Set<VoidFunction>();
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    for (const listener of closes) listener();
  };
  channel.addEventListener('close', fireClose);
  connection.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) fireClose();
  });
  return {
    send: frame => channel.send(frame.slice().buffer),
    onFrame: listener => {
      const handler = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) listener(new Uint8Array(event.data));
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
    onClose: listener => {
      closes.add(listener);
      return () => closes.delete(listener);
    },
    close: () => channel.close(),
  };
};

export const createRtcLink = (role: 'initiator' | 'acceptor'): PeerLink => {
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const failures = new Set<VoidFunction>();
  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed' || connection.connectionState === 'closed') for (const listener of failures) listener();
  });
  const opened = new Promise<DataPort>(resolve => {
    const wire = (channel: RTCDataChannel) => {
      if (channel.readyState === 'open') resolve(portOf(channel, connection));
      else channel.addEventListener('open', () => resolve(portOf(channel, connection)), { once: true });
    };
    if (role === 'initiator') wire(connection.createDataChannel(DATA_CHANNEL_LABEL));
    else connection.addEventListener('datachannel', event => wire(event.channel));
  });

  return {
    createOffer: async () => {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      return offer.sdp ?? '';
    },
    createAnswer: async () => {
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      return answer.sdp ?? '';
    },
    applyRemote: (type, sdp) => connection.setRemoteDescription({ type, sdp }),
    signalingState: () => connection.signalingState,
    addRemoteCandidate: candidate => connection.addIceCandidate(candidate),
    onLocalCandidate: listener => {
      const handler = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) listener(event.candidate);
      };
      connection.addEventListener('icecandidate', handler);
      return () => connection.removeEventListener('icecandidate', handler);
    },
    opened,
    onFailed: listener => {
      failures.add(listener);
      return () => failures.delete(listener);
    },
    close: () => connection.close(),
  };
};

/** Null where the platform has no WebRTC. */
export const rtcLinkFactory = (): PeerLinkFactory | null => (typeof RTCPeerConnection === 'function' ? createRtcLink : null);
