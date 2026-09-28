/**
 * M22b wire vectors. Each expected hex is written out by hand from the
 * Kotlin layout it names (polkadot-app-android-v2 ba3e15749), not produced
 * by scale-ts: kotlinx-serialization-scale writes `UInt`/`ULong`/`Int`/
 * `UShort` little-endian, `String` and `ByteArray` with a compact length,
 * `List` with a compact count, a sealed class or `@EnumIndex` enum as one
 * index byte, a plain enum as its ordinal, `BigIntegerSerializable` as
 * compact, `String?` as an Option byte. A change to codec.ts that breaks the
 * phone's bytes fails here.
 */

import { describe, expect, it } from 'vitest';

import { bytesToHex, hexToBytes } from '../../app/bytes';

import {
  DataChannelMessageCodec,
  MinimalSetupCodec,
  PeerConnectionSignalCodec,
  SyncMessageCodec,
  SyncSignalingEnvelopeCodec,
  type SyncMessage,
} from './codec';

/** Little-endian unsigned, written without scale-ts. */
const le = (value: bigint, bytes: number): string => {
  let out = '';
  for (let i = 0; i < bytes; i++) out += Number((value >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0');
  return out;
};
const fill = (byte: number, count = 32): string => byte.toString(16).padStart(2, '0').repeat(count);
const ascii = (text: string): string => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
const hex = (...parts: string[]): `0x${string}` => `0x${parts.join('')}`;
const bytes = (byte: number, count = 32): Uint8Array => new Uint8Array(count).fill(byte);

const roundTrip = (message: SyncMessage, expected: `0x${string}`) => {
  expect(bytesToHex(SyncMessageCodec.enc(message)).toLowerCase()).toBe(expected);
  expect(SyncMessageCodec.dec(hexToBytes(expected))).toEqual(message);
};

describe('SyncScale.kt: SyncMessageScale', () => {
  it('Ack(id) is index 1 then the u32 id', () => {
    roundTrip({ tag: 'Ack', value: { id: 7 } }, hex('01', le(7n, 4)));
  });

  it('Update with ChatsAdded(Contact) and Devices(LocalDeviceScale)', () => {
    const timePoint = 1_727_500_000_000n;
    const expected = hex(
      '00', // SyncMessageScale.Update
      le(1n, 4), // id: UInt
      '08', // entities: 2
      '01', // SyncEntityScale.ChatsAdded
      '04', // 1 chat
      '00', // ChatIdScale.Contact
      fill(0x11), // @FixedLength(32) accountId
      '00', // SyncEntityScale.Devices
      '04', // 1 device
      fill(0x22), // @FixedLength(32) statementAccountId
      fill(0x33), // X25519PublicKeyScale: 32 raw bytes
      '00', // DeviceStatusScale.ACTIVE
      le(1000n, 8), // lastUpdate: ULong
      le(timePoint, 8), // timePoint: ULong
    );
    roundTrip(
      {
        tag: 'Update',
        value: {
          id: 1,
          entities: [
            { tag: 'ChatsAdded', value: [{ tag: 'Contact', value: bytes(0x11) }] },
            { tag: 'Devices', value: [{ statementAccountId: bytes(0x22), encryptionPublicKey: bytes(0x33), status: { tag: 'ACTIVE', value: undefined }, lastUpdate: 1000n }] },
          ],
          timePoint,
        },
      },
      expected,
    );
  });

  it('Messages(LocalMessageScale): a text, outgoing and delivered', () => {
    const expected = hex(
      '00',
      le(2n, 4),
      '04',
      '03', // SyncEntityScale.Messages
      '04',
      // remote: ChatMessageStatement { id: String, timestamp: ULong, versioned: V1(content) }
      '08',
      ascii('m1'),
      le(5n, 8),
      '00', // VersionedChatMessage.V1
      '00', // ChatMessageStatementContent.Text
      '08',
      ascii('hi'),
      fill(0x44), // @FixedLength(32) peerId
      '00', // LocalStatusScale.Outgoing
      '02', // OutgoingStatusScale.DELIVERED
      le(5n, 8), // order: ULong
      le(9n, 8), // timePoint
    );
    roundTrip(
      {
        tag: 'Update',
        value: {
          id: 2,
          entities: [
            {
              tag: 'Messages',
              value: [
                {
                  remote: { messageId: 'm1', timestamp: 5n, versioned: { tag: 'v1', value: { tag: 'text', value: 'hi' } } },
                  peerId: bytes(0x44),
                  status: { tag: 'Outgoing', value: { tag: 'DELIVERED', value: undefined } },
                  order: 5n,
                },
              ],
            },
          ],
          timePoint: 9n,
        },
      },
      expected,
    );
  });

  it('Messages: DeviceAdded (kind 17) and DeviceRemoved (kind 18), incoming', () => {
    // `AccountId` / `EncodedPublicKey` carry no @FixedLength in ChatMessageStatementContent: a compact length (0x80 = 32).
    const expected = hex(
      '00',
      le(3n, 4),
      '04',
      '03',
      '08',
      ...['08', ascii('d1'), le(6n, 8), '00', '11', '80', fill(0x55), '80', fill(0x66), fill(0x44), '01', '01', le(6n, 8)],
      ...['08', ascii('d2'), le(7n, 8), '00', '12', '80', fill(0x55), fill(0x44), '01', '00', le(7n, 8)],
      le(10n, 8),
    );
    roundTrip(
      {
        tag: 'Update',
        value: {
          id: 3,
          entities: [
            {
              tag: 'Messages',
              value: [
                {
                  remote: { messageId: 'd1', timestamp: 6n, versioned: { tag: 'v1', value: { tag: 'deviceAdded', value: { statementAccountId: bytes(0x55), encryptionPublicKey: bytes(0x66) } } } },
                  peerId: bytes(0x44),
                  status: { tag: 'Incoming', value: { tag: 'SEEN', value: undefined } },
                  order: 6n,
                },
                {
                  remote: { messageId: 'd2', timestamp: 7n, versioned: { tag: 'v1', value: { tag: 'deviceRemoved', value: { statementAccountId: bytes(0x55) } } } },
                  peerId: bytes(0x44),
                  status: { tag: 'Incoming', value: { tag: 'NEW', value: undefined } },
                  order: 7n,
                },
              ],
            },
          ],
          timePoint: 10n,
        },
      },
      expected,
    );
  });

  it('ChatsRemoved is index 2', () => {
    roundTrip(
      { tag: 'Update', value: { id: 4, entities: [{ tag: 'ChatsRemoved', value: [{ tag: 'Contact', value: bytes(0x11) }] }], timePoint: 0n } },
      hex('00', le(4n, 4), '04', '02', '04', '00', fill(0x11), le(0n, 8)),
    );
  });
});

describe('SyncSignalingEnvelope.kt and SignalingMessage.kt', () => {
  it('Reconnected is index 0 with no body', () => {
    expect(bytesToHex(SyncSignalingEnvelopeCodec.enc({ offerId: 'ab', message: { tag: 'Reconnected', value: undefined } }))).toBe(hex('08', ascii('ab'), '00'));
  });

  it('Offer(sdp: ByteArray), Answer and IceCandidates(candidates: ByteArray)', () => {
    const sdp = new Uint8Array([1, 2, 3]);
    expect(bytesToHex(SyncSignalingEnvelopeCodec.enc({ offerId: 'o', message: { tag: 'Offer', value: { sdp } } }))).toBe(hex('04', ascii('o'), '01', '0c', '010203'));
    expect(bytesToHex(SyncSignalingEnvelopeCodec.enc({ offerId: 'o', message: { tag: 'Answer', value: { sdp } } }))).toBe(hex('04', ascii('o'), '02', '0c', '010203'));
    expect(bytesToHex(SyncSignalingEnvelopeCodec.enc({ offerId: 'o', message: { tag: 'Candidates', value: { candidates: sdp } } }))).toBe(hex('04', ascii('o'), '03', '0c', '010203'));
  });
});

describe('MinimalSetup.kt (SdpCoder.encodeSetup)', () => {
  it('lays out type, compact session id and version, strings, fingerprint and one candidate', () => {
    const expected = hex(
      '00', // SdpType.OFFER (ordinal)
      'e5c0', // compact 12345 (two-byte mode: 12345 << 2 | 1)
      '08', // compact 2
      '08',
      ascii('uf'),
      '08',
      ascii('pw'),
      '80', // fingerprint: ByteArray, 32 bytes
      fill(0xa1),
      '04', // candidates: 1
      '04',
      ascii('1'), // foundation
      le(2_122_260_223n, 4), // priority: Int
      '01', // TransportType.UDP (ordinal)
      '00', // IpAddress.Ipv4
      'c0a80101', // 192.168.1.1
      le(1234n, 2), // port: UShort
      '00', // CandidateType.HOST
    );
    const setup = {
      sdpType: { tag: 'OFFER' as const, value: undefined },
      sessionId: 12345n,
      sessionVersion: 2n,
      iceUFrag: 'uf',
      icePwd: 'pw',
      fingerprint: bytes(0xa1),
      candidates: [
        {
          foundation: '1',
          priority: 2_122_260_223,
          transportType: { tag: 'UDP' as const, value: undefined },
          address: { tag: 'Ipv4' as const, value: new Uint8Array([192, 168, 1, 1]) },
          port: 1234,
          candidateType: { tag: 'HOST' as const, value: undefined },
        },
      ],
    };
    expect(bytesToHex(MinimalSetupCodec.enc(setup))).toBe(expected);
    const decoded = MinimalSetupCodec.dec(hexToBytes(expected));
    expect(BigInt(decoded.sessionId)).toBe(12345n);
    expect(decoded.candidates[0]?.port).toBe(1234);
  });
});

describe('DataChannelMessage.kt and PeerConnectionSignal.kt', () => {
  it('DataChannelMessage { id: String, data: ByteArray }', () => {
    const data = hexToBytes(hex('01', le(7n, 4)));
    expect(bytesToHex(DataChannelMessageCodec.enc({ id: 'device-sync', data }))).toBe(hex('2c', ascii('device-sync'), '14', '0107000000'));
  });

  it('IceCandidates(List<PeerConnectionCandidate { sdp, sdpMLineIndex: UInt, sdpMid: String? }>)', () => {
    expect(bytesToHex(PeerConnectionSignalCodec.enc({ tag: 'candidates', value: [{ sdp: 'c', sdpMLineIndex: 0, sdpMid: '0' }] }))).toBe(
      hex('02', '04', '04', ascii('c'), le(0n, 4), '01', '04', ascii('0')),
    );
  });
});
