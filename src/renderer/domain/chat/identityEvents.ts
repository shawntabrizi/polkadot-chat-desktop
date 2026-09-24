// Ported from polkadot-desktop src/domains/chat/p2p/session-transport/service.ts
// (`toIdentityChannelEvents`) and session-transport/types.ts.

/**
 * What arrives on the identity-level channel with a peer. The roster variants
 * bootstrap per-device transport, so they cannot travel on it. Anything else
 * (a bot's welcome text rides the identity session, see docs/decisions.md) is
 * surfaced as `message` for the caller to treat like session content.
 */

import { FileMeta as SdkFileMeta, P2PMixnetFile as SdkP2PMixnetFile } from '@novasamatech/host-chat/codec/attachment';
import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes, type Codec, type CodecType, Enum, Option, Struct, Vector, _void, bool, createCodec, str, u128, u16, u32, u64, u8 } from 'scale-ts';

import { type HexString, hexToBytes } from '../../app/bytes';
import type { PeerDevice } from '../../app/database';

import { AccountCodec, TimeCodec } from './groupCodec';

type SdkChatMessageWire = CodecType<typeof SdkChatMessage>;
type SdkContent = SdkChatMessageWire['versioned']['value'];
type SdkRichText = Extract<SdkContent, { tag: 'richText' }>;
type SdkFileVariant = NonNullable<SdkRichText['value']['attachments']>[number];
export type FileMetaWire = CodecType<typeof SdkFileMeta>;

/**
 * RFC-0003 `deleted(DeletedContent)`; the SDK (0.10.2) has no such variant.
 * `targetMessageId` is the retracted message (the envelope has its own `messageId`).
 */
export type DeletedWire = { tag: 'deleted'; value: { targetMessageId: string } };

/**
 * Spec 0006 `Action`. `tx` is reserved (RFC 0007): decoded as opaque bytes,
 * never executed.
 */
export type ButtonActionWire =
  | { tag: 'command'; value: string }
  | { tag: 'callback'; value: Uint8Array }
  | { tag: 'url'; value: string }
  | { tag: 'tx'; value: Uint8Array };
export type ButtonWire = { label: string; action: ButtonActionWire };
/** Spec 0006 `buttons(ButtonsContent)`, provisional kind 242. */
export type ButtonsWire = { tag: 'buttons'; value: { text: string; rows: ButtonWire[][]; oneShot: boolean } };
/** Spec 0006 `buttonPress(ButtonPressContent)`, provisional kind 243. `messageId` is the buttons message. */
export type ButtonPressWire = { tag: 'buttonPress'; value: { messageId: string; row: number; index: number; payload: Uint8Array } };

/**
 * A spec 0006 kind (242/243) whose header decodes but whose body does not:
 * an unknown action tag (above 3) has no length prefix, so nothing after it
 * can be read. Receive-only; the app shows the unsupported bubble for it.
 */
export type UndecodableWire = { tag: 'undecodable'; value: { kind: number } };

/**
 * Spec 0005 `typing(TypingContent)`, provisional kind 240. `until` is unix ms;
 * `kind` is 0 composing, 1 working, 2 stopped (other values are kept as read,
 * and the receiver ignores them). Ephemeral: never a row.
 */
export type TypingWire = { tag: 'typing'; value: { until: bigint; kind: number } };
/** Spec 0005 `seen(SeenContent)`, provisional kind 241. `upTo` is a message id of the receiver's; `at` unix ms. */
export type SeenWire = { tag: 'seen'; value: { upTo: string; at: bigint } };

/** Spec 0008 `Command`: `name` without the slash. */
export type BotCommandWire = { name: string; description: string };
/**
 * Spec 0008 v2 `BalanceHint`: the contract view a client reads to show "your
 * balance with this bot". `contract` is a 20-byte Revive address, `selector`
 * a 4-byte ABI selector; `perReply` is in the smallest unit of the value.
 */
export type BalanceHintWire = {
  chainId: string;
  contract: Uint8Array;
  selector: Uint8Array;
  decimals: number;
  unit: string;
  perReply: bigint | undefined;
  label: string;
  /**
   * v3 (vectors-0008c.md): what the bot metered but has not charged yet, in
   * the unit of the value. Undefined: not sent (a v2 hint), which means 0.
   */
  pending?: bigint | undefined;
};
/**
 * Spec 0008 `botInfo(BotInfo)`, provisional kind 244. `kind` is 0 bot, 1
 * agent, 2 person-operated service; any other byte is kept as read (a later
 * revision may add kinds). `balance` is the v2 field: absent in a v1
 * document. Never a row.
 */
export type BotInfoWire = {
  tag: 'botInfo';
  value: {
    kind: number;
    name: string;
    description: string;
    greeting: string;
    commands: BotCommandWire[];
    version: number;
    balance?: BalanceHintWire | undefined;
  };
};

/**
 * Spec 0007 `transactionReference(TransactionReference)`, provisional kind
 * 245. `status`: 0 submitted, 1 in block (best), 2 finalized, 3 failed; any
 * other byte is kept as read. `hash` is the extrinsic hash.
 */
export type TransactionReferenceWire = {
  tag: 'transactionReference';
  value: { chainId: string; hash: Uint8Array; status: number; block: number | undefined; note: string; intentMessageId: string | undefined };
};

