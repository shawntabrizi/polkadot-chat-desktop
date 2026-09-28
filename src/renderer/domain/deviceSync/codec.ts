// Copied from .refs/polkadot-desktop src/domains/device-sync/schemas.ts and
// src/shared/peer-channel/{signaling,dataChannelEnvelope,peerConnectionSignal}.ts
// on 2026-09-28; changes: one module, the SS58 helper dropped, comments cut to
// the Android sources they mirror.

/**
 * M22b: the SCALE layouts of device sync, byte-compatible with the phone
 * (polkadot-app-android-v2 ba3e15749). Variant indices are wire format.
 *
 * - `SyncMessage` and its entities: `feature/device-sync/.../SyncScale.kt`
 *   and `LocalMessageScale.kt`. `LocalMessage.remote` is the chat
 *   `ChatMessageStatement`, the SDK's `ChatMessage` codec.
 * - Signalling over the Statement Store session:
 *   `SyncSignalingEnvelope { offerId: String, message: SignalingMessage }`
 *   (`SyncSignalingEnvelope.kt`, `SignalingMessage.kt`). Offer and Answer
 *   carry SCALE(`MinimalSetup`), Candidates a `Vec<MinimalCandidate>`
 *   (`MinimalSetup.kt`, `SdpCoder.kt`).
 * - On the data channel every frame is `DataChannelMessage { id, data }`
 *   (`DataChannelMessage.kt`); sync uses id `device-sync`, trickled ICE
 *   after the channel opens uses `webrtc_renegotiation_internal_use_case`
 *   with `PeerConnectionSignal` (`PeerConnectionSignal.kt`).
 */

import { ChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes, type CodecType, Enum, Option, Struct, Vector, _void, compact, i32, str, u16, u32, u64 } from 'scale-ts';

const AccountId = Bytes(32);
/** `X25519PublicKeyScale`: 32 raw bytes, no length prefix. */
const X25519PublicKey = Bytes(32);

export const ChatIdCodec = Enum({ Contact: AccountId });

const DeviceStatusCodec = Enum({ ACTIVE: _void });

const OutgoingStatusCodec = Enum({ NEW: _void, SENT: _void, DELIVERED: _void });
const IncomingStatusCodec = Enum({ NEW: _void, SEEN: _void });

export const LocalStatusCodec = Enum({ Outgoing: OutgoingStatusCodec, Incoming: IncomingStatusCodec });

export const LocalDeviceCodec = Struct({
  statementAccountId: AccountId,
  encryptionPublicKey: X25519PublicKey,
  status: DeviceStatusCodec,
  lastUpdate: u64,
});

export const LocalMessageCodec = Struct({
  remote: ChatMessage,
  peerId: AccountId,
  status: LocalStatusCodec,
  order: u64,
});

export const SyncEntityCodec = Enum({
  Devices: Vector(LocalDeviceCodec),
  ChatsAdded: Vector(ChatIdCodec),
  ChatsRemoved: Vector(ChatIdCodec),
  Messages: Vector(LocalMessageCodec),
});

export const SyncUpdateCodec = Struct({ id: u32, entities: Vector(SyncEntityCodec), timePoint: u64 });

export const SyncMessageCodec = Enum({ Update: SyncUpdateCodec, Ack: Struct({ id: u32 }) });

export type SyncMessage = CodecType<typeof SyncMessageCodec>;
export type SyncUpdate = CodecType<typeof SyncUpdateCodec>;
export type SyncEntity = CodecType<typeof SyncEntityCodec>;
export type LocalMessage = CodecType<typeof LocalMessageCodec>;
export type LocalDevice = CodecType<typeof LocalDeviceCodec>;
export type WireChatMessage = CodecType<typeof ChatMessage>;

// ── Signalling ─────────────────────────────────────────────────────────

/** Kotlin enums without `@EnumIndex` encode their ordinal: TCP 0, UDP 1. */
const TransportTypeCodec = Enum({ TCP: _void, UDP: _void });

/** `Ipv4(u8 × 4)` / `Ipv6(u16 × 8)`: positional, no length prefix (each u16 little-endian). */
const IpAddressCodec = Enum({ Ipv4: Bytes(4), Ipv6: Bytes(16) });

const CandidateTypeCodec = Enum({ HOST: _void, SRFLX: _void, RELAY: _void, PRFLX: _void });

export const MinimalCandidateCodec = Struct({
  foundation: str,
  priority: i32,
  transportType: TransportTypeCodec,
  address: IpAddressCodec,
  port: u16,
  candidateType: CandidateTypeCodec,
});

export const MinimalCandidatesCodec = Vector(MinimalCandidateCodec);

/** `sessionId` / `sessionVersion` are `BigIntegerSerializable`: SCALE compact. */
export const MinimalSetupCodec = Struct({
  sdpType: Enum({ OFFER: _void, ANSWER: _void }),
  sessionId: compact,
  sessionVersion: compact,
  iceUFrag: str,
  icePwd: str,
  fingerprint: Bytes(),
  candidates: MinimalCandidatesCodec,
});

export type MinimalCandidate = CodecType<typeof MinimalCandidateCodec>;
export type MinimalSetup = CodecType<typeof MinimalSetupCodec>;

export const SignalingContentCodec = Enum({
  Reconnected: _void,
  Offer: Struct({ sdp: Bytes() }),
  Answer: Struct({ sdp: Bytes() }),
  Candidates: Struct({ candidates: Bytes() }),
});

export const SyncSignalingEnvelopeCodec = Struct({ offerId: str, message: SignalingContentCodec });

export type SyncSignalingEnvelope = CodecType<typeof SyncSignalingEnvelopeCodec>;

// ── Data channel ───────────────────────────────────────────────────────

export const DataChannelMessageCodec = Struct({ id: str, data: Bytes() });

export const DEVICE_SYNC_USE_CASE = 'device-sync';
export const RENEGOTIATION_USE_CASE = 'webrtc_renegotiation_internal_use_case';

export const PeerConnectionSignalCodec = Enum({
  offer: str,
  answer: str,
  candidates: Vector(Struct({ sdp: str, sdpMLineIndex: u32, sdpMid: Option(str) })),
});
