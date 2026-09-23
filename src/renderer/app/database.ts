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
import type { MessageContent } from '../domain/chat/content';

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

export type SettingKey = 'networkProfile' | 'pairing.processedStatementHex';

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

/** One chat per contact. Unread counts what arrived while the room was not open. */
export type RoomRow = {
  peerAccountId: HexString;
  unreadCount: number;
  lastMessageAt: number;
  lastPreview: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageDirection = 'incoming' | 'outgoing' | 'system';

/**
 * Outgoing: `sending` until the session queued it, `sent` once on a
 * statement, `delivered` on the peer's ACK, `failed` if it can never go out.
 * Incoming and system rows are `received`.
 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'received';

export type Reaction = { emoji: string; by: 'me' | 'peer' };

export type MessageRow = {
  messageId: string;
  peerAccountId: HexString;
  timestamp: number;
  direction: MessageDirection;
  status: MessageStatus;
  content: MessageContent;
  reactions: Reaction[];
  editedAt: number | null;
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

/** The raw Dexie instance: for transactions and for tests that reset the store. */
export const appDatabase = dexie;

export const db: {
  device: Table<DeviceRow, string>;
  secrets: Table<SecretRow, SecretId>;
  userIdentity: Table<UserIdentityRow, string>;
  settings: Table<SettingRow, SettingKey>;
  contacts: Table<ContactRow, HexString>;
  requests: Table<RequestRow, string>;
  rooms: Table<RoomRow, HexString>;
  messages: Table<MessageRow, string>;
} = {
  device: dexie.table('device'),
  secrets: dexie.table('secrets'),
  userIdentity: dexie.table('userIdentity'),
  settings: dexie.table('settings'),
  contacts: dexie.table('contacts'),
  requests: dexie.table('requests'),
  rooms: dexie.table('rooms'),
  messages: dexie.table('messages'),
};