/** Spec 0009 `Member`: `account` is the 32-byte identity account; `joinedAt` unix ms. */
export type GroupMemberWire = { account: Uint8Array; username: string; joinedAt: bigint };
/**
 * Spec 0009 `groupInfo(GroupInfo)`, provisional kind 246: the roster. Only
 * the admin's is applied; the highest `version` wins. Never a row.
 */
export type GroupInfoWire = {
  tag: 'groupInfo';
  value: { groupId: string; name: string; admin: Uint8Array; members: GroupMemberWire[]; version: number; createdAt: bigint };
};
/**
 * Spec 0009 `groupMessage(GroupMessage)`, provisional kind 247: any non-group
 * content, wrapped. `content` is the inner `MessageContent` (its kind byte and
 * body, the same bytes as in a 1:1 message after the header).
 */
export type GroupMessageWire = { tag: 'groupMessage'; value: { groupId: string; infoVersion: number; seq: bigint; content: ChatContent } };
/** Spec 0009 `groupLeave(GroupLeave)`, provisional kind 248: "I left". Reused inside a spec 0011 carrier. */
export type GroupLeaveWire = { tag: 'groupLeave'; value: { groupId: string } };

/** Spec 0011 `HistoryItem`: `message` is a remote message (it encodes as an opaque message). */
export type HistoryItemWire = { from: HexString; message: Uint8Array };
export type HistorySinceWire = { tag: 'messageId'; value: string } | { tag: 'timestamp'; value: number };
/**
 * Spec 0011 `GroupControl`, kind 249, over the pairwise session. `historyRequest`
 * is variant 5 (reviewer ruling 1, 2026-09-24).
 */
export type GroupControl =
  | { tag: 'welcome'; value: { groupId: string; epoch: number; epochKey: Uint8Array; stateVersion: number; stateHash: Uint8Array } }
  | { tag: 'joinRequest'; value: { groupId: string; inviteId: Uint8Array; proof: Uint8Array; note: string } }
  | { tag: 'joinDecision'; value: { groupId: string; inviteId: Uint8Array; status: number } }
  | { tag: 'history'; value: { groupId: string; items: HistoryItemWire[]; last: boolean } }
  | { tag: 'keyRequest'; value: { groupId: string; haveEpoch: number } }
  | { tag: 'historyRequest'; value: { groupId: string; since: HistorySinceWire; limit: number } };
export type GroupControlWire = { tag: 'groupControl'; value: GroupControl };
/** Spec 0012 `Media`: file 0, image 1, video 2, voice 3 (a `waveform` of at most 64 samples). */
export type AttachmentMediaWire =
  | { tag: 'file'; value: undefined }
  | { tag: 'image'; value: { width: number; height: number } }
  | { tag: 'video'; value: { width: number; height: number; durationMs: number } }
  | { tag: 'voice'; value: { durationMs: number; waveform: Uint8Array } };
/**
 * Spec 0012 `Attachment`: `chunks[i]` is the blake2b-256 of encrypted chunk
 * i, which is also its Bulletin content hash and its CID digest. `size` and
 * `expiresAt` are u64 on the wire.
 */
export type AttachmentItemWire = {
  mime: string;
  name: string | undefined;
  size: bigint;
  media: AttachmentMediaWire;
  blurhash: string | undefined;
  thumbnail: Uint8Array | undefined;
  key: Uint8Array;
  nonce: Uint8Array;
  chunkSize: number;
  chunks: Uint8Array[];
  store: { tag: 'bulletin'; value: { genesis: Uint8Array; mirror: string | undefined } };
  expiresAt: bigint;
};
/** Spec 0012 `attachment(AttachmentContent)`, provisional kind 250: 1 to 4 items and a caption. */
export type AttachmentWire = { tag: 'attachment'; value: { items: AttachmentItemWire[]; caption: string | undefined } };

/**
 * Spec 0014 `BulletinFile`: the 0012 item inside the base spec's `RichText`
 * as `FileVariant` index 1. `meta` is the base `FileMeta` (the blurhash rides
 * in its `thumbnail`, as the phones put it); `preview` is 0012's small image.
 */
export type BulletinFileWire = {
  meta: FileMetaWire;
  name: string | undefined;
  preview: Uint8Array | undefined;
  voice: { durationMs: number; waveform: Uint8Array } | undefined;
  key: Uint8Array;
  nonce: Uint8Array;
  chunkSize: number;
  chunks: Uint8Array[];
  store: { tag: 'bulletin'; value: { genesis: Uint8Array; mirror: string | undefined } };
  expiresAt: bigint;
};
/** Base spec `FileVariant` plus spec 0014 `bulletin` (index 1). */
export type FileVariantWire = SdkFileVariant | { tag: 'bulletin'; value: BulletinFileWire };
/** Base spec `richText` (kind 15) with this app's `FileVariant`. */
export type RichTextWire = { tag: 'richText'; value: { text: string | undefined; attachments: FileVariantWire[] | undefined } };

/**
 * Spec 0013 `capabilities(Capabilities)`, provisional kind 252. `kinds` is a
 * 32-byte bitmap (bit k = byte k/8, bit k%8); `hopDialects`: 0 legacy (the
 * phones), 1 aesGcm. Never a row.
 */
export type CapabilitiesWire = {
  tag: 'capabilities';
  value: { version: number; kinds: Uint8Array; fileVariants: number[]; hopDialects: number[]; features: number };
};

