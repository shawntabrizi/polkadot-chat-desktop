/**
 * The one IndexedDB database of the app (Dexie).
 *
 * Secrets never sit next to the rows that describe them: every private key lives
 * in `secrets`, keyed by a fixed id, so a debug dump of any other table is safe
 * to paste into a bug report and a logout can wipe one key without touching the
 * device's own.
 */

import Dexie, { type Table } from 'dexie';

import type { HexString } from './bytes';
import type { BotInfo, MessageContent } from '../domain/chat/content';

export const DEVICE_ROW_ID = 'self';

/** Public half of this device's keys. Stable for the install. */
export type DeviceRow = {
  id: typeof DEVICE_ROW_ID;
  statementAccountPublicKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
  createdAt: number;
};

export type SecretId = 'device.statementSeed' | 'device.encryptionPrivateKey' | 'identity.chatPrivateKey';

export type SecretRow = {
  id: SecretId;
  bytes: Uint8Array;
};

/** Public half of the paired user identity (from the V2 handshake `Success`). */
export type UserIdentityRow = {
  id: typeof DEVICE_ROW_ID;
  identityAccountId: Uint8Array;
  rootAccountId: Uint8Array;
  /** X25519 public key of the phone that authorised this device. */
  peerDeviceEncPubKey: Uint8Array;
  /** Statement account of that phone; null when its proof type was unknown. */
  peerStatementAccountId: Uint8Array | null;
  pairedAt: number;
};

export type SettingKey =
  | 'networkProfile'
  | 'pairing.processedStatementHex'
  /** `enter` (default) or `mod-enter`. */
  | 'chat.sendKey'
  /** `on` (default) or `off`. */
  | 'chat.notifications'
  | 'chat.sound'
  /** `on` (default) or `off`: typing reveal of bot and Assistant replies (M7). */
  | 'chat.reveal'
  /** `on` (default) or `off`: send spec 0005 `typing` while composing (M9). */
  | 'chat.typingIndicator'
  /** `on` (default) or `off`: send spec 0005 `seen` read receipts (M9). */
  | 'chat.readReceipts'
  /** JSON: the engine session of the Assistant's last reply (assistant.ts). */
  | 'assistant.session';

export type SettingRow = {
  key: SettingKey;
  value: string;
};

/** One device of a peer: how the multi-device session addresses it (mds.md). */
export type PeerDevice = {
  statementAccountId: Uint8Array;
  encryptionPublicKey: Uint8Array;
};

/**
 * A peer we exchanged an accepted chat request with. Keyed by the hex of the
 * peer's identity account; `devices` is the roster the session reads live.
 */
export type ContactRow = {
  accountId: HexString;
  username: string;
  /** The peer's identity chat X25519 public key (People-chain identifier key). */
  chatPublicKey: Uint8Array;
  devices: PeerDevice[];
  createdAt: number;
  updatedAt: number;
};

export type RequestDirection = 'incoming' | 'outgoing';
export type RequestStatus = 'pending' | 'accepted' | 'declined';

export type RequestRow = {
  requestId: string;
  peerAccountId: HexString;
  peerUsername: string;
  /** Kept on the row so accept / the identity channel need no second chain read. */
  peerChatPublicKey: Uint8Array;
  direction: RequestDirection;
  status: RequestStatus;
  welcomeMessage: string | null;
  /** Wire timestamp (ms) from the request message. */
  timestamp: number;
  /** Incoming only: the device that sent the request, per `RequestContentV2`. */
  senderDevice: PeerDevice | null;
  createdAt: number;
};

/** The built-in assistant's room and message key: local, not an account on chain. */
export type AssistantPeerId = 'local:assistant';
/** The built-in Faucet's room (M10): local, nothing on the wire. */
export type FaucetPeerId = 'local:faucet';

/** Who a room is with: a contact's identity account, or a local contact. */
export type PeerId = HexString | AssistantPeerId | FaucetPeerId;

/** A contact that lives in this app only (the Assistant, the Faucet): no account, no wire. */
export const isLocalPeer = (peer: string): peer is AssistantPeerId | FaucetPeerId => peer === 'local:assistant' || peer === 'local:faucet';

