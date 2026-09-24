// Ported from polkadot-desktop src/domains/chat/p2p/session-transport/service.ts
// (`mapSdkContent`, `mapUiContentToSdk`), reduced to what this client shows.

/**
 * Chat content both ways between the wire (`ChatMessage` from
 * @novasamatech/host-chat) and the rows this app stores.
 *
 * Inbound is an *effect*, not always a message: a reaction or an edit changes
 * an existing row, a call offer is answered with `dataChannelClosed`, roster
 * variants go to the contact, and the rest is dropped with a warning.
 */

import type { BalanceHint } from '../../../shared/balanceHint';
import { openableUrl } from '../../../shared/openUrl';
import { decodeTxIntent } from '../../../shared/txIntent';
import { type HexString, bytesToHex, hexToBytes } from '../../app/bytes';

import { isBlurhash } from './blurhash';
import type { Capabilities } from './capabilities';
import {
  ATTACHMENT_KIND,
  type AttachmentItemWire,
  type AttachmentWire,
  BUTTONS_KIND,
  type BotInfoWire,
  type BulletinFileWire,
  type ButtonWire,
  type ChatContent,
  type FileMetaWire,
  type FileVariantWire,
  RICH_TEXT_KIND,
  type GroupControl,
  type GroupInfoWire,
  TRANSACTION_REFERENCE_KIND,
  type TransactionReferenceWire,
} from './identityEvents';

/** Spec 0005 `TypingContent.kind`, by wire value. */
export type TypingKind = 'composing' | 'working' | 'stopped';
const TYPING_KINDS: readonly TypingKind[] = ['composing', 'working', 'stopped'];

/**
 * A base-spec `P2PMixnet` (HOP) attachment of a `richText` (the phone apps).
 * `hop` says where and how to fetch it; a row stored before HOP receive has
 * none. On the message row `hop.ticket` is empty: the claim ticket is sealed
 * in the `keys` table (attachmentKeyStore.ts), as M15c's attachment keys are.
 */
export type Attachment = {
  kind: 'general' | 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  /** A video's length, seconds (`VideoFileMeta.duration`). */
  durationSecs?: number;
  /** The sender's placeholder (`thumbnail`: a blurhash in UTF-8), when it is one. */
  blurhash?: string | null;
  hop?: { identifier: HexString; node: string; ticket: Uint8Array };
};

/** Spec 0012 `Media`, as this client stores it. */
export type AttachmentMedia =
  | { kind: 'file' }
  | { kind: 'image'; width: number; height: number }
  | { kind: 'video'; width: number; height: number; durationMs: number }
  | { kind: 'voice'; durationMs: number; waveform: number[] };

/**
 * Spec 0012 `Attachment` (kind 250), as this client stores it. `key` and
 * `nonce` decrypt the chunks; `chunks` are their blake2b-256 hashes (the
 * Bulletin content hashes and CID digests). `size` and `expiresAt` fit a JS
 * number (25 MiB, ms since epoch).
 */
export type AttachmentItem = {
  mime: string;
  name: string | null;
  size: number;
  media: AttachmentMedia;
  blurhash: string | null;
  thumbnail: Uint8Array | null;
  key: Uint8Array;
  nonce: Uint8Array;
  chunkSize: number;
  chunks: Uint8Array[];
  store: { genesis: HexString; mirror: string | null };
  expiresAt: number;
  /** A view of a HOP attachment (`hopItemOf`): fetched by its message's ticket and node, never stored as this type. */
  via?: 'hop';
};

/**
 * A spec 0006 button action as this client stores it. `tx` keeps the spec
 * 0007 `TxIntent` bytes as sent (decoded again when pressed; bigints stay
 * out of the database). Anything this client may not run (a URL with
 * another scheme, a callback over the payload limit, intent bytes that do not
 * decode) is `unsupported`: shown, disabled. An action tag above 3 never gets
 * here: the message cannot be decoded at all.
 */
export type ButtonAction =
  | { kind: 'command'; command: string }
  | { kind: 'callback'; payload: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'tx'; intent: Uint8Array }
  | { kind: 'unsupported' };
export type ChatButton = { label: string; action: ButtonAction };

/** Spec 0006 limits. */
export const MAX_BUTTON_ROWS = 8;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_BUTTON_LABEL = 40;
export const MAX_CALLBACK_BYTES = 256;

export type { BalanceHint };

/** Spec 0008 `Command`: `name` without the slash. */
export type BotCommand = { name: string; description: string };

/**
 * Spec 0008 `BotInfo` as this client stores it. `kind` is the wire byte: 0
 * bot, 1 agent, 2 person-operated service; a later kind is kept as read.
 * `balance`: the v2 hint; missing on rows stored before v2, so read it as
 * `info.balance ?? null`.
 */
export type BotInfo = {
  kind: number;
  name: string;
  description: string;
  greeting: string;
  commands: BotCommand[];
  version: number;
  balance?: BalanceHint | null;
};