export type ChatContent =
  | Exclude<SdkContent, { tag: 'richText' }>
  | RichTextWire
  | CapabilitiesWire
  | DeletedWire
  | ButtonsWire
  | ButtonPressWire
  | TypingWire
  | SeenWire
  | BotInfoWire
  | TransactionReferenceWire
  | GroupInfoWire
  | GroupMessageWire
  | GroupLeaveWire
  | GroupControlWire
  | AttachmentWire
  | UndecodableWire;
export type ChatMessageWire = { messageId: string; timestamp: bigint; versioned: { tag: 'v1'; value: ChatContent } };

/**
 * RFC-0003 names kind 20 for `deleted`, but 20 is already `deviceChatAccepted`
 * (mds.md, the SDK codec, the pca bots). Its Unresolved Question 6 says to
 * take the next free index on a clash: 21, as the pca side does
 * (docs/decisions.md). The SDK codec does not know 21, so this codec reads
 * and writes it and hands every other kind to the SDK.
 */
export const DELETED_KIND = 21;
/** Spec 0006 provisional kinds (docs/spec/kinds.md). */
export const BUTTONS_KIND = 242;
export const BUTTON_PRESS_KIND = 243;
/** Spec 0005 provisional kinds (docs/spec/kinds.md). */
export const TYPING_KIND = 240;
export const SEEN_KIND = 241;
/** Spec 0008 provisional kind (docs/spec/kinds.md). */
export const BOT_INFO_KIND = 244;
/** Spec 0007 provisional kind (docs/spec/kinds.md). */
export const TRANSACTION_REFERENCE_KIND = 245;
/** Spec 0009 provisional kinds (docs/spec/kinds.md). */
export const GROUP_INFO_KIND = 246;
export const GROUP_MESSAGE_KIND = 247;
export const GROUP_LEAVE_KIND = 248;
/** Spec 0011 provisional kind (docs/spec/kinds.md). */
export const GROUP_CONTROL_KIND = 249;
const GROUP_KINDS: readonly number[] = [GROUP_INFO_KIND, GROUP_MESSAGE_KIND, GROUP_LEAVE_KIND, GROUP_CONTROL_KIND];
/** Spec 0012 provisional kind (docs/spec/kinds.md, review 0012: 250). */
export const ATTACHMENT_KIND = 250;
/** Spec 0013 provisional kind (docs/spec/kinds.md). */
export const CAPABILITIES_KIND = 252;
/** Base spec `richText`: decoded here for spec 0014's `FileVariant.bulletin` (index 1), which the SDK codec does not know. */
export const RICH_TEXT_KIND = 15;
const V1 = 0;

const Header = Struct({ messageId: str, timestamp: u64, version: u8, kind: u8 });

// Spec 0006 layout. scale-ts numbers enum variants in key order: command 0,
// callback 1, url 2, tx 3.
const ActionCodec = Enum({ command: str, callback: Bytes(), url: str, tx: Bytes() });
const ButtonCodec = Struct({ label: str, action: ActionCodec });
const ButtonsContentCodec = Struct({ text: str, rows: Vector(Vector(ButtonCodec)), oneShot: bool });
const ButtonPressContentCodec = Struct({ messageId: str, row: u8, index: u8, payload: Bytes() });
// Spec 0005 layout (docs/spec/vectors-0005.md).
const TypingContentCodec = Struct({ until: u64, kind: u8 });
const SeenContentCodec = Struct({ upTo: str, at: u64 });
// Spec 0008 layout (docs/spec/vectors-0008.md).
const BotCommandCodec = Struct({ name: str, description: str });
const BotInfoV1Fields = { kind: u8, name: str, description: str, greeting: str, commands: Vector(BotCommandCodec), version: u16 };
const BotInfoContentCodec = Struct(BotInfoV1Fields);
// Spec 0008 v2 (docs/spec/vectors-0008b.md): `balance: Option<BalanceHint>`
// appended. A v1 document ends after `version`, which reads as no hint; an
// encoder writes nothing there when it has no hint, so v1 bytes stay v1.
const BalanceHintCodec = Struct({ chainId: str, contract: Bytes(), selector: Bytes(), decimals: u8, unit: str, perReply: Option(u128), label: str });
const BotInfoV2ContentCodec = Struct({ ...BotInfoV1Fields, balance: Option(BalanceHintCodec) });
// Spec 0008 v3 (docs/spec/vectors-0008c.md): `pending: Option<u128>` appended
// to the hint. A v2 hint ends after `label`, which reads as no pending; an
// encoder writes nothing there without one, so v2 bytes stay v2.
const BalanceHintV3Codec = Struct({ chainId: str, contract: Bytes(), selector: Bytes(), decimals: u8, unit: str, perReply: Option(u128), label: str, pending: Option(u128) });
const BotInfoV3ContentCodec = Struct({ ...BotInfoV1Fields, balance: Option(BalanceHintV3Codec) });
// Spec 0007 layout (docs/spec/vectors-0007.md).
const TransactionReferenceCodec = Struct({ chainId: str, hash: Bytes(), status: u8, block: Option(u32), note: str, intentMessageId: Option(str) });

/**
 * Spec 0008 decoder bounds, the same as pca's (vectors-0008.md): each string
 * in bytes (4 per character of the spec's limit) and the command count. Over
 * a bound the message is undecodable.
 */
