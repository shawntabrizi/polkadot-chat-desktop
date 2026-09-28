import { describe, expect, it } from 'vitest';

import { decodeCandidates, decodeSetup, encodeCandidates, encodeSetup, toMinimalCandidate } from './sdp';

// The input and the expected output of SdpCoderTest.kt "should encode and decode setup correctly".
const OFFER_SDP = [
  'v=0',
  'o=- 12345 67890 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:ufrag123',
  'a=ice-pwd:pwd123',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
].join('\n');

describe('SdpCoder.kt parity', () => {
  it('rebuilds the phone template from an offer and keeps its host candidate', () => {
    const candidate = { protocol: 'udp', address: '192.168.1.1', port: 1234, priority: 2122260223, foundation: '1', type: 'host' };
    const decoded = decodeSetup(encodeSetup(OFFER_SDP, [candidate]));
    // SdpCoderTest's expected SDP, line for line (CRLF here; WebRTC accepts both).
    expect(decoded.sdp.split('\r\n')).toEqual([...OFFER_SDP.split('\n'), '']);
    expect(decoded.candidates).toEqual([{ candidate: 'candidate:1 1 udp 2122260223 192.168.1.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0 }]);
  });

  it('an answer (setup other than actpass) comes back as `active`', () => {
    const answer = OFFER_SDP.replace('a=setup:actpass', 'a=setup:passive');
    expect(decodeSetup(encodeSetup(answer)).sdp).toContain('a=setup:active\r\n');
  });

  it('trickled candidates: udp and tcp, IPv6 round trip; mDNS names are dropped', () => {
    const encoded = encodeCandidates([
      { protocol: 'udp', address: '192.168.1.1', port: 1234, priority: 2122260223, foundation: '1', type: 'host' },
      { protocol: 'tcp', address: '10.0.0.1', port: 5678, priority: 123456, foundation: '2', type: 'srflx' },
      { protocol: 'udp', address: '2001:db8::1', port: 9, priority: 1, foundation: '3', type: 'relay' },
      { protocol: 'udp', address: 'abcd-1234.local', port: 9, priority: 1, foundation: '4', type: 'host' },
    ]);
    expect(decodeCandidates(encoded).map(c => c.candidate)).toEqual([
      'candidate:1 1 udp 2122260223 192.168.1.1 1234 typ host',
      'candidate:2 1 tcp 123456 10.0.0.1 5678 typ srflx',
      'candidate:3 1 udp 1 2001:db8:0:0:0:0:0:1 9 typ relay',
    ]);
    expect(toMinimalCandidate({ protocol: 'udp', address: 'abcd-1234.local', type: 'host' })).toBeNull();
  });
});
