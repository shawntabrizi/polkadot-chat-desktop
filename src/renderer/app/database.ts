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
import type { BotInfo, GroupMember, MessageContent } from '../domain/chat/content';
import type { GroupState } from '../domain/chat/groupCodec';

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
  /**
   * `on` or `off` (default): send spec 0005 `typing` while composing (M12c).
   * A new key, so the M9 `chat.typingIndicator` (default on) no longer counts.
   */
  | 'chat.sendTyping'
  /** `on` (default) or `off`: send spec 0005 `seen` read receipts (M9). */
  | 'chat.readReceipts'
  /** `subscan` (default) or `polkadotjs`: where "View on …" opens a transaction or an account (M12c). */
  | 'chat.explorer'
  /** JSON: the engine session of the Assistant's last reply (assistant.ts). */
  | 'assistant.session'
  /** `seen` once the first attachment went out: its notice (spec 0012 review) shows once. */
  | 'chat.attachmentNotice'
  /** M15c JSON `{ day, transactions, bytes }`: Bulletin stores this device submitted on its local day `day` (the quota panel). */
  | 'bulletin.uploads';

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
  /** M12e: a local label shown as the name; the username stays visible next to it. Never sent. */
  nickname?: string;
  /**
   * M16b: this contact exists only because our client accepted their request
   * to join that group (an invite link): a stranger, so their `welcome`s show
   * as invites (review M16 answer 5).
   */
  joinedVia?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * M12e: a peer this device blocked. Their requests and messages are dropped
 * on arrival; nothing is sent to them about it. Local to this device.
 */
export type BlockedRow = { accountId: HexString; username: string; blockedAt: number };

/**
 * A chat deleted on this device (2026-09-24): the peer's statements stay in
 * the store and are read again at every start, so without this mark the room
 * came back. Content from the chat not newer than `deletedAt` is dropped; a
 * newer message brings the room back and removes the mark. Local only.
 */
export type DeletedChatRow = { peerId: PeerId; deletedAt: number };

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

/** A spec 0009 group's room and message key: `group:<groupId>`. */
export type GroupPeerId = `group:${string}`;

/** Who a room is with: a contact's identity account, a local contact, or a group. */
export type PeerId = HexString | AssistantPeerId | FaucetPeerId | GroupPeerId;

/** A contact that lives in this app only (the Assistant, the Faucet): no account, no wire. */
export const isLocalPeer = (peer: string): peer is AssistantPeerId | FaucetPeerId => peer === 'local:assistant' || peer === 'local:faucet';

export const isGroupPeer = (peer: string): peer is GroupPeerId => peer.startsWith('group:');
export const groupPeerOf = (groupId: string): GroupPeerId => `group:${groupId}`;
export const groupIdOf = (peer: GroupPeerId): string => peer.slice('group:'.length);