export const BOT_INFO_BOUNDS = {
  name: 160,
  description: 1120,
  greeting: 1120,
  commandName: 128,
  commandDescription: 320,
  commands: 32,
  // v2 hint, the same as pca's: chainId 256 bytes, unit 16 and label 40 characters.
  balanceChainId: 256,
  balanceUnit: 64,
  balanceLabel: 160,
} as const;
const withinHintBounds = (hint: BalanceHintWire | undefined): boolean =>
  hint === undefined ||
  (hint.contract.length === 20 &&
    hint.selector.length === 4 &&
    utf8Length(hint.chainId) <= BOT_INFO_BOUNDS.balanceChainId &&
    utf8Length(hint.unit) <= BOT_INFO_BOUNDS.balanceUnit &&
    utf8Length(hint.label) <= BOT_INFO_BOUNDS.balanceLabel);
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;
const withinBotInfoBounds = (info: BotInfoWire['value']): boolean =>
  utf8Length(info.name) <= BOT_INFO_BOUNDS.name &&
  utf8Length(info.description) <= BOT_INFO_BOUNDS.description &&
  utf8Length(info.greeting) <= BOT_INFO_BOUNDS.greeting &&
  info.commands.length <= BOT_INFO_BOUNDS.commands &&
  info.commands.every(
    command => utf8Length(command.name) <= BOT_INFO_BOUNDS.commandName && utf8Length(command.description) <= BOT_INFO_BOUNDS.commandDescription,
  ) &&
  withinHintBounds(info.balance);

/**
 * Spec 0007 decoder bounds, the same as pca's (vectors-0007.md): `hash` 1 to
 * 64 bytes, `note` at most 560 bytes (4 per character of the 140 limit),
 * `status` 0 to 3. Outside them the message is undecodable.
 */
export const REFERENCE_BOUNDS = { hashMin: 1, hashMax: 64, note: 560, status: 3 } as const;
const withinReferenceBounds = (reference: TransactionReferenceWire['value']): boolean =>
  reference.hash.length >= REFERENCE_BOUNDS.hashMin &&
  reference.hash.length <= REFERENCE_BOUNDS.hashMax &&
  utf8Length(reference.note) <= REFERENCE_BOUNDS.note &&
  reference.status <= REFERENCE_BOUNDS.status;

// Spec 0009 layout. A group id is a UUID string, as message ids are; an
// account is 32 bytes.
const GroupMemberCodec = Struct({ account: Bytes(32), username: str, joinedAt: u64 });
const GroupInfoCodec = Struct({ groupId: str, name: str, admin: Bytes(32), members: Vector(GroupMemberCodec), version: u32, createdAt: u64 });
const GroupLeaveCodec = Struct({ groupId: str });
// Spec 0011 layout (docs/spec/vectors-0011.md). scale-ts numbers enum
// variants in key order: welcome 0 … historyRequest 5.
const HistoryItemCodec = Struct({ from: AccountCodec, message: Bytes() });
const GroupControlCodec = Enum({
  welcome: Struct({ groupId: str, epoch: u32, epochKey: Bytes(32), stateVersion: u32, stateHash: Bytes(32) }),
  joinRequest: Struct({ groupId: str, inviteId: Bytes(16), proof: Bytes(32), note: str }),
  joinDecision: Struct({ groupId: str, inviteId: Bytes(16), status: u8 }),
  history: Struct({ groupId: str, items: Vector(HistoryItemCodec), last: bool }),
  keyRequest: Struct({ groupId: str, haveEpoch: u32 }),
  historyRequest: Struct({ groupId: str, since: Enum({ messageId: str, timestamp: TimeCodec }), limit: u8 }),
});

/** Spec 0011 decoder bounds (pca's `GROUP_CONTROL_LIMITS`): outside them the message is undecodable. */
export const GROUP_CONTROL_BOUNDS = { noteBytes: 560, historyItems: 100, historyLimit: 100 } as const;
const withinControlBounds = (control: GroupControl): boolean => {
  switch (control.tag) {
    case 'joinRequest':
      return utf8Length(control.value.note) <= GROUP_CONTROL_BOUNDS.noteBytes;
    case 'joinDecision':
      return control.value.status <= 1;
    case 'history':
      return control.value.items.length <= GROUP_CONTROL_BOUNDS.historyItems;
    case 'historyRequest':
      return control.value.limit >= 1 && control.value.limit <= GROUP_CONTROL_BOUNDS.historyLimit;
    default:
      return true;
  }
};

// Spec 0012 layout (docs/spec/vectors-0012.md). scale-ts numbers enum
// variants in key order: file 0, image 1, video 2, voice 3; bulletin 0.
const MediaCodec = Enum({
  file: _void,
  image: Struct({ width: u32, height: u32 }),
  video: Struct({ width: u32, height: u32, durationMs: u32 }),
  voice: Struct({ durationMs: u32, waveform: Bytes() }),
});
const StoreCodec = Enum({ bulletin: Struct({ genesis: Bytes(32), mirror: Option(str) }) });
const AttachmentItemCodec = Struct({
  mime: str,
  name: Option(str),
  size: u64,
  media: MediaCodec,
  blurhash: Option(str),
  thumbnail: Option(Bytes()),
  key: Bytes(32),
  nonce: Bytes(12),
  chunkSize: u32,
  chunks: Vector(Bytes(32)),
  store: StoreCodec,
  expiresAt: u64,
});
const AttachmentContentCodec = Struct({ items: Vector(AttachmentItemCodec), caption: Option(str) });

