/**
 * Rooms and messages. A room is created with its first message and mirrors
 * the last message for the chat list; every write that adds a visible row
 * bumps it. Reactions, edits and RFC-0003 deletions mutate the target row in
 * place.
 */

import type { HexString } from '../../app/bytes';
import { type MessageRow, type MessageStatus, type PeerId, type RoomRow, appDatabase, db } from '../../app/database';

import { type MessageContent, isLiveFrame, previewOf } from './content';

export const listRooms = async (): Promise<RoomRow[]> =>
  (await db.rooms.toArray()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);

export const listMessages = (peerAccountId: PeerId): Promise<MessageRow[]> =>
  db.messages.where('[peerAccountId+timestamp]').between([peerAccountId, -Infinity], [peerAccountId, Infinity]).toArray();

export const getMessage = (messageId: string): Promise<MessageRow | undefined> => db.messages.get(messageId);

const touchRoom = async (peerAccountId: PeerId, message: MessageRow, unreadDelta: number): Promise<void> => {
  const existing = await db.rooms.get(peerAccountId);
  const now = Date.now();
  const newest = !existing || message.timestamp >= existing.lastMessageAt;
  await db.rooms.put({
    peerAccountId,
    unreadCount: (existing?.unreadCount ?? 0) + unreadDelta,
    lastMessageAt: newest ? message.timestamp : existing.lastMessageAt,
    lastPreview: newest ? previewOf(message.content) : existing.lastPreview,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // A new message must not unmute the room.
    ...(existing?.muted ? { muted: true } : {}),
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
export const addMessage = (row: MessageRow, options: { read?: boolean } = {}): Promise<boolean> =>
  appDatabase.transaction('rw', db.messages, db.rooms, db.pendingDeletions, async () => {
    if (await db.messages.get(row.messageId)) return false;
    const pendingKey: [PeerId, string] = [row.peerAccountId, row.messageId];
    const deleted = row.direction === 'incoming' && (await db.pendingDeletions.get(pendingKey)) !== undefined;
    if (deleted) await db.pendingDeletions.delete(pendingKey);
    const stored = deleted ? tombstone(row) : row;
    await db.messages.add(stored);
    await touchRoom(row.peerAccountId, stored, row.direction === 'incoming' && !options.read && !deleted ? 1 : 0);
    return true;
  });

/** Make sure a room exists for a contact with nothing said yet (the chat list shows it). */
export const ensureRoom = (peerAccountId: PeerId): Promise<void> =>
  appDatabase.transaction('rw', db.rooms, async () => {
    if (await db.rooms.get(peerAccountId)) return;
    const now = Date.now();
    // `lastMessageAt: 0` so the first message, whatever its wire timestamp, becomes the preview.
    await db.rooms.put({ peerAccountId, unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: now, updatedAt: now });
  });

export const setMessageStatus = (messageId: string, status: MessageStatus): Promise<number> =>
  db.messages.update(messageId, { status });

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
  appDatabase.transaction('rw', db.messages, db.rooms, async () => {
    const row = await db.messages.get(messageId);
    if (!row) return false;
    if (row.content.type === 'deleted') return true;
    const deleted = tombstone(row);
    await db.messages.put(deleted);
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
 * Re-processing is a no-op.
 */
export const applyDeletion = (peer: PeerId, messageId: string, now: number = Date.now()): Promise<DeletionResult> =>
  appDatabase.transaction('rw', db.messages, db.rooms, db.pendingDeletions, async () => {
    const row = await db.messages.get(messageId);
    if (row) {
      if (row.peerAccountId !== peer || row.direction !== 'incoming') return 'ignored';
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

export const markRoomRead = (peerAccountId: PeerId): Promise<number> =>
  db.rooms.update(peerAccountId, { unreadCount: 0 });

/** A muted room does not notify and does not count in the badge (M6 step 7). */
export const setRoomMuted = (peerAccountId: PeerId, muted: boolean): Promise<number> => db.rooms.update(peerAccountId, { muted });

/** Unread messages of the rooms that are not muted: the window title and the dock badge. */
export const countUnread = async (): Promise<number> =>
  (await db.rooms.toArray()).reduce((sum, room) => sum + (room.muted ? 0 : room.unreadCount), 0);

/** How many message hits the search shows (M7b step 1c). */
export const MESSAGE_SEARCH_LIMIT = 20;

/** The text a message search reads: text and richText rows, never a bot's live frame (status, not content). */
const searchableText = (row: MessageRow): string | null => {
  if (row.content.type === 'richText') return row.content.text;
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