/** One chat per contact. Unread counts what arrived while the room was not open. */
export type RoomRow = {
  peerAccountId: PeerId;
  unreadCount: number;
  /** Muted: no notification, not in the badge. Absent on rows from before M6. */
  muted?: boolean;
  lastMessageAt: number;
  lastPreview: string;
  createdAt: number;
  updatedAt: number;
};

/** The unsent text of a room's composer, saved as it is typed. */
export type DraftRow = { peerId: PeerId; text: string; updatedAt: number };

export type MessageDirection = 'incoming' | 'outgoing' | 'system';

/**
 * Outgoing: `sending` until the session queued it, `sent` once on a
 * statement, `delivered` on the peer's ACK, `failed` if it can never go out.
 * Incoming and system rows are `received`. An assistant reply is `streaming`
 * while its text still arrives, then `received`, or `failed` if it broke off.
 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'received' | 'streaming';

export type Reaction = { emoji: string; by: 'me' | 'peer' };

export type MessageRow = {
  messageId: string;
  peerAccountId: PeerId;
  timestamp: number;
  direction: MessageDirection;
  status: MessageStatus;
  content: MessageContent;
  reactions: Reaction[];
  editedAt: number | null;
  /**
   * Own messages only: when the peer displayed it (spec 0005 `seen.at`, unix
   * ms). Absent until then, and on rows from before M9. Not indexed, so no
   * schema version.
   */
  seenAt?: number;
};

/**
 * An RFC-0003 deletion whose target has not arrived (yet). Applied when the
 * target arrives; bounded per peer, oldest evicted (eviction is safe: a
 * deletion whose target never comes has no effect).
 */
export type PendingDeletionRow = { peerAccountId: PeerId; messageId: string; createdAt: number };

/**
 * What this client knows about a peer beyond the contact row (M10). Written
 * for a contact when the first of these arrives, and for the local Faucet.
 */
export type PeerInfoRow = {
  peerId: PeerId;
  /** Spec 0008: the latest `botInfo` (highest `version`); null until one arrives. */
  botInfo: BotInfo | null;
  /** When a `botInfo` last arrived, a repeat of the stored version too. */
  botInfoAt: number | null;
  /**
   * When the peer first sent content on the identity channel. Phones never
   * do (they send only the accept and the roster there); pca bots send their
   * welcome text there. The only sign of an older bot that sends no `botInfo`.
   */
  botSignalAt: number | null;
  /** When this client sent `/start` on its own (M10 step 4); at most once. */
  startSentAt: number | null;
};

export const DB_NAME = 'polkadot-chat-web';

const dexie = new Dexie(DB_NAME);
dexie.version(1).stores({
  device: 'id',
  secrets: 'id',
  userIdentity: 'id',
  settings: 'key',
});
dexie.version(2).stores({
  contacts: 'accountId',
  requests: 'requestId, peerAccountId',
});
dexie.version(3).stores({
  rooms: 'peerAccountId',
  messages: 'messageId, [peerAccountId+timestamp]',
});
dexie.version(4).stores({
  drafts: 'peerId',
});
dexie.version(5).stores({
  pendingDeletions: '[peerAccountId+messageId], [peerAccountId+createdAt]',
});
dexie.version(6).stores({
  peerInfo: 'peerId',
});

/** The raw Dexie instance: for transactions and for tests that reset the store. */
export const appDatabase = dexie;

export const db: {
  device: Table<DeviceRow, string>;
  secrets: Table<SecretRow, SecretId>;
  userIdentity: Table<UserIdentityRow, string>;
  settings: Table<SettingRow, SettingKey>;
  contacts: Table<ContactRow, HexString>;
  requests: Table<RequestRow, string>;
  rooms: Table<RoomRow, PeerId>;
  messages: Table<MessageRow, string>;
  drafts: Table<DraftRow, PeerId>;
  pendingDeletions: Table<PendingDeletionRow, [PeerId, string]>;
  peerInfo: Table<PeerInfoRow, PeerId>;
} = {
  device: dexie.table('device'),
  secrets: dexie.table('secrets'),
  userIdentity: dexie.table('userIdentity'),
  settings: dexie.table('settings'),
  contacts: dexie.table('contacts'),
  requests: dexie.table('requests'),
  rooms: dexie.table('rooms'),
  messages: dexie.table('messages'),
  drafts: dexie.table('drafts'),
  pendingDeletions: dexie.table('pendingDeletions'),
  peerInfo: dexie.table('peerInfo'),
};