// Spec 0014 layout (docs/spec/vectors-0014.md). scale-ts numbers enum variants
// in key order: p2pMixnet 0 (the SDK's struct, unchanged), bulletin 1.
const BulletinFileCodec = Struct({
  meta: SdkFileMeta,
  name: Option(str),
  preview: Option(Bytes()),
  voice: Option(Struct({ durationMs: u32, waveform: Bytes() })),
  key: Bytes(32),
  nonce: Bytes(12),
  chunkSize: u32,
  chunks: Vector(Bytes(32)),
  store: StoreCodec,
  expiresAt: u64,
});
const FileVariantCodec = Enum({ p2pMixnet: SdkP2PMixnetFile, bulletin: BulletinFileCodec });
const RichTextContentCodec = Struct({ text: Option(str), attachments: Option(Vector(FileVariantCodec)) });

// Spec 0013 layout (docs/spec/0013-capabilities.md "Test vector").
const CapabilitiesCodec = Struct({ version: u8, kinds: Bytes(32), fileVariants: Vector(u8), hopDialects: Vector(u8), features: u32 });

/** The 0012 limits of a `bulletin` item, read through the kind-250 shape (spec 0014 "Limits" are 0012's). */
const bulletinAsItem = (file: BulletinFileWire): AttachmentItemWire => {
  const general = file.meta.tag === 'general' ? file.meta.value : file.meta.value.general;
  return {
    mime: general.mimeType,
    name: file.name,
    size: BigInt(general.fileSize),
    media: file.voice ? { tag: 'voice', value: file.voice } : { tag: 'file', value: undefined },
    blurhash: undefined,
    thumbnail: file.preview,
    key: file.key,
    nonce: file.nonce,
    chunkSize: file.chunkSize,
    chunks: file.chunks,
    store: file.store,
    expiresAt: file.expiresAt,
  };
};

/**
 * Spec 0012 limits, checked on decode: 1 to 4 items; `mime` at most 64
 * bytes, `name` 128, `blurhash` 64, `thumbnail` 2048, `caption` 1024; a
 * `waveform` of at most 64 samples; `size` at least 1 and at most 25 MiB;
 * `chunkSize` 1 to 2,000,000; 1 to 14 chunks, exactly ⌈size / chunkSize⌉.
 * Outside them the message is undecodable (the unsupported bubble).
 */
export const ATTACHMENT_BOUNDS = {
  items: 4,
  mime: 64,
  name: 128,
  blurhash: 64,
  thumbnail: 2048,
  caption: 1024,
  waveform: 64,
  size: 25 * 1024 * 1024,
  chunkSize: 2_000_000,
  chunks: 14,
} as const;
const withinItemBounds = (item: AttachmentItemWire): boolean => {
  const size = item.size;
  if (size < 1n || size > BigInt(ATTACHMENT_BOUNDS.size)) return false;
  if (item.chunkSize < 1 || item.chunkSize > ATTACHMENT_BOUNDS.chunkSize) return false;
  const n = (size + BigInt(item.chunkSize) - 1n) / BigInt(item.chunkSize);
  return (
    item.chunks.length >= 1 &&
    item.chunks.length <= ATTACHMENT_BOUNDS.chunks &&
    BigInt(item.chunks.length) === n &&
    utf8Length(item.mime) <= ATTACHMENT_BOUNDS.mime &&
    (item.name === undefined || utf8Length(item.name) <= ATTACHMENT_BOUNDS.name) &&
    (item.blurhash === undefined || utf8Length(item.blurhash) <= ATTACHMENT_BOUNDS.blurhash) &&
    (item.thumbnail === undefined || item.thumbnail.length <= ATTACHMENT_BOUNDS.thumbnail) &&
    (item.media.tag !== 'voice' || item.media.value.waveform.length <= ATTACHMENT_BOUNDS.waveform)
  );
};
/** The encoded size of an `AttachmentContent` (spec 0012 limits it to 3,584 bytes so it fits a 4 KB batch). */
export const attachmentContentLength = (content: AttachmentWire['value']): number => AttachmentContentCodec.enc(content).length;

const withinAttachmentBounds = (content: AttachmentWire['value']): boolean =>
  content.items.length >= 1 &&
  content.items.length <= ATTACHMENT_BOUNDS.items &&
  content.items.every(withinItemBounds) &&
  (content.caption === undefined || utf8Length(content.caption) <= ATTACHMENT_BOUNDS.caption);

/**
 * Spec 0009 decoder bounds: at most 16 members, the name at most 240 bytes
 * (4 per character of the 60 limit), usernames at most 256 bytes (64
 * characters), the same as pca's. Outside
 * them the message is undecodable.
 */
export const GROUP_BOUNDS = { members: 16, name: 240, username: 256 } as const;
const withinGroupBounds = (info: GroupInfoWire['value']): boolean =>
  info.members.length >= 1 &&
  info.members.length <= GROUP_BOUNDS.members &&
  utf8Length(info.name) <= GROUP_BOUNDS.name &&
  info.members.every(member => utf8Length(member.username) <= GROUP_BOUNDS.username);

type ExtensionWire =
  | RichTextWire
  | CapabilitiesWire
  | DeletedWire
  | ButtonsWire
  | ButtonPressWire
  | TypingWire
  | SeenWire
  | BotInfoWire
  | TransactionReferenceWire
  | GroupInfoWire
  | GroupLeaveWire
  | GroupControlWire

  | AttachmentWire;
