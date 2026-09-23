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

import type { ChatContent } from './identityEvents';

export type Attachment = {
  kind: 'general' | 'image' | 'video';
  mimeType: string;
  fileSize: number;
};

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
  | { type: 'deleted' };

/** What this client can put on the wire. */
export type OutgoingContent =
  | { type: 'text'; text: string }
  | { type: 'reply'; messageId: string; text: string }
  | { type: 'reaction'; messageId: string; emoji: string; add: boolean }
  | { type: 'edit'; messageId: string; text: string }
  | { type: 'callDecline'; offerMessageId: string }
  /** RFC-0003 delete for everyone: asks the peer to tombstone our message `targetMessageId`. */
  | { type: 'deleted'; targetMessageId: string };

export type IncomingEffect =
  | { kind: 'message'; content: MessageContent }
  | { kind: 'reaction'; messageId: string; emoji: string; add: boolean }
  | { kind: 'edit'; messageId: string; text: string }
  | { kind: 'deleted'; targetMessageId: string }
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
  }
};

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
  }
};

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
