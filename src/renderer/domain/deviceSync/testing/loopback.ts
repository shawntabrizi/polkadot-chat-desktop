/**
 * M22b test double: an in-memory `PeerLink` for node, which has no WebRTC.
 * Everything above it runs for real: the offer and answer go through
 * `encodeSetup`/`decodeSetup`, candidates through the Candidates envelope,
 * both over the Statement Store session. Two links connect when each has
 * applied the other's description (matched by ICE ufrag); the data channel
 * is then a pair of in-memory ports, frames delivered asynchronously.
 */

import type { DataPort, PeerLink } from '../link';
import type { LocalCandidate } from '../sdp';

type Entry = { remoteUfrag: string | null; connect: (port: DataPort) => void };

const registry = new Map<string, Entry>();
let counter = 0;

const makePorts = (): [DataPort, DataPort] => {
  const sides = [0, 1].map(() => ({ frames: new Set<(frame: Uint8Array) => void>(), closes: new Set<VoidFunction>(), closed: false }));
  const port = (self: number): DataPort => {
    const me = sides[self]!;
    const other = sides[1 - self]!;
    const closeBoth = () => {
      for (const side of [me, other]) {
        if (side.closed) continue;
        side.closed = true;
        for (const listener of side.closes) listener();
      }
    };
    return {
      send: frame => {
        if (me.closed) throw new Error('data channel closed');
        const copy = frame.slice();
        setTimeout(() => {
          if (!other.closed) for (const listener of other.frames) listener(copy);
        }, 0);
      },
      onFrame: listener => {
        me.frames.add(listener);
        return () => me.frames.delete(listener);
      },
      onClose: listener => {
        me.closes.add(listener);
        return () => me.closes.delete(listener);
      },
      close: closeBoth,
    };
  };
  return [port(0), port(1)];
};

export const createLoopbackLink = (role: 'initiator' | 'acceptor'): PeerLink => {
  const id = `lb${++counter}${Math.random().toString(36).slice(2, 8)}`;
  const candidateListeners = new Set<(candidate: LocalCandidate) => void>();
  const failListeners = new Set<VoidFunction>();
  let state = 'stable';
  let port: DataPort | null = null;
  let resolveOpened: (port: DataPort) => void = () => undefined;
  const opened = new Promise<DataPort>(resolve => {
    resolveOpened = resolve;
  });
  const entry: Entry = {
    remoteUfrag: null,
    connect: next => {
      port = next;
      resolveOpened(next);
    },
  };

  const sdpFor = (setup: string) =>
    [
      'v=0',
      `o=- ${counter} 2 IN IP4 127.0.0.1`,
      's=-',
      't=0 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      `a=ice-ufrag:${id}`,
      'a=ice-pwd:loopbackpassword',
      `a=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, i) => (i + counter).toString(16).padStart(2, '0').slice(-2).toUpperCase()).join(':')}`,
      `a=setup:${setup}`,
      'a=mid:0',
    ].join('\r\n');

  const gatherSoon = () =>
    setTimeout(() => {
      for (const listener of candidateListeners) listener({ protocol: 'udp', address: '127.0.0.1', port: 40000 + (counter % 1000), priority: 2122260223, foundation: '1', type: 'host' });
    }, 10);

  const tryConnect = () => {
    const remote = entry.remoteUfrag ? registry.get(entry.remoteUfrag) : undefined;
    if (!remote || remote.remoteUfrag !== id || port) return;
    const [mine, theirs] = makePorts();
    entry.connect(mine);
    remote.connect(theirs);
  };

  return {
    createOffer: async () => {
      if (role !== 'initiator') throw new Error('only the initiator offers');
      registry.set(id, entry);
      state = 'have-local-offer';
      gatherSoon();
      return sdpFor('actpass');
    },
    createAnswer: async () => {
      registry.set(id, entry);
      gatherSoon();
      const sdp = sdpFor('active');
      tryConnect();
      return sdp;
    },
    applyRemote: async (_type, sdp) => {
      const ufrag = /a=ice-ufrag:(\S+)/.exec(sdp)?.[1] ?? null;
      entry.remoteUfrag = ufrag;
      state = 'stable';
      if (registry.has(id)) tryConnect();
    },
    signalingState: () => state,
    addRemoteCandidate: async () => undefined,
    onLocalCandidate: listener => {
      candidateListeners.add(listener);
      return () => candidateListeners.delete(listener);
    },
    opened,
    onFailed: listener => {
      failListeners.add(listener);
      return () => failListeners.delete(listener);
    },
    close: () => {
      registry.delete(id);
      port?.close();
      for (const listener of failListeners) listener();
      failListeners.clear();
    },
  };
};