type Envelope = { messageId: string; timestamp: bigint; version: number; kind: number };

/** The header plus one extension body; the caller writes the kind byte. */
const envelope = <T>(content: Codec<T>) =>
  Struct({ messageId: str, timestamp: u64, version: u8, kind: u8, content });

const DeletedMessage = envelope(str);
const ButtonsMessage = envelope(ButtonsContentCodec);
const ButtonPressMessage = envelope(ButtonPressContentCodec);
const TypingMessage = envelope(TypingContentCodec);
const SeenMessage = envelope(SeenContentCodec);
const BotInfoMessage = envelope(BotInfoContentCodec);
const BotInfoV2Message = envelope(BotInfoV2ContentCodec);
const BotInfoV3Message = envelope(BotInfoV3ContentCodec);
const TransactionReferenceMessage = envelope(TransactionReferenceCodec);
const GroupInfoMessage = envelope(GroupInfoCodec);
const GroupLeaveMessage = envelope(GroupLeaveCodec);
const GroupControlMessage = envelope(GroupControlCodec);
const AttachmentMessage = envelope(AttachmentContentCodec);
const RichTextMessage = envelope(RichTextContentCodec);
const CapabilitiesMessage = envelope(CapabilitiesCodec);
// `groupMessage`: the header and the wrapper's own fields; the inner content
// is the rest of the message (its kind byte and body).
const GroupMessageHead = Struct({ messageId: str, timestamp: u64, version: u8, kind: u8, groupId: str, infoVersion: u32, seq: u64 });
/**
 * The header of a message with an empty id and timestamp 0, without its kind
 * byte: prefixed to an inner content, the whole codec reads it as a message.
 */
const INNER_PREFIX = Header.enc({ messageId: '', timestamp: 0n, version: V1, kind: 0 }).slice(0, -1);

const toBytes = (value: Uint8Array | ArrayBuffer | string): Uint8Array =>
  value instanceof Uint8Array ? value : typeof value === 'string' ? hexToBytes(value) : new Uint8Array(value);

/** Decodes one extension kind strictly: the body must end the message; null otherwise. */
const decodeWith = <T>(codec: Codec<Envelope & { content: T }>, bytes: Uint8Array, toContent: (content: T) => ExtensionWire): ChatMessageWire | null => {
  try {
    const decoded = codec.dec(bytes);
    // Bytes after the body: not a well-formed message of this kind.
    if (codec.enc(decoded).length !== bytes.length) return null;
    return { messageId: decoded.messageId, timestamp: decoded.timestamp, versioned: { tag: 'v1', value: toContent(decoded.content) } };
  } catch {
    return null;
  }
};

/** A spec 0005/0006/0008 message this build cannot read past the header (coordinator ruling, docs/decisions.md M8). */
const undecodable = (header: Envelope): ChatMessageWire => ({
  messageId: header.messageId,
  timestamp: header.timestamp,
  versioned: { tag: 'v1', value: { tag: 'undecodable', value: { kind: header.kind } } },
});

