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

import { openableUrl } from '../../../shared/openUrl';
import { decodeTxIntent } from '../../../shared/txIntent';
import { bytesToHex, hexToBytes } from '../../app/bytes';

import {
  BUTTONS_KIND,
  type BotInfoWire,
  type ButtonWire,
  type ChatContent,
  TRANSACTION_REFERENCE_KIND,
  type TransactionReferenceWire,
} from './identityEvents';

/** Spec 0005 `TypingContent.kind`, by wire value. */
export type TypingKind = 'composing' | 'working' | 'stopped';
const TYPING_KINDS: readonly TypingKind[] = ['composing', 'working', 'stopped'];

export type Attachment = {
  kind: 'general' | 'image' | 'video';
  mimeType: string;
  fileSize: number;
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

/** Spec 0008 `Command`: `name` without the slash. */
export type BotCommand = { name: string; description: string };

/**
 * Spec 0008 `BotInfo` as this client stores it. `kind` is the wire byte: 0
 * bot, 1 agent, 2 person-operated service; a later kind is kept as read.
 */
export type BotInfo = {
  kind: number;
  name: string;
  description: string;
  greeting: string;
  commands: BotCommand[];
  version: number;
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
  | { type: 'transactionReference'; reference: TxReference };

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
  | { type: 'transactionReference'; reference: TxReference };

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
  | { kind: 'callOffer' }
  | { kind: 'deviceAdded'; statementAccountId: Uint8Array; encryptionPublicKey: Uint8Array }
  | { kind: 'deviceRemoved'; statementAccountId: Uint8Array }
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
  }
};

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
 * The stored keyboard of a received `buttons`: within the spec's limits
 * (extra rows and buttons are dropped, long labels cut). Row and button
 * positions are kept, so a press names the sender's indexes.
 */
export const keyboardOf = (rows: readonly ButtonWire[][]): ChatButton[][] =>
  rows
    .slice(0, MAX_BUTTON_ROWS)
    .map(row => row.slice(0, MAX_BUTTONS_PER_ROW).map(button => ({ label: clip(button.label, MAX_BUTTON_LABEL), action: actionOf(button.action) })));

const attachmentOf = (file: { tag: string; value: { meta: { tag: string; value: unknown } } }): Attachment | null => {
  if (file.tag !== 'p2pMixnet') return null;
  const meta = file.value.meta;
  const general = (meta.tag === 'general' ? meta.value : (meta.value as { general?: unknown }).general) as
    | { mimeType: string; fileSize: number }
    | undefined;
  if (!general || meta.tag !== 'general' && meta.tag !== 'image' && meta.tag !== 'video') return null;
  return { kind: meta.tag, mimeType: general.mimeType, fileSize: general.fileSize };
};

export const fromWire = (content: ChatContent): IncomingEffect => {
  switch (content.tag) {
    case 'text':
      return { kind: 'message', content: { type: 'text', text: content.value } };
    case 'richText':
      return {
        kind: 'message',
        content: {
          type: 'richText',
          text: content.value.text ?? null,
          attachments: (content.value.attachments ?? []).map(attachmentOf).filter((a): a is Attachment => a !== null),
        },
      };
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
      return { kind: 'botInfo', info: { ...content.value, commands: content.value.commands.map(command => ({ ...command })) } };
    case 'transactionReference': {
      const reference = referenceOf(content.value);
      return reference ? { kind: 'transactionReference', reference } : { kind: 'message', content: { type: 'unsupported', tag: 'transactionReference' } };
    }
    case 'undecodable':
      // A keyboard or a reference we cannot read is still a message the peer
      // sent: the unsupported bubble. A press, typing, seen or botInfo we
      // cannot read is nothing.
      if (content.value.kind === BUTTONS_KIND) return { kind: 'message', content: { type: 'unsupported', tag: 'buttons' } };
      if (content.value.kind === TRANSACTION_REFERENCE_KIND) return { kind: 'message', content: { type: 'unsupported', tag: 'transactionReference' } };
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
export const previewOf = (content: MessageContent): string => {
  switch (content.type) {
    case 'text':
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
  }
};

/** "Top-up of 1 PAS · in block #123"; the note, or "Transaction" without one. */
export const referenceLine = (reference: TxReference): string => {
  const what = reference.note.trim() || 'Transaction';
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