/** Spec 0007 `TransactionReference.status`, by wire value. */
export type TxStatus = 'submitted' | 'inBlock' | 'finalized' | 'failed';
export const TX_STATUSES: readonly TxStatus[] = ['submitted', 'inBlock', 'finalized', 'failed'];

/**
 * Spec 0007 `TransactionReference` as this client stores it. `hash` is 0x-hex
 * (the extrinsic hash). One row per transaction and direction: a later state
 * for the same hash updates the row (`applyReference`).
 */
export type TxReference = {
  chainId: string;
  hash: string;
  status: TxStatus;
  block: number | null;
  note: string;
  intentMessageId: string | null;
  /** Why our own transaction failed, in words; local only, never on the wire (the note says what it was). */
  error?: string | null;
};

/** Spec 0007 limit on `note`. */
export const MAX_REFERENCE_NOTE = 140;

/** Spec 0009 `Member` as this client stores it: the account as 0x-hex. */
export type GroupMember = { account: HexString; username: string; joinedAt: number };

/** Spec 0009 `GroupInfo` as this client reads and sends it. */
export type GroupInfo = {
  groupId: string;
  name: string;
  admin: HexString;
  members: GroupMember[];
  version: number;
  createdAt: number;
};

/** Spec 0009 limits. */
export const MAX_GROUP_MEMBERS = 16;
export const MAX_GROUP_NAME = 60;

/** What a message row holds. Reactions and edits are not rows; they mutate one. */
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'richText'; text: string | null; attachments: Attachment[] }
  | { type: 'reply'; messageId: string; text: string }
  | { type: 'contactAdded' }
  | { type: 'leftChat' }
  | { type: 'callDeclined' }
  | { type: 'unsupported'; tag: string }
  /** RFC-0003 tombstone: the text, attachments and edit history are gone; id and time stay. */
  | { type: 'deleted' }
  /**
   * Spec 0006 `buttons`: `text` is the bubble, `rows` the keyboard. `pressed`
   * is the first press on this device; a `oneShot` keyboard is gone after it.
   */
  | { type: 'buttons'; text: string; rows: ChatButton[][]; oneShot: boolean; pressed: { row: number; index: number } | null }
  /** System row: the peer pressed a button of a keyboard we sent (spec 0006). */
  | { type: 'buttonPressed'; label: string }
  /** System-style row: a bot's spec 0008 greeting, once, when its info first arrives. */
  | { type: 'botGreeting'; text: string }
  /** Spec 0007: a transaction and its latest state, from either side. */
  | { type: 'transactionReference'; reference: TxReference }
  /** Spec 0009 system row of a group room: a roster event, in words, or a sequence gap. */
  | { type: 'groupEvent'; text: string }
  /** A local line of a local room (the Faucet): `error` shows in the error colour. */
  | { type: 'notice'; text: string; tone: 'info' | 'error' }
  /** Spec 0012: 1 to 4 encrypted files on the Bulletin chain, and a caption. */
  | { type: 'attachment'; items: AttachmentItem[]; caption: string | null };

/** What this client can put on the wire. */
export type OutgoingContent =
  | { type: 'text'; text: string }
  | { type: 'reply'; messageId: string; text: string }
  | { type: 'reaction'; messageId: string; emoji: string; add: boolean }
  | { type: 'edit'; messageId: string; text: string }
  | { type: 'callDecline'; offerMessageId: string }
  /** RFC-0003 delete for everyone: asks the peer to tombstone our message `targetMessageId`. */
  | { type: 'deleted'; targetMessageId: string }
  /** Spec 0006: a keyboard. Only test scripts send one in M8 (docs/decisions.md). */
  | { type: 'buttons'; text: string; rows: ButtonWire[][]; oneShot: boolean }
  /** Spec 0006: a callback button of the peer's message `messageId` was pressed. */
  | { type: 'buttonPress'; messageId: string; row: number; index: number; payload: Uint8Array }
  /** Spec 0005: an ephemeral typing hint; never a row. */
  | { type: 'typing'; kind: TypingKind; until: number }
  /** Spec 0005: a read receipt for the peer's messages up to `upTo`; never a row. */
  | { type: 'seen'; upTo: string; at: number }
  /** Spec 0008: a bot describes itself. A person's client never sends it; test scripts do. */
  | { type: 'botInfo'; info: BotInfo }
  /** Spec 0007: the state of a transaction this client submitted. */
  | { type: 'transactionReference'; reference: TxReference }
  /** Spec 0009: the roster (the admin sends it). */
  | { type: 'groupInfo'; info: GroupInfo }
  /** Spec 0009: any other content, for the group; the same envelope id on every copy. */
  | { type: 'groupMessage'; groupId: string; infoVersion: number; seq: number; content: OutgoingContent }
  /** Spec 0009: "I left" (spec 0011 reuses it inside a carrier). */
  | { type: 'groupLeave'; groupId: string }
  /** Spec 0011: pairwise group control (kind 249). */
  | { type: 'groupControl'; control: GroupControl }
  /** Spec 0012: an attachment whose chunks are in a best block already. */
  | { type: 'attachment'; items: AttachmentItem[]; caption: string | null }
  /** Spec 0014: the same files as `RichText` + `FileVariant.bulletin` (a peer whose every device lists variant 1). */
  | { type: 'bulletinFile'; items: AttachmentItem[]; caption: string | null }
  /** Base spec HOP: one file on a HOP node (`hop` with its ticket), as the phones send it. */
  | { type: 'hopFile'; text: string | null; attachment: Attachment }
  /** Spec 0013: this device's supported set; never a row. */
  | { type: 'capabilities'; capabilities: Capabilities };

