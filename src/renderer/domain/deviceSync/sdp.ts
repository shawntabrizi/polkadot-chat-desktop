// Copied from .refs/polkadot-desktop src/shared/peer-channel/sdpCoder.ts and
// iceCandidate.ts on 2026-09-28; changes: one module, a structural candidate
// type (tests run under node, which has no RTCIceCandidate), no logging.

/**
 * M22b: SDP ↔ `MinimalSetup` as the phone's `SdpCoder.kt` does it. The wire
 * carries only ICE credentials, the DTLS fingerprint, the session id and
 * version, and the gathered candidates; the other side rebuilds a fixed
 * data-channel SDP from them (the template matches `reconstructSdpBase`).
 */

import { type MinimalCandidate, MinimalCandidatesCodec, MinimalSetupCodec } from './codec';

/** What this module reads from an `RTCIceCandidate`. */
export type LocalCandidate = {
  protocol?: string | null;
  address?: string | null;
  port?: number | null;
  priority?: number | null;
  foundation?: string | null;
  type?: string | null;
};

export type RemoteCandidate = { candidate: string; sdpMid: string; sdpMLineIndex: number };

export type DecodedSetup = { sdp: string; candidates: RemoteCandidate[] };

const ipv4ToBytes = (address: string): Uint8Array | null => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return Uint8Array.from(parts);
};

/** Eight u16 hextets, each little-endian (SCALE `UShort`), as the phone writes them. */
const ipv6ToBytes = (address: string): Uint8Array | null => {
  const cleaned = address.split('%')[0] ?? address;
  let head: string[];
  let tail: string[] = [];
  if (cleaned.includes('::')) {
    const [h, t] = cleaned.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
    if (head.length + tail.length > 8) return null;
  } else {
    head = cleaned.split(':');
    if (head.length !== 8) return null;
  }
  const parts = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const hextet = parts[i] ?? '';
    if (!/^[0-9a-fA-F]{1,4}$/.test(hextet)) return null;
    const value = Number.parseInt(hextet, 16);
    out[i * 2] = value & 0xff;
    out[i * 2 + 1] = (value >> 8) & 0xff;
  }
  return out;
};

const bytesToIpv6 = (bytes: Uint8Array): string =>
  Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] ?? 0) | ((bytes[i * 2 + 1] ?? 0) << 8)).toString(16)).join(':');

const TYPES = { host: 'HOST', srflx: 'SRFLX', relay: 'RELAY', prflx: 'PRFLX' } as const;

/** Null for what the wire cannot carry (an mDNS host name, an unknown type): the phone drops those too. */
export const toMinimalCandidate = (candidate: LocalCandidate): MinimalCandidate | null => {
  const protocol = (candidate.protocol ?? '').toLowerCase();
  if (protocol !== 'udp' && protocol !== 'tcp') return null;
  const raw = candidate.address ?? '';
  let address: MinimalCandidate['address'];
  if (raw.includes(':')) {
    const value = ipv6ToBytes(raw);
    if (!value) return null;
    address = { tag: 'Ipv6', value };
  } else {
    const value = /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) ? ipv4ToBytes(raw) : null;
    if (!value) return null;
    address = { tag: 'Ipv4', value };
  }
  const type = TYPES[(candidate.type ?? '').toLowerCase() as keyof typeof TYPES];
  if (!type) return null;
  return {
    foundation: candidate.foundation ?? '',
    priority: candidate.priority ?? 0,
    transportType: { tag: protocol === 'udp' ? 'UDP' : 'TCP', value: undefined },
    address,
    port: candidate.port ?? 0,
    candidateType: { tag: type, value: undefined },
  };
};

/** Component 1, the single m-line: the only shape a data-channel-only connection uses. */
export const toRemoteCandidate = (candidate: MinimalCandidate): RemoteCandidate => {
  const protocol = candidate.transportType.tag === 'UDP' ? 'udp' : 'tcp';
  const address = candidate.address.tag === 'Ipv4' ? Array.from(candidate.address.value).join('.') : bytesToIpv6(candidate.address.value);
  const line = `candidate:${candidate.foundation} 1 ${protocol} ${candidate.priority} ${address} ${candidate.port} typ ${candidate.candidateType.tag.toLowerCase()}`;
  return { candidate: line, sdpMid: '0', sdpMLineIndex: 0 };
};

const minimal = (candidates: readonly LocalCandidate[]): MinimalCandidate[] =>
  candidates.map(toMinimalCandidate).filter((candidate): candidate is MinimalCandidate => candidate !== null);

const parseFingerprint = (value: string): Uint8Array => {
  const trimmed = value.trim();
  const clean = (trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ') + 1) : trimmed).replace(/[:\s]/g, '');
  if (clean.length % 2 !== 0) return new Uint8Array();
  return Uint8Array.from(clean.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
};

const formatFingerprint = (bytes: Uint8Array): string =>
  `sha-256 ${Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':')}`;

export const encodeSetup = (sdp: string, candidates: readonly LocalCandidate[] = []): Uint8Array => {
  let iceUFrag = '';
  let icePwd = '';
  let fingerprint = '';
  let offer = true;
  let sessionId = 0n;
  let sessionVersion = 0n;
  for (const raw of sdp.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('a=ice-ufrag:')) iceUFrag = line.slice('a=ice-ufrag:'.length);
    else if (line.startsWith('a=ice-pwd:')) icePwd = line.slice('a=ice-pwd:'.length);
    else if (line.startsWith('a=fingerprint:')) fingerprint = line.slice('a=fingerprint:'.length);
    // As SdpCoder.kt: `actpass` is an offer, any other setup an answer.
    else if (line.startsWith('a=setup:')) offer = line.slice('a=setup:'.length) === 'actpass';
    else if (line.startsWith('o=')) {
      const parts = line.slice(2).split(' ').filter(Boolean);
      try {
        sessionId = BigInt(parts[1] ?? '0');
        sessionVersion = BigInt(parts[2] ?? '0');
      } catch {
        // A non-numeric origin line: 0, as the phone would.
      }
    }
  }
  return MinimalSetupCodec.enc({
    sdpType: { tag: offer ? 'OFFER' : 'ANSWER', value: undefined },
    sessionId,
    sessionVersion,
    iceUFrag,
    icePwd,
    fingerprint: parseFingerprint(fingerprint),
    candidates: minimal(candidates),
  });
};

export const decodeSetup = (bytes: Uint8Array): DecodedSetup => {
  const setup = MinimalSetupCodec.dec(bytes);
  const sdp =
    'v=0\r\n' +
    `o=- ${setup.sessionId.toString()} ${setup.sessionVersion.toString()} IN IP4 0.0.0.0\r\n` +
    's=-\r\n' +
    't=0 0\r\n' +
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
    'c=IN IP4 0.0.0.0\r\n' +
    `a=ice-ufrag:${setup.iceUFrag}\r\n` +
    `a=ice-pwd:${setup.icePwd}\r\n` +
    `a=fingerprint:${formatFingerprint(setup.fingerprint)}\r\n` +
    `a=setup:${setup.sdpType.tag === 'OFFER' ? 'actpass' : 'active'}\r\n` +
    'a=mid:0\r\n' +
    'a=sctp-port:5000\r\n';
  return { sdp, candidates: setup.candidates.map(toRemoteCandidate) };
};

export const encodeCandidates = (candidates: readonly LocalCandidate[]): Uint8Array => MinimalCandidatesCodec.enc(minimal(candidates));

export const decodeCandidates = (bytes: Uint8Array): RemoteCandidate[] => MinimalCandidatesCodec.dec(bytes).map(toRemoteCandidate);
