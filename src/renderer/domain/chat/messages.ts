/**
 * Rooms and messages. A room is created with its first message and mirrors
 * the last message for the chat list; every write that adds a visible row
 * bumps it. Reactions, edits and RFC-0003 deletions mutate the target row in
 * place.
 */

import type { HexString } from '../../app/bytes';
import { type MessageRow, type MessageStatus, type PeerId, type RoomRow, appDatabase, db, groupIdOf, isGroupPeer } from '../../app/database';

import { deleteAttachmentKeys, splitAttachmentKeys } from './attachmentKeyStore';
import { type MessageContent, type TxReference, isLiveFrame, previewOf, referenceRank } from './content';

export const listRooms = async (): Promise<RoomRow[]> =>
  (await db.rooms.toArray()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);

export const listMessages = (peerAccountId: PeerId): Promise<MessageRow[]> =>
  db.messages.where('[peerAccountId+timestamp]').between([peerAccountId, -Infinity], [peerAccountId, Infinity]).toArray();

export const getMessage = (messageId: string): Promise<MessageRow | undefined> => db.messages.get(messageId);

const touchRoom = async (peerAccountId: PeerId, message: MessageRow, unreadDelta: number, deleted = false): Promise<void> => {
  const existing = await db.rooms.get(peerAccountId);
  const now = Date.now();
  const newest = !existing || message.timestamp >= existing.lastMessageAt;
  // M12f (Telegram's rule): a new message from the peer brings an archived chat back, unless it is muted.
  const unarchive = existing?.archived === true && existing.muted !== true && message.direction === 'incoming' && !deleted;
  await db.rooms.put({
    // Local state (mute, group, and since M12e archive, pin, marked unread) survives a new message.
    ...existing,
    ...(unarchive ? { archived: false } : {}),
    peerAccountId,
    unreadCount: (existing?.unreadCount ?? 0) + unreadDelta,
    lastMessageAt: newest ? message.timestamp : existing.lastMessageAt,
    lastPreview: newest ? previewOf(message.content) : existing.lastPreview,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
};

/** How many deletions without a target are kept per peer (RFC-0003 allows a bound). */
export const PENDING_DELETIONS_PER_PEER = 500;

/** RFC-0003 tombstone: content, reactions and edit history go; id, time, side and status stay. */
const tombstone = (row: MessageRow): MessageRow => ({ ...row, content: { type: 'deleted' }, reactions: [], editedAt: null });

/**
 * Insert a row. An existing id is left as is (a replayed statement, or the
 * accept row written by both the accept path and the identity channel) and
 * `false` is returned. Incoming rows count as unread unless `read`.
 * An incoming row the peer already deleted (RFC-0003 unknown target) is
 * stored as a tombstone and never shown.
 */
export const addMessage = async (row: MessageRow, options: { read?: boolean } = {}): Promise<boolean> => {
  // M15c: an attachment's keys go sealed to `keys`, never into the message row. Sealed first: Web Crypto would end the transaction.
  const split = await splitAttachmentKeys(row);
  const tables = split.keys.length > 0 ? [db.messages, db.rooms, db.pendingDeletions, db.keys] : [db.messages, db.rooms, db.pendingDeletions];
  return appDatabase.transaction('rw', tables, async () => {
    if (await db.messages.get(row.messageId)) return false;
    const pendingKey: [PeerId, string] = [row.peerAccountId, row.messageId];
    const deleted = row.direction === 'incoming' && (await db.pendingDeletions.get(pendingKey)) !== undefined;
    if (deleted) await db.pendingDeletions.delete(pendingKey);
    const stored = deleted ? tombstone(row) : split.row;
    await db.messages.add(stored);
    if (!deleted && split.keys.length > 0) await db.attachmentKeys.bulkPut(split.keys);
    await touchRoom(row.peerAccountId, stored, row.direction === 'incoming' && !options.read && !deleted ? 1 : 0, deleted);
    return true;
  });
};

/** Make sure a room exists for a contact with nothing said yet (the chat list shows it). */
export const ensureRoom = (peerAccountId: PeerId): Promise<void> =>
  appDatabase.transaction('rw', db.rooms, async () => {
    if (await db.rooms.get(peerAccountId)) return;
    const now = Date.now();
    // `lastMessageAt: 0` so the first message, whatever its wire timestamp, becomes the preview.
    await db.rooms.put({ peerAccountId, unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: now, updatedAt: now });
  });

/** `failure` is kept only on a `failed` row; any other status removes it. */
export const setMessageStatus = (messageId: string, status: MessageStatus, failure?: string): Promise<number> =>
  db.messages.update(messageId, { status, failure: status === 'failed' ? failure : undefined });

/** The peer acknowledged the whole outgoing batch: everything sent before `before` is delivered. */
export const markDeliveredBefore = (peerAccountId: HexString, before: number): Promise<number> =>
  db.messages
    .where('[peerAccountId+timestamp]')
    .between([peerAccountId, -Infinity], [peerAccountId, before])
    .filter(row => row.direction === 'outgoing' && row.status === 'sent')
    .modify({ status: 'delivered' });

export const applyReaction = (messageId: string, emoji: string, by: 'me' | 'peer', add: boolean): Promise<number> =>
  db.messages
    .where('messageId')
    .equals(messageId)
    .modify(row => {
      // Reactions on a deleted message are not shown (RFC-0003), so none are kept.
      if (row.content.type === 'deleted') return;
      const without = row.reactions.filter(r => !(r.emoji === emoji && r.by === by));
      row.reactions = add ? [...without, { emoji, by }] : without;
    });

/**
 * An edit replaces the text of a text, reply, richText or buttons row (a
 * buttons row keeps its keyboard: the base `edit` carries no rows); other
 * rows (a tombstone too) cannot be edited.
 */
export const applyEdit = (messageId: string, text: string, editedAt: number): Promise<number> =>
  db.messages
    .where('messageId')
    .equals(messageId)
    .modify(row => {
      if (row.content.type !== 'text' && row.content.type !== 'reply' && row.content.type !== 'richText' && row.content.type !== 'buttons') return;
      const content: MessageContent = { ...row.content, text };
      row.content = content;
      row.editedAt = editedAt;
    });

/**
 * Spec 0006: remember the first press of a keyboard on this device. A
 * `oneShot` keyboard is gone after it. Later presses of a keyboard that
 * stays keep the first one (the UI highlights presses on its own).
 */
export const markButtonPressed = (messageId: string, row: number, index: number): Promise<number> =>
  db.messages
    .where('messageId')
    .equals(messageId)
    .modify(message => {
      if (message.content.type !== 'buttons' || message.content.pressed) return;
      message.content = { ...message.content, pressed: { row, index } };
    });

/** Spec 0007: after these, a reference for the same transaction changes nothing. */
const isFinal = (reference: TxReference): boolean => reference.status === 'finalized' || reference.status === 'failed';

/**
 * Spec 0007: one row per transaction and side. The first reference for a hash
 * from `direction` adds a row (`messageId`, `timestamp`); a later one updates
 * that row's state in place, unless it already ended (finalized or failed).
 * A later reference with no note keeps the note. Returns the row's id and
 * whether it is new.
 */
export const applyReference = (
  peer: PeerId,
  direction: 'incoming' | 'outgoing',
  ids: { messageId: string; timestamp: number },
  reference: TxReference,
  options: { read?: boolean; senderAccountId?: HexString } = {},
): Promise<{ messageId: string; added: boolean }> =>
  appDatabase.transaction('rw', db.messages, db.rooms, db.pendingDeletions, async () => {
    const hash = reference.hash.toLowerCase();
    const existing = (await listMessages(peer)).find(
      row => row.direction === direction && row.content.type === 'transactionReference' && row.content.reference.hash.toLowerCase() === hash,
    );
    if (!existing || existing.content.type !== 'transactionReference') {
      const row: MessageRow = {
        ...ids,
        peerAccountId: peer,
        // A group's reference row is a group row like any other (M14).
        ...(isGroupPeer(peer) ? { groupId: groupIdOf(peer) } : {}),
        ...(options.senderAccountId ? { senderAccountId: options.senderAccountId } : {}),
        direction,
        status: direction === 'outgoing' ? 'sending' : 'received',
        content: { type: 'transactionReference', reference: { ...reference, hash } },
        reactions: [],
        editedAt: null,
      };
      return { messageId: ids.messageId, added: await addMessage(row, options) };
    }
    const current = existing.content.reference;
    // Forward only (M12c): the chain tracker, our runner and the peer all
    // report states, in any order; a late "submitted" must not undo "in block".
    if (!isFinal(current) && referenceRank(reference.status) >= referenceRank(current.status)) {
      const next: TxReference = { ...current, ...reference, hash, note: reference.note || current.note, intentMessageId: reference.intentMessageId ?? current.intentMessageId };
      await db.messages.update(existing.messageId, { content: { type: 'transactionReference', reference: next } });
      const room = await db.rooms.get(peer);
      if (room && room.lastMessageAt === existing.timestamp) await db.rooms.update(peer, { lastPreview: previewOf({ type: 'transactionReference', reference: next }) });
    }
    return { messageId: existing.messageId, added: false };
  });

/**
 * Spec 0007 (M12c): what the chain says about a transaction reaches every
 * reference row with that hash, ours and the peer's, in every room, with no
 * message. Forward only, and never past finalized or failed.
 */
export const setReferenceState = (hash: string, state: { status: TxReference['status']; block: number | null; error: string | null }): Promise<number> =>
  appDatabase.transaction('rw', db.messages, db.rooms, async () => {
    const key = hash.toLowerCase();
    const rows = await db.messages
      .filter(row => row.content.type === 'transactionReference' && row.content.reference.hash.toLowerCase() === key)
      .toArray();
    let changed = 0;
    for (const row of rows) {
      if (row.content.type !== 'transactionReference') continue;
      const current = row.content.reference;
      if (isFinal(current) || referenceRank(state.status) <= referenceRank(current.status)) continue;
      const next: TxReference = { ...current, status: state.status, block: state.block ?? current.block, ...(state.error ? { error: state.error } : {}) };
      await db.messages.update(row.messageId, { content: { type: 'transactionReference', reference: next } });
      const room = await db.rooms.get(row.peerAccountId);
      if (room && room.lastMessageAt === row.timestamp) await db.rooms.update(row.peerAccountId, { lastPreview: previewOf({ type: 'transactionReference', reference: next }) });
      changed += 1;
    }
    return changed;
  });

/** Reference rows whose transaction has not ended (neither finalized nor failed): what the chain tracker follows. */
export const listOpenReferences = async (): Promise<TxReference[]> =>
  (await db.messages.filter(row => row.content.type === 'transactionReference' && !isFinal(row.content.reference)).toArray()).flatMap(row =>
    row.content.type === 'transactionReference' ? [row.content.reference] : [],
  );

export type SeenResult = 'applied' | 'unknown' | 'ignored';

/**
 * Spec 0005 recipient flow for `seen{upTo, at}` from `peer`: every own
 * message to that peer with `timestamp <= timestamp(upTo)` gets `seenAt = at`,
 * unless it has one already (the first time it was seen stands; a repeat is a
 * no-op). `upTo` must be our own message to that peer, else nothing changes:
 * a peer can only mark what it was sent. `unknown` when there is no such row
 * yet (the caller defers it).
 */
export const applySeen = (peer: PeerId, upTo: string, at: number): Promise<SeenResult> =>
  appDatabase.transaction('rw', db.messages, async () => {
    const target = await db.messages.get(upTo);
    if (!target) return 'unknown';
    if (target.peerAccountId !== peer || target.direction !== 'outgoing') return 'ignored';
    await db.messages
      .where('[peerAccountId+timestamp]')
      .between([peer, -Infinity], [peer, target.timestamp], true, true)
      .filter(row => row.direction === 'outgoing' && row.seenAt === undefined)
      .modify({ seenAt: at });
    return 'applied';
  });

/** The chat list preview follows a changed row when it is the room's newest. */
const refreshPreview = async (row: MessageRow): Promise<void> => {
  const room = await db.rooms.get(row.peerAccountId);
  if (room && row.timestamp >= room.lastMessageAt) await db.rooms.update(row.peerAccountId, { lastPreview: previewOf(row.content) });
};

/**
 * Tombstone a row in place, whoever sent it. Callers check that they may:
 * `applyDeletion` for a peer's deletion, the sender flow for our own. A row
 * already tombstoned is left alone (idempotent). `false` when there is no row.
 */
export const tombstoneMessage = (messageId: string): Promise<boolean> =>
  appDatabase.transaction('rw', [db.messages, db.rooms, db.attachments, db.keys], async () => {
    const row = await db.messages.get(messageId);
    if (!row) return false;
    if (row.content.type === 'deleted') return true;
    const deleted = tombstone(row);
    await db.messages.put(deleted);
    // Spec 0012: an attachment's local copy goes with the content, and (M15c) its keys.
    await db.attachments.where('messageId').equals(messageId).delete();
    await deleteAttachmentKeys([messageId]);
    await refreshPreview(deleted);
    return true;
  });

export type DeletionResult = 'tombstoned' | 'pending' | 'ignored';

/**
 * RFC-0003 recipient flow for `deleted(messageId)` from `peer`:
 * - a message received from that peer becomes a tombstone;
 * - a message we sent, or one from another peer, is not touched;
 * - an unknown id is kept in the peer's pending set and applied on arrival
 *   (`addMessage`); the set keeps the newest `PENDING_DELETIONS_PER_PEER`.
 * Re-processing is a no-op. In a spec 0009 group (`peer` is the group's
 * room) `sender` must also be the author of the message.
 */
export const applyDeletion = (peer: PeerId, messageId: string, now: number = Date.now(), sender?: HexString): Promise<DeletionResult> =>
  appDatabase.transaction('rw', [db.messages, db.rooms, db.pendingDeletions, db.attachments, db.keys], async () => {
    const row = await db.messages.get(messageId);
    if (row) {
      if (row.peerAccountId !== peer || row.direction !== 'incoming') return 'ignored';
      if (sender !== undefined && row.senderAccountId !== sender) return 'ignored';
      if (row.content.type === 'deleted') return 'tombstoned';
      await tombstoneMessage(messageId);
      return 'tombstoned';
    }
    const key: [PeerId, string] = [peer, messageId];
    if (!(await db.pendingDeletions.get(key))) {
      await db.pendingDeletions.put({ peerAccountId: peer, messageId, createdAt: now });
      const range = db.pendingDeletions.where('[peerAccountId+createdAt]').between([peer, -Infinity], [peer, Infinity]);
      const excess = (await range.count()) - PENDING_DELETIONS_PER_PEER;
      if (excess > 0) {
        const oldest = await range.limit(excess).toArray();
        await db.pendingDeletions.bulkDelete(oldest.map((entry): [PeerId, string] => [entry.peerAccountId, entry.messageId]));
      }
    }
    return 'pending';
  });

/**
 * Remove a row that never left this device (RFC-0003 sender case 1: nothing
 * to retract on the wire). The room preview falls back to the newest row left.
 */
export const removeMessage = (messageId: string): Promise<void> =>
  appDatabase.transaction('rw', db.messages, db.rooms, async () => {
    const row = await db.messages.get(messageId);
    if (!row) return;
    await db.messages.delete(messageId);
    const room = await db.rooms.get(row.peerAccountId);
    if (!room) return;
    const newest = (await listMessages(row.peerAccountId)).at(-1);
    await db.rooms.update(row.peerAccountId, {
      lastPreview: newest ? previewOf(newest.content) : '',
      lastMessageAt: newest ? newest.timestamp : 0,
    });
  });

/** Read: no unread count, and no "Mark as unread" mark (M12e). */
export const markRoomRead = (peerAccountId: PeerId): Promise<number> =>
  db.rooms.update(peerAccountId, { unreadCount: 0, markedUnread: false });

/** A muted room does not notify and does not count in the badge (M6 step 7). */
export const setRoomMuted = (peerAccountId: PeerId, muted: boolean): Promise<number> => db.rooms.update(peerAccountId, { muted });

/**
 * Unread messages of the rooms that are not muted: the window title and the
 * dock badge. Archived rooms count too; a room marked as unread with nothing
 * unread counts as one (M12e).
 */
export const countUnread = async (): Promise<number> =>
  (await db.rooms.toArray()).reduce((sum, room) => sum + (room.muted ? 0 : room.unreadCount > 0 ? room.unreadCount : room.markedUnread ? 1 : 0), 0);

/** How many message hits the search shows (M7b step 1c). */
export const MESSAGE_SEARCH_LIMIT = 20;

/**
 * The text a message search reads: text, richText and reply rows (a reply's
 * own text is user text too, M7b review), never a bot's live frame (status,
 * not content).
 */
const searchableText = (row: MessageRow): string | null => {
  if (row.content.type === 'richText' || row.content.type === 'reply') return row.content.text;
  if (row.content.type === 'text') return isLiveFrame(row.content) ? null : row.content.text;
  return null;
};

/**
 * Local message search: rows whose text contains `query` (case-insensitive),
 * newest first, at most `limit`. Messages are never searched on the network.
 * A plain filter over the table, no text index: 5 000 rows answer well under
 * the 50 ms budget (messages.spec.ts, docs/decisions.md M7b).
 */
export const searchMessages = async (query: string, limit: number = MESSAGE_SEARCH_LIMIT): Promise<MessageRow[]> => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const hits = (await db.messages.toArray()).filter(row => searchableText(row)?.toLowerCase().includes(needle) ?? false);
  return hits.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
};