export type IncomingEffect =
  | { kind: 'message'; content: MessageContent }
  | { kind: 'reaction'; messageId: string; emoji: string; add: boolean }
  | { kind: 'edit'; messageId: string; text: string }
  | { kind: 'deleted'; targetMessageId: string }
  | { kind: 'buttonPress'; messageId: string; row: number; index: number }
  | { kind: 'typing'; typing: TypingKind; until: number }
  | { kind: 'seen'; upTo: string; at: number }
  | { kind: 'botInfo'; info: BotInfo }
  /** Spec 0007: merged into the row of the same hash, or a new row. */
  | { kind: 'transactionReference'; reference: TxReference }
  /** Spec 0009: a roster; the manager checks who sent it. */
  | { kind: 'groupInfo'; info: GroupInfo }
  /** Spec 0009: the wrapped content's own effect, for the group. */
  | { kind: 'groupMessage'; groupId: string; infoVersion: number; seq: number; effect: IncomingEffect }
  | { kind: 'groupLeave'; groupId: string }
  /** Spec 0011: a pairwise group control; the manager checks who sent it. */
  | { kind: 'groupControl'; control: GroupControl }
  | { kind: 'callOffer' }
  | { kind: 'deviceAdded'; statementAccountId: Uint8Array; encryptionPublicKey: Uint8Array }
  | { kind: 'deviceRemoved'; statementAccountId: Uint8Array }
  /** Spec 0013: the sending device's set; the manager keys it by that device. */
  | { kind: 'capabilities'; capabilities: Capabilities }
  | { kind: 'ignore' };

