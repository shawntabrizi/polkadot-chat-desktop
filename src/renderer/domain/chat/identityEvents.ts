// Ported from polkadot-desktop src/domains/chat/p2p/session-transport/service.ts
// (`toIdentityChannelEvents`) and session-transport/types.ts.

/**
 * What arrives on the identity-level channel with a peer. The roster variants
 * bootstrap per-device transport, so they cannot travel on it. Anything else
 * (a bot's welcome text rides the identity session, see docs/decisions.md) is
 * surfaced as `message` for the caller to treat like session content.
 */

import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { type Codec, type CodecType, Struct, createCodec, str, u64, u8 } from 'scale-ts';

import { hexToBytes } from '../../app/bytes';
import type { PeerDevice } from '../../app/database';

type SdkChatMessageWire = CodecType<typeof SdkChatMessage>;

/**
 * RFC-0003 `deleted(DeletedContent)`; the SDK (0.10.2) has no such variant.
 * `targetMessageId` is the retracted message (the envelope has its own `messageId`).
 */
export type DeletedWire = { tag: 'deleted'; value: { targetMessageId: string } };
export type ChatContent = SdkChatMessageWire['versioned']['value'] | DeletedWire;
export type ChatMessageWire = { messageId: string; timestamp: bigint; versioned: { tag: 'v1'; value: ChatContent } };

/**
 * RFC-0003 names kind 20 for `deleted`, but 20 is already `deviceChatAccepted`
 * (mds.md, the SDK codec, the pca bots). Its Unresolved Question 6 says to
 * take the next free index on a clash: 21, as the pca side does
 * (docs/decisions.md). The SDK codec does not know 21, so this codec reads
 * and writes it and hands every other kind to the SDK.
 */
export const DELETED_KIND = 21;
const V1 = 0;

const Header = Struct({ messageId: str, timestamp: u64, version: u8, kind: u8 });
const DeletedMessage = Struct({ messageId: str, timestamp: u64, version: u8, kind: u8, target: str });

const toBytes = (value: Uint8Array | ArrayBuffer | string): Uint8Array =>
  value instanceof Uint8Array ? value : typeof value === 'string' ? hexToBytes(value) : new Uint8Array(value);

const decodeDeleted = (bytes: Uint8Array): ChatMessageWire | null => {
  try {
    const header = Header.dec(bytes);
    if (header.version !== V1 || header.kind !== DELETED_KIND) return null;
    const decoded = DeletedMessage.dec(bytes);
    // Bytes after the target string: not a well-formed `deleted`; the SDK
    // decode that follows rejects it, and the entry counts as unsupported.
    if (DeletedMessage.enc(decoded).length !== bytes.length) return null;
    return {
      messageId: decoded.messageId,
      timestamp: decoded.timestamp,
      versioned: { tag: 'v1', value: { tag: 'deleted', value: { targetMessageId: decoded.target } } },
    };
  } catch {
    return null;
  }
};

/**
 * The app's `Message` codec: the SDK's `ChatMessage`, plus kind 21 `deleted`.
 * Every session in this app encodes and decodes through it.
 */
export const ChatMessageCodec: Codec<ChatMessageWire> = createCodec<ChatMessageWire>(
  message => {
    const content = message.versioned.value;
    if (content.tag === 'deleted') {
      return DeletedMessage.enc({ messageId: message.messageId, timestamp: message.timestamp, version: V1, kind: DELETED_KIND, target: content.value.targetMessageId });
    }
    return SdkChatMessage.enc({ ...message, versioned: { tag: 'v1', value: content } });
  },
  value => {
    const bytes = toBytes(value);
    return decodeDeleted(bytes) ?? SdkChatMessage.dec(bytes);
  },
);

export type IdentityChannelEvent =
  | { tag: 'accepted'; requestId: string; device: PeerDevice; acceptedAt: number }
  | { tag: 'deviceAdded'; device: PeerDevice }
  | { tag: 'deviceRemoved'; statementAccountId: Uint8Array }
  | { tag: 'message'; messageId: string; timestamp: number; content: ChatContent };

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