const decodeExtension = (bytes: Uint8Array): ChatMessageWire | null => {
  let header: Envelope;
  try {
    header = Header.dec(bytes);
  } catch {
    return null;
  }
  if (header.version !== V1) return null;
  switch (header.kind) {
    case RICH_TEXT_KIND: {
      // Only a message with a spec 0014 `bulletin` item is ours to read; any
      // other richText goes to the SDK decoder as before (null here).
      let decoded: ReturnType<typeof RichTextMessage.dec>;
      try {
        decoded = RichTextMessage.dec(bytes);
      } catch {
        return null;
      }
      const files = decoded.content.attachments ?? [];
      if (!files.some(file => file.tag === 'bulletin')) return null;
      const bulletin = files.flatMap(file => (file.tag === 'bulletin' ? [file.value] : []));
      const fits =
        bulletin.length <= ATTACHMENT_BOUNDS.items &&
        bulletin.every(file => withinItemBounds(bulletinAsItem(file)) && (file.meta.tag === 'general' || (file.meta.value.thumbnail?.length ?? 0) <= ATTACHMENT_BOUNDS.blurhash)) &&
        (decoded.content.text === undefined || utf8Length(decoded.content.text) <= ATTACHMENT_BOUNDS.caption);
      if (!fits) return undecodable(header);
      return { messageId: decoded.messageId, timestamp: decoded.timestamp, versioned: { tag: 'v1', value: { tag: 'richText', value: decoded.content as RichTextWire['value'] } } };
    }
    case CAPABILITIES_KIND: {
      // Spec 0013 forward rule: fields of a later version are appended, so
      // bytes after `features` are ignored (not the strict end check).
      try {
        const decoded = CapabilitiesMessage.dec(bytes);
        if (decoded.content.version < 1) return undecodable(header);
        return { messageId: decoded.messageId, timestamp: decoded.timestamp, versioned: { tag: 'v1', value: { tag: 'capabilities', value: decoded.content } } };
      } catch {
        return undecodable(header);
      }
    }
    case DELETED_KIND:
      // A malformed `deleted` falls through to the SDK decode, which rejects
      // it: one unsupported entry, never a bubble.
      return decodeWith(DeletedMessage, bytes, target => ({ tag: 'deleted', value: { targetMessageId: target } }));
    case BUTTONS_KIND:
      return decodeWith(ButtonsMessage, bytes, value => ({ tag: 'buttons', value })) ?? undecodable(header);
    case BUTTON_PRESS_KIND:
      return decodeWith(ButtonPressMessage, bytes, value => ({ tag: 'buttonPress', value })) ?? undecodable(header);
    // A malformed signal is one entry this build cannot read: `undecodable`,
    // which content.ts turns into nothing (never a bubble).
    case TYPING_KIND:
      return decodeWith(TypingMessage, bytes, value => ({ tag: 'typing', value })) ?? undecodable(header);
    case SEEN_KIND:
      return decodeWith(SeenMessage, bytes, value => ({ tag: 'seen', value })) ?? undecodable(header);
    case BOT_INFO_KIND: {
      // v3 first (a hint with `pending`), then v2 (a hint that ends at `label`, or an
      // explicit None byte), then a v1 document that ends at `version`.
      const decoded =
        decodeWith(BotInfoV3Message, bytes, value => ({ tag: 'botInfo', value })) ??
        decodeWith(BotInfoV2Message, bytes, value => ({ tag: 'botInfo', value })) ??
        decodeWith(BotInfoMessage, bytes, value => ({ tag: 'botInfo', value: { ...value, balance: undefined } }));
      const value = decoded?.versioned.value;
      return decoded && value?.tag === 'botInfo' && withinBotInfoBounds(value.value) ? decoded : undecodable(header);
    }
    case TRANSACTION_REFERENCE_KIND: {
      const decoded = decodeWith(TransactionReferenceMessage, bytes, value => ({ tag: 'transactionReference', value }));
      const value = decoded?.versioned.value;
      return decoded && value?.tag === 'transactionReference' && withinReferenceBounds(value.value) ? decoded : undecodable(header);
    }
    case GROUP_INFO_KIND: {
      const decoded = decodeWith(GroupInfoMessage, bytes, value => ({ tag: 'groupInfo', value }));
      const value = decoded?.versioned.value;
      return decoded && value?.tag === 'groupInfo' && withinGroupBounds(value.value) ? decoded : undecodable(header);
    }
    case GROUP_MESSAGE_KIND:
      return decodeGroupMessage(bytes) ?? undecodable(header);
    case GROUP_LEAVE_KIND:
      return decodeWith(GroupLeaveMessage, bytes, value => ({ tag: 'groupLeave', value })) ?? undecodable(header);
    case GROUP_CONTROL_KIND: {
      const decoded = decodeWith(GroupControlMessage, bytes, value => ({ tag: 'groupControl', value }));
      const value = decoded?.versioned.value;
      return decoded && value?.tag === 'groupControl' && withinControlBounds(value.value) ? decoded : undecodable(header);
    }
    case ATTACHMENT_KIND: {
      // An unknown media or store tag (a later revision) cannot be read past
      // it: undecodable, which shows the unsupported bubble.
      const decoded = decodeWith(AttachmentMessage, bytes, value => ({ tag: 'attachment', value }) as AttachmentWire);
      const value = decoded?.versioned.value;
      return decoded && value?.tag === 'attachment' && withinAttachmentBounds(value.value) ? decoded : undecodable(header);
    }
    default:
      return null;
  }
};

/**
 * Spec 0009 `groupMessage`: the wrapper, then the inner content through the
 * whole codec (so an extension kind wraps as well as a base one). A group
 * kind inside, or an inner content that does not decode, makes the message
 * undecodable: a group message is never nested.
 */
const decodeGroupMessage = (bytes: Uint8Array): ChatMessageWire | null => {
  try {
    const head = GroupMessageHead.dec(bytes);
    const inner = bytes.slice(GroupMessageHead.enc(head).length);
    const kind = inner[0];
    if (kind === undefined || GROUP_KINDS.includes(kind)) return null;
    const wrapped = new Uint8Array(INNER_PREFIX.length + inner.length);
    wrapped.set(INNER_PREFIX);
    wrapped.set(inner, INNER_PREFIX.length);
    const content = ChatMessageCodec.dec(wrapped).versioned.value;
    if (content.tag === 'undecodable') return null;
    return {
      messageId: head.messageId,
      timestamp: head.timestamp,
      versioned: { tag: 'v1', value: { tag: 'groupMessage', value: { groupId: head.groupId, infoVersion: head.infoVersion, seq: head.seq, content } } },
    };
  } catch {
    return null;
  }
};

/** The inner content's bytes (kind byte and body) for a `groupMessage`. */
const encodeInner = (content: ChatContent): Uint8Array => {
  if (GROUP_KINDS_TAGS.includes(content.tag)) throw new Error('a group message cannot wrap a group kind');
  const whole = ChatMessageCodec.enc({ messageId: '', timestamp: 0n, versioned: { tag: 'v1', value: content } });
  return whole.slice(INNER_PREFIX.length);
};
const GROUP_KINDS_TAGS: readonly string[] = ['groupInfo', 'groupMessage', 'groupLeave', 'groupControl'];

/**
 * The app's `Message` codec: the SDK's `ChatMessage`, plus kind 21 `deleted`
 * (RFC-0003), kinds 240 `typing` / 241 `seen` (spec 0005), kinds 242
 * `buttons` / 243 `buttonPress` (spec 0006), kind 244 `botInfo` (spec 0008) and
 * kind 245 `transactionReference` (spec 0007), kinds 246 `groupInfo` /
 * 247 `groupMessage` / 248 `groupLeave` (spec 0009), kind 249
 * `groupControl` (spec 0011), and kind 250 `attachment` (spec 0012).
 * Every session in this app encodes and decodes through it.
 */