export const toWire = (content: OutgoingContent): ChatContent => {
  switch (content.type) {
    case 'text':
      return { tag: 'text', value: content.text };
    case 'reply':
      return { tag: 'reply', value: { messageId: content.messageId, ownContent: { text: content.text, attachments: undefined } } };
    case 'reaction':
      return { tag: content.add ? 'reacted' : 'reactionRemoved', value: { messageId: content.messageId, emoji: content.emoji } };
    case 'edit':
      return { tag: 'edit', value: { messageId: content.messageId, newContent: { text: content.text, attachments: undefined } } };
    case 'callDecline':
      return { tag: 'dataChannelClosed', value: { offerMessageId: content.offerMessageId } };
    case 'deleted':
      return { tag: 'deleted', value: { targetMessageId: content.targetMessageId } };
    case 'buttons':
      return { tag: 'buttons', value: { text: content.text, rows: content.rows, oneShot: content.oneShot } };
    case 'buttonPress':
      return {
        tag: 'buttonPress',
        value: { messageId: content.messageId, row: content.row, index: content.index, payload: content.payload },
      };
    case 'typing':
      return { tag: 'typing', value: { until: BigInt(content.until), kind: TYPING_KINDS.indexOf(content.kind) } };
    case 'seen':
      return { tag: 'seen', value: { upTo: content.upTo, at: BigInt(content.at) } };
    case 'botInfo':
      return { tag: 'botInfo', value: botInfoWire(content.info) };
    case 'transactionReference':
      return { tag: 'transactionReference', value: referenceWire(content.reference) };
    case 'groupInfo':
      return { tag: 'groupInfo', value: groupInfoWire(content.info) };
    case 'groupMessage':
      return {
        tag: 'groupMessage',
        value: { groupId: content.groupId, infoVersion: content.infoVersion, seq: BigInt(content.seq), content: toWire(content.content) },
      };
    case 'groupLeave':
      return { tag: 'groupLeave', value: { groupId: content.groupId } };
    case 'groupControl':
      return { tag: 'groupControl', value: content.control };
    case 'attachment':
      return { tag: 'attachment', value: { items: content.items.map(attachmentItemWire), caption: content.caption ?? undefined } };
    case 'bulletinFile':
      return { tag: 'richText', value: { text: content.caption ?? undefined, attachments: content.items.map(item => ({ tag: 'bulletin', value: bulletinFileWire(item) })) } };
    case 'hopFile':
      return { tag: 'richText', value: { text: content.text ?? undefined, attachments: [hopFileWire(content.attachment)] } };
    case 'capabilities':
      return { tag: 'capabilities', value: { ...content.capabilities, fileVariants: [...content.capabilities.fileVariants], hopDialects: [...content.capabilities.hopDialects] } };
  }
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A base `GeneralFileMeta` for a file of `mime` and `size`. */
const generalMeta = (mimeType: string, fileSize: number) => ({ mimeType, fileSize });

/**
 * Spec 0014 "Mapping from the 0012 Attachment": the blurhash goes in the base
 * `FileMeta.thumbnail` (UTF-8, as the phones send it), the 0012 thumbnail is
 * `preview`, a voice note is `general` plus `voice`, a video's length is in
 * whole seconds (the base `VideoFileMeta` has no width or height).
 */
export const bulletinFileWire = (item: AttachmentItem): BulletinFileWire => {
  const general = generalMeta(item.mime, item.size);
  const thumbnail = item.blurhash ? utf8(item.blurhash) : undefined;
  const meta: FileMetaWire =
    item.media.kind === 'image'
      ? { tag: 'image', value: { general, width: item.media.width, height: item.media.height, thumbnail } }
      : item.media.kind === 'video'
        ? { tag: 'video', value: { general, duration: Math.ceil(item.media.durationMs / 1000), thumbnail } }
        : { tag: 'general', value: general };
  return {
    meta,
    name: item.name ?? undefined,
    preview: item.thumbnail ?? undefined,
    voice: item.media.kind === 'voice' ? { durationMs: item.media.durationMs, waveform: Uint8Array.from(item.media.waveform) } : undefined,
    key: item.key,
    nonce: item.nonce,
    chunkSize: item.chunkSize,
    chunks: item.chunks,
    store: { tag: 'bulletin', value: { genesis: hexToBytes(item.store.genesis), mirror: item.store.mirror ?? undefined } },
    expiresAt: BigInt(item.expiresAt),
  };
};

/** A frame for a video whose width and height the base meta does not carry (0014 Unresolved 2). */
const VIDEO_FRAME = { width: 16, height: 9 };

/** A received `bulletin` item as the 0012 row stores it: the kind-250 twin gives the same item. */
const bulletinItemOf = (file: BulletinFileWire): AttachmentItem => {
  const meta = file.meta;
  const general = meta.tag === 'general' ? meta.value : meta.value.general;
  const thumbnail = meta.tag === 'general' ? undefined : meta.value.thumbnail;
  const media: AttachmentMedia = file.voice
    ? { kind: 'voice', durationMs: file.voice.durationMs, waveform: [...file.voice.waveform] }
    : meta.tag === 'image'
      ? { kind: 'image', width: meta.value.width, height: meta.value.height }
      : meta.tag === 'video'
        ? { kind: 'video', ...VIDEO_FRAME, durationMs: meta.value.duration * 1000 }
        : { kind: 'file' };
  return {
    mime: general.mimeType,
    name: file.name ?? null,
    size: general.fileSize,
    media,
    blurhash: thumbnail && thumbnail.length > 0 ? new TextDecoder().decode(thumbnail) : null,
    thumbnail: file.preview ?? null,
    key: file.key,
    nonce: file.nonce,
    chunkSize: file.chunkSize,
    chunks: file.chunks,
    store: { genesis: bytesToHex(file.store.value.genesis), mirror: file.store.value.mirror ?? null },
    expiresAt: Number(file.expiresAt),
  };
};

/** Base spec `P2PMixnetFile` for a file this client put on a HOP node; `meta.thumbnail` is the blurhash, as the phones send it. */
export const hopFileWire = (attachment: Attachment): FileVariantWire => {
  if (!attachment.hop) throw new Error('This file is not on a HOP node yet.');
  const general = generalMeta(attachment.mimeType, attachment.fileSize);
  const thumbnail = attachment.blurhash ? utf8(attachment.blurhash) : undefined;
  const meta: FileMetaWire =
    attachment.kind === 'image' && attachment.width && attachment.height
      ? { tag: 'image', value: { general, width: attachment.width, height: attachment.height, thumbnail } }
      : attachment.kind === 'video'
        ? { tag: 'video', value: { general, duration: attachment.durationSecs ?? 0, thumbnail } }
        : { tag: 'general', value: general };
  return {
    tag: 'p2pMixnet',
    value: {
      identifier: hexToBytes(attachment.hop.identifier),
      claimTicket: attachment.hop.ticket,
      nodeEndpoint: { tag: 'wssUrl', value: { url: attachment.hop.node } },
      meta,
    },
  } as FileVariantWire;
};

const mediaWire = (media: AttachmentMedia): AttachmentItemWire['media'] => {
  switch (media.kind) {
    case 'file':
      return { tag: 'file', value: undefined };
    case 'image':
      return { tag: 'image', value: { width: media.width, height: media.height } };
    case 'video':
      return { tag: 'video', value: { width: media.width, height: media.height, durationMs: media.durationMs } };
    case 'voice':
      return { tag: 'voice', value: { durationMs: media.durationMs, waveform: Uint8Array.from(media.waveform) } };
  }
};

const mediaOf = (media: AttachmentItemWire['media']): AttachmentMedia => {
  switch (media.tag) {
    case 'file':
      return { kind: 'file' };
    case 'image':
      return { kind: 'image', width: media.value.width, height: media.value.height };
    case 'video':
      return { kind: 'video', width: media.value.width, height: media.value.height, durationMs: media.value.durationMs };
    case 'voice':
      return { kind: 'voice', durationMs: media.value.durationMs, waveform: [...media.value.waveform] };
  }
};

export const attachmentItemWire = (item: AttachmentItem): AttachmentItemWire => ({
  mime: item.mime,
  name: item.name ?? undefined,
  size: BigInt(item.size),
  media: mediaWire(item.media),
  blurhash: item.blurhash ?? undefined,
  thumbnail: item.thumbnail ?? undefined,
  key: item.key,
  nonce: item.nonce,
  chunkSize: item.chunkSize,
  chunks: item.chunks,
  store: { tag: 'bulletin', value: { genesis: hexToBytes(item.store.genesis), mirror: item.store.mirror ?? undefined } },
  expiresAt: BigInt(item.expiresAt),
});

const attachmentItemOf = (item: AttachmentItemWire): AttachmentItem => ({
  mime: item.mime,
  name: item.name ?? null,
  size: Number(item.size),
  media: mediaOf(item.media),
  blurhash: item.blurhash ?? null,
  thumbnail: item.thumbnail ?? null,
  key: item.key,
  nonce: item.nonce,
  chunkSize: item.chunkSize,
  chunks: item.chunks,
  store: { genesis: bytesToHex(item.store.value.genesis), mirror: item.store.value.mirror ?? null },
  expiresAt: Number(item.expiresAt),
});

const attachmentOfWire = (value: AttachmentWire['value']): MessageContent => ({
  type: 'attachment',
  items: value.items.map(attachmentItemOf),
  caption: value.caption ?? null,
});

const groupInfoWire = (info: GroupInfo): GroupInfoWire['value'] => ({
  groupId: info.groupId,
  name: clip(info.name, MAX_GROUP_NAME),
  admin: hexToBytes(info.admin),
  members: info.members.map(member => ({ account: hexToBytes(member.account), username: member.username, joinedAt: BigInt(member.joinedAt) })),
  version: info.version,
  createdAt: BigInt(info.createdAt),
});

const groupInfoOf = (value: GroupInfoWire['value']): GroupInfo => ({
  groupId: value.groupId,
  name: value.name,
  admin: bytesToHex(value.admin),
  members: value.members.map(member => ({ account: bytesToHex(member.account), username: member.username, joinedAt: Number(member.joinedAt) })),
  version: value.version,
  createdAt: Number(value.createdAt),
});

const referenceWire = (reference: TxReference): TransactionReferenceWire['value'] => ({
  chainId: reference.chainId,
  hash: hexToBytes(reference.hash),
  status: TX_STATUSES.indexOf(reference.status),
  block: reference.block ?? undefined,
  note: clip(reference.note, MAX_REFERENCE_NOTE),
  intentMessageId: reference.intentMessageId ?? undefined,
});

/** A received reference; null for a status byte this build does not know. */
const referenceOf = (value: TransactionReferenceWire['value']): TxReference | null => {
  const status = TX_STATUSES[value.status];
  if (!status) return null;
  return {
    chainId: value.chainId,
    hash: bytesToHex(value.hash),
    status,
    block: value.block ?? null,
    note: value.note,
    intentMessageId: value.intentMessageId ?? null,
  };
};

const botInfoWire = (info: BotInfo): BotInfoWire['value'] => ({
  kind: info.kind,
  name: info.name,
  description: info.description,
  greeting: info.greeting,
  commands: info.commands.map(command => ({ name: command.name, description: command.description })),
  version: info.version,
  balance: info.balance
    ? {
        chainId: info.balance.chainId,
        contract: hexToBytes(info.balance.contract),
        selector: hexToBytes(info.balance.selector),
        decimals: info.balance.decimals,
        unit: info.balance.unit,
        perReply: info.balance.perReply === null ? undefined : BigInt(info.balance.perReply),
        label: info.balance.label,
        ...(info.balance.pending === undefined ? {} : { pending: BigInt(info.balance.pending) }),
      }
    : undefined,
});

const botInfoOf = (value: BotInfoWire['value']): BotInfo => ({
  kind: value.kind,
  name: value.name,
  description: value.description,
  greeting: value.greeting,
  commands: value.commands.map(command => ({ name: command.name, description: command.description })),
  version: value.version,
  balance: value.balance
    ? {
        chainId: value.balance.chainId,
        contract: bytesToHex(value.balance.contract),
        selector: bytesToHex(value.balance.selector),
        decimals: value.balance.decimals,
        unit: value.balance.unit,
        perReply: value.balance.perReply === undefined ? null : value.balance.perReply.toString(),
        label: value.balance.label,
        // v3: absent (a v2 hint, or None) means 0 and is left out, so a v2 hint stays as it was stored.
        ...(value.balance.pending === undefined ? {} : { pending: value.balance.pending.toString() }),
      }
    : null,
});

/** Cut to `max` characters (code points, so an emoji is not split). */
const clip = (text: string, max: number): string => {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
};

const actionOf = (action: ButtonWire['action']): ButtonAction => {
  switch (action.tag) {
    case 'command':
      return { kind: 'command', command: action.value };
    case 'callback':
      return action.value.length <= MAX_CALLBACK_BYTES ? { kind: 'callback', payload: action.value } : { kind: 'unsupported' };
    case 'url':
      return openableUrl(action.value) ? { kind: 'url', url: action.value } : { kind: 'unsupported' };
    case 'tx':
      // Spec 0007: runnable only when the intent decodes; the checks against
      // the chain and the clock run when it is pressed.
      return decodeTxIntent(action.value) ? { kind: 'tx', intent: action.value } : { kind: 'unsupported' };
    default:
      return { kind: 'unsupported' };
  }
};

/**
 * Spec 0006 limits on a received keyboard: at most 8 rows of 4 buttons, labels
 * of at most 40 characters. Over them the whole `buttons` message is rejected
 * (the unsupported bubble), as pca's decoder does (M8 review: a cut keyboard
 * misrepresents the bot, so both clients reject).
 */
export const keyboardFits = (rows: readonly ButtonWire[][]): boolean =>
  rows.length <= MAX_BUTTON_ROWS && rows.every(row => row.length <= MAX_BUTTONS_PER_ROW && row.every(button => [...button.label].length <= MAX_BUTTON_LABEL));

/**
 * The stored keyboard of a `buttons` message. A received one is within the
 * limits already (`keyboardFits`); the cuts guard the local paths (the
 * Assistant's block, our own sends). Row and button positions are kept, so a
 * press names the sender's indexes.
 */
export const keyboardOf = (rows: readonly ButtonWire[][]): ChatButton[][] =>
  rows
    .slice(0, MAX_BUTTON_ROWS)
    .map(row => row.slice(0, MAX_BUTTONS_PER_ROW).map(button => ({ label: clip(button.label, MAX_BUTTON_LABEL), action: actionOf(button.action) })));

type P2PMixnetWire = {
  identifier: Uint8Array;
  claimTicket: Uint8Array;
  nodeEndpoint: { tag: string; value: { url: string } };
  meta: { tag: string; value: unknown };
};
type GeneralMetaWire = { mimeType: string; fileSize: number };

/** The phones send a 4×3 blurhash as the thumbnail (host-chat `MediaThumbnail`); anything else is dropped. */
const blurhashOf = (thumbnail: Uint8Array | undefined): string | null => {
  if (!thumbnail || thumbnail.length < 6 || thumbnail.length > 128) return null;
  const text = new TextDecoder().decode(thumbnail);
  return isBlurhash(text) ? text : null;
};

const attachmentOf = (file: { tag: string; value: unknown }): Attachment | null => {
  if (file.tag !== 'p2pMixnet') return null;
  const value = file.value as P2PMixnetWire;
  const meta = value.meta;
  if (meta.tag !== 'general' && meta.tag !== 'image' && meta.tag !== 'video') return null;
  const general = (meta.tag === 'general' ? meta.value : (meta.value as { general?: unknown }).general) as GeneralMetaWire | undefined;
  if (!general) return null;
  const attachment: Attachment = { kind: meta.tag, mimeType: general.mimeType, fileSize: general.fileSize };
  if (meta.tag === 'image') {
    const image = meta.value as { width: number; height: number; thumbnail?: Uint8Array };
    Object.assign(attachment, { width: image.width, height: image.height, blurhash: blurhashOf(image.thumbnail) });
  }
  if (meta.tag === 'video') {
    const video = meta.value as { duration: number; thumbnail?: Uint8Array };
    Object.assign(attachment, { durationSecs: video.duration, blurhash: blurhashOf(video.thumbnail) });
  }
  // A 32-byte id and ticket and a wss URL, or the attachment shows without a download.
  const node = value.nodeEndpoint?.tag === 'wssUrl' ? value.nodeEndpoint.value.url : null;
  if (value.identifier?.length === 32 && value.claimTicket?.length === 32 && node) {
    attachment.hop = { identifier: bytesToHex(value.identifier), node, ticket: new Uint8Array(value.claimTicket) };
  }
  return attachment;
};

export const fromWire = (content: ChatContent): IncomingEffect => {
  switch (content.tag) {
    case 'text':
      return { kind: 'message', content: { type: 'text', text: content.value } };
    case 'richText': {
      // Spec 0014: `bulletin` items map to the 0012 row (the kind-250 twin's).
      // A mixed message (never sent by a client that follows 0014) keeps its HOP items.
      const files = content.value.attachments ?? [];
      if (files.length > 0 && files.every(file => file.tag === 'bulletin')) {
        return {
          kind: 'message',
          content: { type: 'attachment', items: files.map(file => bulletinItemOf((file as { value: BulletinFileWire }).value)), caption: content.value.text ?? null },
        };
      }
      return {
        kind: 'message',
        content: {
          type: 'richText',
          text: content.value.text ?? null,
          attachments: files.map(attachmentOf).filter((a): a is Attachment => a !== null),
        },
      };
    }
    case 'capabilities':
      // Spec 0013: never a row, never a notification; the manager stores it per sending device.
      return { kind: 'capabilities', capabilities: content.value };
    case 'reply':
      return {
        kind: 'message',
        content: { type: 'reply', messageId: content.value.messageId, text: content.value.ownContent.text ?? '' },
      };
    case 'reacted':
      return { kind: 'reaction', messageId: content.value.messageId, emoji: content.value.emoji, add: true };
    case 'reactionRemoved':
      return { kind: 'reaction', messageId: content.value.messageId, emoji: content.value.emoji, add: false };
    case 'edit':
      return { kind: 'edit', messageId: content.value.messageId, text: content.value.newContent.text ?? '' };
    case 'deleted':
      return { kind: 'deleted', targetMessageId: content.value.targetMessageId };
    case 'buttons':
      if (!keyboardFits(content.value.rows)) return { kind: 'message', content: { type: 'unsupported', tag: 'buttons' } };
      return {
        kind: 'message',
        content: { type: 'buttons', text: content.value.text, rows: keyboardOf(content.value.rows), oneShot: content.value.oneShot, pressed: null },
      };
    case 'buttonPress':
      // Never a bubble: the manager checks it against the keyboard we sent.
      return { kind: 'buttonPress', messageId: content.value.messageId, row: content.value.row, index: content.value.index };
    case 'typing': {
      // Spec 0005: never a bubble. A kind this build does not know is nothing.
      const typing = TYPING_KINDS[content.value.kind];
      return typing ? { kind: 'typing', typing, until: Number(content.value.until) } : { kind: 'ignore' };
    }
    case 'seen':
      return { kind: 'seen', upTo: content.value.upTo, at: Number(content.value.at) };
    case 'botInfo':
      // Spec 0008: never a bubble; the manager stores it per peer.
      return { kind: 'botInfo', info: botInfoOf(content.value) };
    case 'transactionReference': {
      const reference = referenceOf(content.value);
      return reference ? { kind: 'transactionReference', reference } : { kind: 'message', content: { type: 'unsupported', tag: 'transactionReference' } };
    }
    case 'groupInfo':
      return { kind: 'groupInfo', info: groupInfoOf(content.value) };
    case 'groupMessage':
      return {
        kind: 'groupMessage',
        groupId: content.value.groupId,
        infoVersion: content.value.infoVersion,
        seq: Number(content.value.seq),
        effect: fromWire(content.value.content),
      };
    case 'groupLeave':
      return { kind: 'groupLeave', groupId: content.value.groupId };
    case 'groupControl':
      return { kind: 'groupControl', control: content.value };
    case 'attachment':
      return { kind: 'message', content: attachmentOfWire(content.value) };
    case 'undecodable':
      // A keyboard or a reference we cannot read is still a message the peer
      // sent: the unsupported bubble. A press, typing, seen or botInfo we
      // cannot read is nothing.
      if (content.value.kind === BUTTONS_KIND) return { kind: 'message', content: { type: 'unsupported', tag: 'buttons' } };
      if (content.value.kind === TRANSACTION_REFERENCE_KIND) return { kind: 'message', content: { type: 'unsupported', tag: 'transactionReference' } };
      if (content.value.kind === ATTACHMENT_KIND || content.value.kind === RICH_TEXT_KIND) return { kind: 'message', content: { type: 'unsupported', tag: 'attachment' } };
      return { kind: 'ignore' };
    case 'leftChat':
      return { kind: 'message', content: { type: 'leftChat' } };
    case 'contactAdded':
      return { kind: 'message', content: { type: 'contactAdded' } };
    case 'dataChannelOffer':
      return { kind: 'callOffer' };
    case 'deviceAdded':
      return {
        kind: 'deviceAdded',
        statementAccountId: content.value.statementAccountId,
        encryptionPublicKey: content.value.encryptionPublicKey,
      };
    case 'deviceRemoved':
      return { kind: 'deviceRemoved', statementAccountId: content.value.statementAccountId };
    // Call signalling other than the offer, push tokens and accepts (the
    // identity channel owns those) carry nothing to show.
    case 'dataChannelAnswer':
    case 'dataChannelIceCandidate':
    case 'dataChannelClosed':
    case 'token':
    case 'chatAccepted':
    case 'deviceChatAccepted':
      return { kind: 'ignore' };
    // Payments decode fine but this client cannot act on them; show that a
    // message exists rather than hiding it.
    case 'send':
    case 'coinagePayment':
      return { kind: 'message', content: { type: 'unsupported', tag: content.tag } };
    default:
      console.warn('[chat-content] dropping unknown content tag', (content as { tag: string }).tag);
      return { kind: 'ignore' };
  }
};

/** One line for the chat list. */
/** M15c: an Ask to resend reads "Please resend the photo" in a preview, without its local link. */
const withoutResendLinks = (text: string): string => text.replace(/\[([^\]]*)\]\(#resend\/[\w-]{1,64}\)/g, '$1');

export const previewOf = (content: MessageContent): string => {
  switch (content.type) {
    case 'text':
      return withoutResendLinks(content.text);
    case 'reply':
      return content.text;
    case 'richText':
      return content.text ?? (content.attachments.length > 0 ? `[${content.attachments.length} attachment(s)]` : '');
    case 'contactAdded':
      return 'Chat accepted';
    case 'leftChat':
      return 'Left the chat';
    case 'callDeclined':
      return 'Call declined';
    case 'unsupported':
      return `Unsupported message (${content.tag})`;
    case 'deleted':
      return 'Message deleted';
    case 'buttons':
      return content.text;
    case 'buttonPressed':
      return `Pressed ${content.label}`;
    case 'botGreeting':
      return content.text;
    case 'transactionReference':
      return referenceLine(content.reference);
    case 'groupEvent':
    case 'notice':
      return content.text;
    case 'attachment':
      return attachmentPreview(content.items, content.caption);
  }
};

const minutesSeconds = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Spec 0012 "Fallback": the caption, else "Photo", "Video", "Voice message
 * (0:42)", "File: <name>"; "2 photos" for an album of images.
 */
export const attachmentPreview = (items: readonly AttachmentItem[], caption: string | null): string => {
  if (caption && caption.trim() !== '') return caption;
  const [first] = items;
  if (!first) return 'sent an attachment';
  if (items.length > 1) return items.every(item => item.media.kind === 'image') ? `${items.length} photos` : `${items.length} attachments`;
  switch (first.media.kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return `Voice message (${minutesSeconds(first.media.durationMs)})`;
    case 'file':
      return `File: ${first.name ?? 'Attachment'}`;
  }
};

/**
 * M12g: the payment of a request carries `req:<messageId>` first in its
 * `note`, then the person's note (docs/decisions.md "## M12g"). The id of the
 * request, or null for any other note.
 */
export const requestIdOfNote = (note: string): string | null => /^req:(\S+)/.exec(note)?.[1] ?? null;

/** The note without a `req:<messageId>` marker: the words a person wrote. */
export const noteWords = (note: string): string => note.replace(/^req:\S+ ?/, '').trim();

/** "Top-up of 1 PAS · in block #123"; the note, or "Transaction" without one. */
export const referenceLine = (reference: TxReference): string => {
  // The payment of a request: the marker is for clients, not for people.
  const what = (requestIdOfNote(reference.note) !== null ? noteWords(reference.note) || 'Payment' : reference.note.trim()) || 'Transaction';
  switch (reference.status) {
    case 'submitted':
      return `${what} · submitted`;
    case 'inBlock':
      return `${what} · in block${reference.block !== null ? ` #${reference.block}` : ''}`;
    case 'finalized':
      return `${what} · finalized${reference.block !== null ? ` in block #${reference.block}` : ''}`;
    case 'failed':
      return `${what} · failed${reference.error ? `: ${reference.error}` : ''}`;
  }
};

/** Spec 0007 states only move forward; a late "submitted" never undoes "in block". */
export const referenceRank = (status: TxStatus): number => TX_STATUSES.indexOf(status);

/**
 * A `pca` bot's live progress placeholder (bot-core `live-reply.mjs`): a text
 * message `⏳ working · 12s · step 2` plus action lines, edited in place until
 * the turn ends. `pca`'s first placeholder, "🤔 One moment — thinking…", is
 * the same kind of status (M7 review carry item 1). It is not an answer, so
 * it renders as a thinking row.
 */
const LIVE_FRAME_PREFIX = /^(?:⏳|🤔) /u;

export const isLiveFrame = (content: MessageContent): boolean => content.type === 'text' && LIVE_FRAME_PREFIX.test(content.text);

/** The frame without its hourglass (or thinking face), for the thinking row. */
export const liveFrameText = (text: string): string => text.replace(LIVE_FRAME_PREFIX, '');