/** One chat per contact. Unread counts what arrived while the room was not open. */
export type RoomRow = {
  peerAccountId: PeerId;
  /** Spec 0009: set on a group's room (whose key is `group:<groupId>`). */
  groupId?: string;
  unreadCount: number;
  /** Muted: no notification, not in the badge. Absent on rows from before M6. */
  muted?: boolean;
  /** M12e: in the collapsed "Archived" section; its unread still counts in the badge. */
  archived?: boolean;
  /** M12e: pinned to the top of the list; the time of the pin keeps the pinned order stable. */
  pinnedAt?: number;
  /** M12e: "Mark as unread" with nothing unread; cleared when the room is read. */
  markedUnread?: boolean;
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
  /** Spec 0009, a group's rows only: the group, and who sent an incoming row. */
  groupId?: string;
  senderAccountId?: HexString;
  /** Spec 0009: the sender's `seq`, the tie-break after the timestamp. */
  groupSeq?: number;
  /** M12e, own rows only: a forwarded copy and whose message it was. Local caption; nothing on the wire. */
  forwardedFrom?: string;
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

/**
 * Spec 0011: one epoch key this client holds. `erasesAt` is set when a newer
 * epoch opens (14 days later the key is erased); a `fork` key is the losing
 * side of two rekeys out of one epoch, kept 24 h to read what was sent under it.
 */
export type GroupEpochKey = { epoch: number; key: Uint8Array; openedAt: number; erasesAt: number | null; signer: HexString; fork?: boolean };
/**
 * M16b: one epoch key at rest, in the `keys` table next to `secrets` (the
 * review answer to M16 question 3). `sealed` is the 32-byte key sealed with
 * the app's at-rest key (`app/atRest.ts`, safeStorage in main); the row's id
 * is its additional data. Only `groupsV2`'s Dexie storage reads and writes it.
 */
export type GroupKeyRow = {
  /** `<groupId>:<epoch>:<0|1 fork>` */
  id: string;
  groupId: string;
  epoch: number;
  fork: boolean;
  openedAt: number;
  erasesAt: number | null;
  signer: HexString;
  nonce: Uint8Array;
  sealed: Uint8Array;
};

/**
 * M15c: one attachment item's key and nonce at rest, in the same `keys`
 * table as the epoch keys (review M16b ruling 2). `sealed` is key (32
 * bytes) ‖ nonce (12 bytes) sealed with the app's at-rest key; the row id
 * `att:<messageId>:<index>` is its additional data. The message row keeps
 * the item with an empty key and nonce (`attachmentKeyStore.ts`).
 */
export type AttachmentKeyRow = {
  /** `att:<messageId>:<index>` */
  id: string;
  messageId: string;
  index: number;
  nonce: Uint8Array;
  sealed: Uint8Array;
};

/**
 * M16b: our own request to join a group by an invite link (0011 "Invite
 * link"), until the admin's `welcome` arrives. `requested`: the chat request
 * (or the `joinRequest`) went to `admin`; `pending`: the admin answered
 * `joinDecision{pending}`; `rejected`: it answered rejected.
 */
export type GroupJoinRow = {
  groupId: string;
  name: string;
  admins: HexString[];
  admin: HexString;
  inviteId: Uint8Array;
  proof: Uint8Array;
  status: 'requested' | 'pending' | 'rejected';
  createdAt: number;
  updatedAt: number;
};

/** M16b, admin side: one join request by link waiting for approval (policy 1); local to this admin (0011). */
export type GroupJoinRequest = { account: HexString; username: string; inviteId: Uint8Array; note: string; at: number };

/** Spec 0011: one of our own messages as sent in a carrier (the remote message bytes), for the 24 h carry. */
export type GroupCarryItem = { messageId: string; timestamp: number; sentAt: number; epoch: number; bytes: Uint8Array };

/**
 * A spec 0009 group as this client holds it: the highest roster version from
 * its admin, plus local state. `self` is `left` after our own leave and
 * `removed` when a roster without us arrives; either way nothing more is sent.
 *
 * Spec 0011 (M16) adds the optional v2 fields; a row without `v` is a v1
 * fan-out group. For a v2 row `name`, `admin` (the owner), `members` (with
 * usernames, which the state does not carry) and `version` mirror the
 * applied `state`, so the list and the room read both kinds the same way.
 * Not indexed, so no schema version.
 */
export type GroupRow = {
  id: string;
  name: string;
  admin: HexString;
  members: GroupMember[];
  version: number;
  createdAt: number;
  /** M16b `invited`: a stranger's `welcome`, shown as an invite to accept (review M16 answer 5); nothing is read or sent until then. */
  self: 'member' | 'left' | 'removed' | 'invited';
  /** Members that sent `groupLeave` since the roster was last changed. */
  left: HexString[];
  /** Admin only: members without a contact yet; the roster goes to each once the chat is accepted. */
  invites: HexString[];
  /** Our own `seq` for the next group message. */
  nextSeq: number;
  /** The highest `seq` seen from each sender (gap detection). */
  lastSeq: Record<string, number>;
  /** "Some messages may be missing" is shown once per group. */
  gapNoted: boolean;
  updatedAt: number;
  /** Spec 0011: a private group (one statement per message on an epoch topic). */
  v?: 2;
  /** The epoch whose key we send with. */
  epoch?: number;
  /** The applied group state, its exact bytes (for `stateHash`) and who signed it. */
  state?: GroupState | null;
  stateBytes?: Uint8Array | null;
  stateSigner?: HexString | null;
  /**
   * Epoch keys. Erased 14 days after the next epoch. Since M16b they are
   * stored sealed in the `keys` table, never on this row: `groupsV2`'s Dexie
   * storage splits them off on write and joins them on read (and moves the
   * keys of an M16 row there on its first read).
   */
  keys?: GroupEpochKey[];
  /** Our own messages of the current epoch, last 24 h: each carrier repeats them. */
  carry?: GroupCarryItem[];
  /** A `welcome` whose state we have not read from the topic yet. */
  pendingWelcome?: { from: HexString; epoch: number; stateVersion: number; stateHash: Uint8Array } | null;
  /** A rekey came without our entry while we are still listed: no key to send with. */
  locked?: boolean;
  /** `<from>:<messageId>` of the last 1000 messages taken: carriers repeat messages. */
  seenIds?: string[];
  /** Members we already took a carrier from (the gap rule). */
  senders?: HexString[];
  lastSentAt?: number;
  keyRequestedAt?: number;
  /** Admin: when the 7-day rotation fires (set once the epoch is 7 days old, with jitter). */
  rotateAt?: number | null;
  /** M16b, admin: join requests waiting for approval (policy 1). */
  joinRequests?: GroupJoinRequest[];
  /** M16b: posting accounts a member added with a `deviceAdded` in its carrier, kept across states until an admin's state records them. */
  postingAdded?: Record<string, HexString[]>;
  /** M16b, `self: 'invited'`: who sent the `welcome`, and when. */
  invitedBy?: { account: HexString; username: string; at: number } | null;
};

/**
 * Spec 0012: this device's copy and state of one attachment item of a
 * message. `bytes` is the plaintext: the sender keeps it (the source for a
 * re-store), a recipient stores it once fetched, checked and decrypted.
 * `done`/`total` count chunks stored (upload) or fetched (download).
 * M15c `freed`: Settings › Storage › Free space dropped the decrypted copy;
 * it downloads again on a tap, never on its own.
 */
export type AttachmentStatus = 'uploading' | 'uploadFailed' | 'downloading' | 'ready' | 'failed' | 'expired' | 'damaged' | 'freed';

export type AttachmentRow = {
  messageId: string;
  index: number;
  status: AttachmentStatus;
  done: number;
  total: number;
  bytes: Uint8Array | null;
  mime: string;
  expiresAt: number;
  /** Download retries so far, and when the first failure was (spec 0012: retry with backoff for 24 h). */
  attempts: number;
  firstFailedAt: number | null;
  error: string | null;
  updatedAt: number;
  /** M15c: when this device asked the sender to resend it; the download retries for 24 h after, expired or not. */
  resendAskedAt?: number;
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
dexie.version(7).stores({
  groups: 'id',
});
dexie.version(8).stores({
  blocked: 'accountId',
});
dexie.version(9).stores({
  attachments: '[messageId+index], messageId',
});
dexie.version(10).stores({
  keys: 'id, groupId',
  groupJoins: 'groupId',
});
dexie.version(11).stores({
  deletedChats: 'peerId',
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
  groups: Table<GroupRow, string>;
  blocked: Table<BlockedRow, HexString>;
  attachments: Table<AttachmentRow, [string, number]>;
  keys: Table<GroupKeyRow, string>;
  /** M15c: the attachment rows of the same `keys` table (ids `att:…`, no `groupId`). */
  attachmentKeys: Table<AttachmentKeyRow, string>;
  groupJoins: Table<GroupJoinRow, string>;
  deletedChats: Table<DeletedChatRow, PeerId>;
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
  groups: dexie.table('groups'),
  blocked: dexie.table('blocked'),
  attachments: dexie.table('attachments'),
  keys: dexie.table('keys'),
  attachmentKeys: dexie.table('keys'),
  groupJoins: dexie.table('groupJoins'),
  deletedChats: dexie.table('deletedChats'),
};