export const ChatMessageCodec: Codec<ChatMessageWire> = createCodec<ChatMessageWire>(
  message => {
    const content = message.versioned.value;
    const head = { messageId: message.messageId, timestamp: message.timestamp, version: V1 };
    switch (content.tag) {
      case 'richText':
        // The same bytes as the SDK's for a `p2pMixnet` item; `bulletin` is spec 0014's index 1.
        return RichTextMessage.enc({ ...head, kind: RICH_TEXT_KIND, content: content.value as never });
      case 'capabilities':
        return CapabilitiesMessage.enc({ ...head, kind: CAPABILITIES_KIND, content: content.value });
      case 'deleted':
        return DeletedMessage.enc({ ...head, kind: DELETED_KIND, content: content.value.targetMessageId });
      case 'buttons':
        return ButtonsMessage.enc({ ...head, kind: BUTTONS_KIND, content: content.value });
      case 'buttonPress':
        return ButtonPressMessage.enc({ ...head, kind: BUTTON_PRESS_KIND, content: content.value });
      case 'typing':
        return TypingMessage.enc({ ...head, kind: TYPING_KIND, content: content.value });
      case 'seen':
        return SeenMessage.enc({ ...head, kind: SEEN_KIND, content: content.value });
      case 'botInfo':
        // No hint: the v1 bytes, so a document without one reads the same everywhere.
        if (content.value.balance === undefined) return BotInfoMessage.enc({ ...head, kind: BOT_INFO_KIND, content: content.value });
        // v3 only when there is a pending value (0 included), so a hint without one keeps its v2 bytes.
        return content.value.balance.pending === undefined
          ? BotInfoV2Message.enc({ ...head, kind: BOT_INFO_KIND, content: { ...content.value, balance: content.value.balance } })
          : BotInfoV3Message.enc({ ...head, kind: BOT_INFO_KIND, content: { ...content.value, balance: { ...content.value.balance, pending: content.value.balance.pending } } });
      case 'transactionReference':
        return TransactionReferenceMessage.enc({ ...head, kind: TRANSACTION_REFERENCE_KIND, content: content.value });
      case 'groupInfo':
        return GroupInfoMessage.enc({ ...head, kind: GROUP_INFO_KIND, content: content.value });
      case 'groupLeave':
        return GroupLeaveMessage.enc({ ...head, kind: GROUP_LEAVE_KIND, content: content.value });
      case 'groupControl':
        if (!withinControlBounds(content.value)) throw new Error('groupControl outside the spec 0011 bounds');
        return GroupControlMessage.enc({ ...head, kind: GROUP_CONTROL_KIND, content: content.value });
      case 'attachment':
        return AttachmentMessage.enc({ ...head, kind: ATTACHMENT_KIND, content: content.value });
      case 'groupMessage': {
        const { groupId, infoVersion, seq } = content.value;
        const wrapper = GroupMessageHead.enc({ ...head, kind: GROUP_MESSAGE_KIND, groupId, infoVersion, seq });
        const inner = encodeInner(content.value.content);
        const out = new Uint8Array(wrapper.length + inner.length);
        out.set(wrapper);
        out.set(inner, wrapper.length);
        return out;
      }
      case 'undecodable':
        throw new Error('an undecodable message is receive-only');
      default:
        return SdkChatMessage.enc({ ...message, versioned: { tag: 'v1', value: content } });
    }
  },
  value => {
    const bytes = toBytes(value);
    return decodeExtension(bytes) ?? SdkChatMessage.dec(bytes);
  },
);

export type IdentityChannelEvent =
  | { tag: 'accepted'; requestId: string; device: PeerDevice; acceptedAt: number }
  | { tag: 'deviceAdded'; device: PeerDevice }
  | { tag: 'deviceRemoved'; statementAccountId: Uint8Array }
  /** `device`: spec 0013, for a `capabilities` in the same batch as a `deviceChatAccepted`: the device that accepted. */
  | { tag: 'message'; messageId: string; timestamp: number; content: ChatContent; device?: Uint8Array };

export const toIdentityChannelEvent = (message: ChatMessageWire): IdentityChannelEvent | null => {
  const content = message.versioned.value;
  const timestamp = Number(message.timestamp);
  switch (content.tag) {
    case 'deviceChatAccepted':
      return { tag: 'accepted', requestId: content.value.requestId, device: content.value.device, acceptedAt: timestamp };
    case 'chatAccepted':
      // Legacy single-device accept (@14) carries no DeviceInfo. Honouring it
      // would mean a synthetic device keyed by the identity account, which the
      // peer can never decrypt for. Better a request that stays pending.
      console.warn('[identity-channel] dropping legacy chatAccepted @14 for request %s', content.value.messageId);
      return null;
    case 'deviceAdded':
      return {
        tag: 'deviceAdded',
        device: { statementAccountId: content.value.statementAccountId, encryptionPublicKey: content.value.encryptionPublicKey },
      };
    case 'deviceRemoved':
      return { tag: 'deviceRemoved', statementAccountId: content.value.statementAccountId };
    default:
      return { tag: 'message', messageId: message.messageId, timestamp, content };
  }
};
