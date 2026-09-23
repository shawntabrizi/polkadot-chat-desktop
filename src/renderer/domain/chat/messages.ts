/**
 * Rooms and messages. A room is created with its first message and mirrors
 * the last message for the chat list; every write that adds a visible row
 * bumps it. Reactions and edits mutate the target row in place.
 */

import type { HexString } from '../../app/bytes';
import { type MessageRow, type MessageStatus, type PeerId, type RoomRow, appDatabase, db } from '../../app/database';

import { type MessageContent, previewOf } from './content';

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

/**
 * Insert a row. An existing id is left as is (a replayed statement, or the
 * accept row written by both the accept path and the identity channel) and
 * `false` is returned. Incoming rows count as unread unless `read`.
 */
export const addMessage = (row: MessageRow, options: { read?: boolean } = {}): Promise<boolean> =>
  appDatabase.transaction('rw', db.messages, db.rooms, async () => {
    if (await db.messages.get(row.messageId)) return false;
    await db.messages.add(row);
    await touchRoom(row.peerAccountId, row, row.direction === 'incoming' && !options.read ? 1 : 0);
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
      const without = row.reactions.filter(r => !(r.emoji === emoji && r.by === by));
      row.reactions = add ? [...without, { emoji, by }] : without;
    });

/** An edit replaces the text of a text or reply row; other rows cannot be edited. */
export const applyEdit = (messageId: string, text: string, editedAt: number): Promise<number> =>
  db.messages
    .where('messageId')
    .equals(messageId)
    .modify(row => {
      if (row.content.type !== 'text' && row.content.type !== 'reply' && row.content.type !== 'richText') return;
      const content: MessageContent = { ...row.content, text };
      row.content = content;
      row.editedAt = editedAt;
    });

export const markRoomRead = (peerAccountId: PeerId): Promise<number> =>
  db.rooms.update(peerAccountId, { unreadCount: 0 });

/** A muted room does not notify and does not count in the badge (M6 step 7). */
export const setRoomMuted = (peerAccountId: PeerId, muted: boolean): Promise<number> => db.rooms.update(peerAccountId, { muted });

/** Unread messages of the rooms that are not muted: the window title and the dock badge. */
export const countUnread = async (): Promise<number> =>
  (await db.rooms.toArray()).reduce((sum, room) => sum + (room.muted ? 0 : room.unreadCount), 0);
