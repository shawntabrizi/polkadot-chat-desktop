/**
 * Local chat management (M12e, roadmap "Chat management"): delete, clear,
 * withdraw, archive, pin, mark as unread, nickname, block. All of it is this
 * device's own state: nothing here goes on the wire. The peer keeps their
 * copy of everything.
 */

import type { HexString } from '../../app/bytes';
import { type BlockedRow, type MessageRow, type PeerId, appDatabase, db, groupIdOf, isGroupPeer } from '../../app/database';

import { buttonsFallbackText } from '../../../shared/buttonsBlock';

import { deleteAttachmentKeys } from './attachmentKeyStore';
import { previewOf } from './content';
import { listMessages, markRoomRead } from './messages';

/** At most this many pinned chats (roadmap: max 5). */
export const MAX_PINNED = 5;
/** A nickname is a short label. */
export const MAX_NICKNAME_CHARS = 64;

/** Spec 0012: the local copies of the attachments of removed messages go too. */
const dropAttachments = async (messageIds: readonly string[]): Promise<void> => {
  if (messageIds.length === 0) return;
  await db.attachments.where('messageId').anyOf([...messageIds]).delete();
  // M15c: their sealed keys too.
  await deleteAttachmentKeys(messageIds);
};

const messagesUpTo = (peer: PeerId, at: number) => db.messages.where('[peerAccountId+timestamp]').between([peer, -Infinity], [peer, at], true, true);

/** The room follows what is left: the newest row's preview, or an empty line. */
const refreshRoom = async (peer: PeerId, extra: { unreadCount?: number; markedUnread?: boolean } = {}): Promise<void> => {
  const newest = (await listMessages(peer)).at(-1);
  await db.rooms.update(peer, { lastPreview: newest ? previewOf(newest.content) : '', ...extra });
};

/**
 * "Delete chat" once its Undo time is up: the messages up to `at` (so a
 * message that arrived during the Undo time is kept, and brings the room
 * back), the draft, the deletions waiting for their target, a pending
 * outgoing request, and the room itself when nothing newer is left. A
 * group's row goes too, with all of its messages and its epoch keys. The contact row stays
 * (with the session): if the peer writes again, the room comes back.
 */
export const deleteChatLocally = (peer: PeerId, at: number): Promise<void> =>
  appDatabase.transaction('rw', [db.rooms, db.messages, db.drafts, db.pendingDeletions, db.requests, db.groups, db.attachments, db.keys], async () => {
    const group = isGroupPeer(peer);
    const rows = group ? db.messages.where('[peerAccountId+timestamp]').between([peer, -Infinity], [peer, Infinity]) : messagesUpTo(peer, at);
    await dropAttachments(await rows.primaryKeys());
    await rows.delete();
    await db.drafts.delete(peer);
    await db.pendingDeletions.where('[peerAccountId+createdAt]').between([peer, -Infinity], [peer, Infinity]).delete();
    if (group) {
      await db.groups.delete(groupIdOf(peer));
      // M16b: its epoch keys live in `keys`; a deleted group keeps none.
      await db.keys.where('groupId').equals(groupIdOf(peer)).delete();
    }
    else await withdrawRequestLocally(peer as HexString);
    if (group || (await listMessages(peer)).length === 0) await db.rooms.delete(peer);
    else await refreshRoom(peer);
  });

/** "Clear history" once its Undo time is up: messages up to `at`; the contact, the session and the room stay. */
export const clearHistoryLocally = (peer: PeerId, at: number): Promise<void> =>
  appDatabase.transaction('rw', [db.rooms, db.messages, db.attachments, db.keys], async () => {
    await dropAttachments(await messagesUpTo(peer, at).primaryKeys());
    await messagesUpTo(peer, at).delete();
    await refreshRoom(peer, { unreadCount: 0, markedUnread: false });
  });

/** A withdrawn request is gone from this device; it expires in the store on its own. */
export const withdrawRequestLocally = async (peer: HexString): Promise<number> =>
  db.requests
    .where('peerAccountId')
    .equals(peer)
    .filter(row => row.direction === 'outgoing' && row.status === 'pending')
    .delete();

/** Archive (and unpin: an archived chat is not at the top) or bring back. */
export const setArchived = (peer: PeerId, archived: boolean): Promise<number> =>
  db.rooms.update(peer, archived ? { archived: true, pinnedAt: undefined } : { archived: false });

/**
 * Pin (bringing an archived chat back) or unpin. `false` when `MAX_PINNED`
 * chats are pinned already: nothing changes then.
 */
export const setPinned = (peer: PeerId, pinned: boolean, now: number = Date.now()): Promise<boolean> =>
  appDatabase.transaction('rw', db.rooms, async () => {
    if (!pinned) {
      await db.rooms.update(peer, { pinnedAt: undefined });
      return true;
    }
    const room = await db.rooms.get(peer);
    if (!room) return false;
    if (room.pinnedAt !== undefined) return true;
    const count = (await db.rooms.toArray()).filter(row => row.pinnedAt !== undefined).length;
    if (count >= MAX_PINNED) return false;
    await db.rooms.update(peer, { pinnedAt: now, archived: false });
    return true;
  });

/** "Mark as unread" (a mark while nothing is unread) or "Mark as read" (clears the count too). */
export const setMarkedUnread = (peer: PeerId, unread: boolean): Promise<number> =>
  unread ? db.rooms.update(peer, { markedUnread: true }) : markRoomRead(peer);

/** A local label for a contact; an empty one removes it. */
export const setNickname = (accountId: HexString, nickname: string): Promise<number> => {
  const label = [...nickname.trim()].slice(0, MAX_NICKNAME_CHARS).join('');
  return db.contacts.update(accountId, { nickname: label === '' ? undefined : label });
};

/** The name a contact goes by on this device. */
export const displayName = (contact: { username: string; nickname?: string }): string => contact.nickname ?? contact.username;

export const blockPeer = (peer: { accountId: HexString; username: string }, now: number = Date.now()): Promise<HexString> =>
  db.blocked.put({ accountId: peer.accountId, username: peer.username, blockedAt: now });

export const unblockPeer = (accountId: HexString): Promise<void> => db.blocked.delete(accountId);

export const isBlocked = async (accountId: HexString): Promise<boolean> => (await db.blocked.get(accountId)) !== undefined;

/** Newest block first. */
export const listBlocked = async (): Promise<BlockedRow[]> => (await db.blocked.toArray()).sort((a, b) => b.blockedAt - a.blockedAt);

/**
 * What "Forward" sends: the text of a message, as a new plain text. A
 * keyboard goes as its menu-as-text fallback (spec 0006), so no button and
 * no `tx` intent travels. Null for what has no text to forward.
 */
export const forwardText = (row: MessageRow): string | null => {
  if (row.direction === 'system') return null;
  switch (row.content.type) {
    case 'text':
    case 'reply':
      return row.content.text.trim() === '' ? null : row.content.text;
    case 'richText':
      // Attachments stay behind: only the text is forwarded.
      return row.content.text && row.content.text.trim() !== '' ? row.content.text : null;
    case 'buttons': {
      const text = buttonsFallbackText(row.content.text, row.content.rows);
      return text.trim() === '' ? null : text;
    }
    default:
      return null;
  }
};
