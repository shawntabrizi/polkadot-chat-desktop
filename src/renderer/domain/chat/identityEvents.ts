// Ported from polkadot-desktop src/domains/chat/p2p/session-transport/service.ts
// (`toIdentityChannelEvents`) and session-transport/types.ts.

/**
 * What arrives on the identity-level channel with a peer. The roster variants
 * bootstrap per-device transport, so they cannot travel on it. Anything else
 * (a bot's welcome text rides the identity session, see docs/decisions.md) is
 * surfaced as `message` for the caller to treat like session content.
 */

import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes, type Codec, type CodecType, Enum, Option, Struct, Vector, bool, createCodec, str, u128, u16, u32, u64, u8 } from 'scale-ts';

import { hexToBytes } from '../../app/bytes';
import type { PeerDevice } from '../../app/database';

type SdkChatMessageWire = CodecType<typeof SdkChatMessage>;

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

export type ChatContent =
  | SdkChatMessageWire['versioned']['value']
  | DeletedWire
  | ButtonsWire
  | ButtonPressWire
  | TypingWire
  | SeenWire
  | BotInfoWire
  | TransactionReferenceWire
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

type ExtensionWire = DeletedWire | ButtonsWire | ButtonPressWire | TypingWire | SeenWire | BotInfoWire | TransactionReferenceWire;
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
const TransactionReferenceMessage = envelope(TransactionReferenceCodec);

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
      // v2 first (a hint, or an explicit None byte), then a v1 document that ends at `version`.
      const decoded =
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
    default:
      return null;
  }
};

/**
 * The app's `Message` codec: the SDK's `ChatMessage`, plus kind 21 `deleted`
 * (RFC-0003), kinds 240 `typing` / 241 `seen` (spec 0005), kinds 242
 * `buttons` / 243 `buttonPress` (spec 0006), kind 244 `botInfo` (spec 0008) and
 * kind 245 `transactionReference` (spec 0007).
 * Every session in this app encodes and decodes through it.
 */
export const ChatMessageCodec: Codec<ChatMessageWire> = createCodec<ChatMessageWire>(
  message => {
    const content = message.versioned.value;
    const head = { messageId: message.messageId, timestamp: message.timestamp, version: V1 };
    switch (content.tag) {
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
        return content.value.balance === undefined
          ? BotInfoMessage.enc({ ...head, kind: BOT_INFO_KIND, content: content.value })
          : BotInfoV2Message.enc({ ...head, kind: BOT_INFO_KIND, content: { ...content.value, balance: content.value.balance } });
      case 'transactionReference':
        return TransactionReferenceMessage.enc({ ...head, kind: TRANSACTION_REFERENCE_KIND, content: content.value });
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
