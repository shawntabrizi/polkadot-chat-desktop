import { beforeEach, describe, expect, it } from 'vitest';

import { type MessageRow, appDatabase, db } from '../../app/database';

import {
  PENDING_DELETIONS_PER_PEER,
  addMessage,
  applyDeletion,
  applyEdit,
  applyReaction,
  countUnread,
  ensureRoom,
  listMessages,
  listRooms,
  markDeliveredBefore,
  markRoomRead,
  removeMessage,
  searchMessages,
  setMessageStatus,
  setRoomMuted,
  tombstoneMessage,
} from './messages';

const PEER = '0xaa' as const;

const row = (messageId: string, overrides: Partial<MessageRow> = {}): MessageRow => ({
  messageId,
  peerAccountId: PEER,
  timestamp: 1,
  direction: 'incoming',
  status: 'received',
  content: { type: 'text', text: messageId },
  reactions: [],
  editedAt: null,
  ...overrides,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('messages repository', () => {
  it('creates the room with the first message and counts unread incoming rows', async () => {
    expect(await addMessage(row('a', { timestamp: 1 }))).toBe(true);
    expect(await addMessage(row('b', { timestamp: 2, direction: 'outgoing', status: 'sending' }))).toBe(true);
    expect(await addMessage(row('c', { timestamp: 3 }), { read: true })).toBe(true);
    const [room] = await listRooms();
    expect(room).toMatchObject({ peerAccountId: PEER, unreadCount: 1, lastMessageAt: 3, lastPreview: 'c' });
    await markRoomRead(PEER);
    expect((await listRooms())[0]?.unreadCount).toBe(0);
  });

  // The store re-delivers statements; a message id seen twice must not
  // produce two bubbles or bump unread twice.
  it('ignores a duplicate message id', async () => {
    await addMessage(row('a'));
    expect(await addMessage(row('a', { content: { type: 'text', text: 'changed' } }))).toBe(false);
    expect((await listMessages(PEER)).map(m => m.content)).toEqual([{ type: 'text', text: 'a' }]);
    expect((await listRooms())[0]?.unreadCount).toBe(1);
  });

  it('lists a room in timestamp order and keeps peers apart', async () => {
    await addMessage(row('late', { timestamp: 5 }));
    await addMessage(row('early', { timestamp: 2 }));
    await addMessage(row('other', { peerAccountId: '0xbb', timestamp: 3 }));
    expect((await listMessages(PEER)).map(m => m.messageId)).toEqual(['early', 'late']);
    expect((await listRooms()).map(r => r.peerAccountId)).toEqual([PEER, '0xbb']);
  });

  it('toggles reactions per emoji and side', async () => {
    await addMessage(row('a'));
    await applyReaction('a', '👍', 'me', true);
    await applyReaction('a', '👍', 'peer', true);
    await applyReaction('a', '👍', 'me', true);
    expect((await db.messages.get('a'))?.reactions).toEqual([
      { emoji: '👍', by: 'peer' },
      { emoji: '👍', by: 'me' },
    ]);
    await applyReaction('a', '👍', 'me', false);
    expect((await db.messages.get('a'))?.reactions).toEqual([{ emoji: '👍', by: 'peer' }]);
    // A reaction to an unknown message is a no-op, not an error.
    expect(await applyReaction('missing', '👍', 'peer', true)).toBe(0);
  });

  it('edits text rows only', async () => {
    await addMessage(row('a'));
    await addMessage(row('sys', { direction: 'system', content: { type: 'contactAdded' } }));
    await applyEdit('a', 'edited', 9);
    await applyEdit('sys', 'edited', 9);
    expect((await db.messages.get('a'))).toMatchObject({ content: { type: 'text', text: 'edited' }, editedAt: 9 });
    expect((await db.messages.get('sys'))).toMatchObject({ content: { type: 'contactAdded' }, editedAt: null });
  });

  it('moves outgoing rows sent before a batch ack to delivered, and nothing else', async () => {
    await addMessage(row('old-sent', { timestamp: 1, direction: 'outgoing', status: 'sent' }));
    await addMessage(row('old-failed', { timestamp: 2, direction: 'outgoing', status: 'failed' }));
    await addMessage(row('new-sent', { timestamp: 10, direction: 'outgoing', status: 'sent' }));
    await addMessage(row('theirs', { timestamp: 3 }));
    await markDeliveredBefore(PEER, 5);
    const status = async (id: string) => (await db.messages.get(id))?.status;
    expect(await status('old-sent')).toBe('delivered');
    expect(await status('old-failed')).toBe('failed');
    expect(await status('new-sent')).toBe('sent');
    expect(await status('theirs')).toBe('received');
    await setMessageStatus('new-sent', 'delivered');
    expect(await status('new-sent')).toBe('delivered');
  });

  it('ensureRoom creates an empty room once', async () => {
    await ensureRoom(PEER);
    await ensureRoom(PEER);
    expect(await db.rooms.count()).toBe(1);
    await addMessage(row('a', { timestamp: 99 }));
    expect((await listRooms())[0]?.lastPreview).toBe('a');
  });

  // Found in the M6 screenshots: a new message rewrote the room row and unmuted it.
  it('keeps a room muted when messages arrive, and leaves it out of the unread count', async () => {
    await addMessage(row('a', { timestamp: 1 }));
    await setRoomMuted(PEER, true);
    await addMessage(row('b', { timestamp: 2 }));
    expect((await db.rooms.get(PEER))?.muted).toBe(true);
    expect((await db.rooms.get(PEER))?.unreadCount).toBe(2);
    expect(await countUnread()).toBe(0);
    await setRoomMuted(PEER, false);
    expect(await countUnread()).toBe(2);
  });
});

// RFC-0003 "Recipient flow". Each rule is one test; the RFC's wording is in
// the test name.
describe('RFC-0003 deletions (recipient)', () => {
  it('known target: the peer’s message becomes a tombstone that keeps id, time and order, and loses text, reactions and edit mark', async () => {
    await addMessage(row('a', { timestamp: 1, reactions: [{ emoji: '👍', by: 'me' }], editedAt: 5 }));
    await addMessage(row('b', { timestamp: 2 }));
    expect(await applyDeletion(PEER, 'a')).toBe('tombstoned');
    const deleted = await db.messages.get('a');
    expect(deleted).toMatchObject({ messageId: 'a', timestamp: 1, direction: 'incoming', content: { type: 'deleted' }, reactions: [], editedAt: null });
    expect(JSON.stringify(deleted)).not.toContain('"text"');
    expect((await listMessages(PEER)).map(m => m.messageId)).toEqual(['a', 'b']);
  });

  it('deletion is terminal: a later edit does not bring the text back, and a later reaction is not kept', async () => {
    await addMessage(row('a'));
    await applyDeletion(PEER, 'a');
    await applyEdit('a', 'resurrected', 9);
    await applyReaction('a', '🔥', 'peer', true);
    expect(await db.messages.get('a')).toMatchObject({ content: { type: 'deleted' }, reactions: [], editedAt: null });
  });

  it('authorization: a deletion of our own message, or of another peer’s message, is ignored', async () => {
    await addMessage(row('mine', { direction: 'outgoing', status: 'delivered' }));
    await addMessage(row('theirs-other-peer', { peerAccountId: '0xbb' }));
    expect(await applyDeletion(PEER, 'mine')).toBe('ignored');
    expect(await applyDeletion(PEER, 'theirs-other-peer')).toBe('ignored');
    expect((await db.messages.get('mine'))?.content).toEqual({ type: 'text', text: 'mine' });
    expect((await db.messages.get('theirs-other-peer'))?.content).toEqual({ type: 'text', text: 'theirs-other-peer' });
    // An ignored deletion leaves nothing pending.
    expect(await db.pendingDeletions.count()).toBe(0);
  });

  it('unknown target: a deletion that arrives before its message means the message is never shown, and does not count as unread', async () => {
    expect(await applyDeletion(PEER, 'late')).toBe('pending');
    expect(await addMessage(row('late', { timestamp: 3 }))).toBe(true);
    expect((await db.messages.get('late'))?.content).toEqual({ type: 'deleted' });
    expect((await listRooms())[0]).toMatchObject({ unreadCount: 0, lastPreview: 'Message deleted' });
    // Applied once: the pending entry is gone.
    expect(await db.pendingDeletions.count()).toBe(0);
  });

  it('a pending deletion is per peer: the same id from another peer is shown', async () => {
    await applyDeletion(PEER, 'x');
    await addMessage(row('x', { peerAccountId: '0xbb' }));
    expect((await db.messages.get('x'))?.content).toEqual({ type: 'text', text: 'x' });
  });

  it('idempotence: a duplicate deletion (before or after the target) is a no-op', async () => {
    expect(await applyDeletion(PEER, 'a', 1)).toBe('pending');
    expect(await applyDeletion(PEER, 'a', 2)).toBe('pending');
    expect(await db.pendingDeletions.toArray()).toEqual([{ peerAccountId: PEER, messageId: 'a', createdAt: 1 }]);
    await addMessage(row('a'));
    const once = await db.messages.get('a');
    expect(await applyDeletion(PEER, 'a')).toBe('tombstoned');
    expect(await db.messages.get('a')).toEqual(once);
    // The statement resent: the target again, now a known tombstone.
    expect(await addMessage(row('a'))).toBe(false);
    expect((await db.messages.get('a'))?.content).toEqual({ type: 'deleted' });
  });

  it('the pending set is bounded per peer; the oldest entry is evicted', async () => {
    for (let i = 0; i < PENDING_DELETIONS_PER_PEER; i++) await applyDeletion(PEER, `m${i}`, 1000 + i);
    await applyDeletion('0xbb', 'other', 1);
    await applyDeletion(PEER, 'newest', 5000);
    expect(await db.pendingDeletions.where('[peerAccountId+createdAt]').between([PEER, -Infinity], [PEER, Infinity]).count()).toBe(PENDING_DELETIONS_PER_PEER);
    expect(await db.pendingDeletions.get([PEER, 'm0'])).toBeUndefined();
    expect(await db.pendingDeletions.get([PEER, 'm1'])).toBeDefined();
    expect(await db.pendingDeletions.get([PEER, 'newest'])).toBeDefined();
    // Another peer's entries do not count against this peer's bound.
    expect(await db.pendingDeletions.get(['0xbb', 'other'])).toBeDefined();
  });

  it('a tombstone of the newest message becomes the chat list preview', async () => {
    await addMessage(row('a', { timestamp: 1 }));
    await addMessage(row('b', { timestamp: 2 }));
    await applyDeletion(PEER, 'a');
    expect((await listRooms())[0]?.lastPreview).toBe('b');
    await applyDeletion(PEER, 'b');
    expect((await listRooms())[0]?.lastPreview).toBe('Message deleted');
  });
});

describe('RFC-0003 deletions (sender, local side)', () => {
  it('tombstoneMessage tombstones our own row, once', async () => {
    await addMessage(row('mine', { direction: 'outgoing', status: 'delivered' }));
    expect(await tombstoneMessage('mine')).toBe(true);
    expect(await tombstoneMessage('mine')).toBe(true);
    expect(await db.messages.get('mine')).toMatchObject({ content: { type: 'deleted' }, status: 'delivered' });
    expect(await tombstoneMessage('missing')).toBe(false);
  });

  it('removeMessage drops a never-sent row and the preview falls back to the row before it', async () => {
    await addMessage(row('a', { timestamp: 1 }));
    await addMessage(row('unsent', { timestamp: 2, direction: 'outgoing', status: 'failed' }));
    expect((await listRooms())[0]?.lastPreview).toBe('unsent');
    await removeMessage('unsent');
    expect(await db.messages.get('unsent')).toBeUndefined();
    expect((await listRooms())[0]).toMatchObject({ lastPreview: 'a', lastMessageAt: 1 });
  });
});

describe('searchMessages', () => {
  it('finds text and richText rows by case-insensitive substring, newest first, at most 20', async () => {
    await addMessage(row('old', { timestamp: 1, content: { type: 'text', text: 'Ask about the People chain' } }));
    await addMessage(row('rich', { timestamp: 2, content: { type: 'richText', text: 'people photos', attachments: [] } }));
    await addMessage(row('reply', { timestamp: 3, content: { type: 'reply', messageId: 'old', text: 'people again' } }));
    await addMessage(row('frame', { timestamp: 4, content: { type: 'text', text: '⏳ working · 3s\n▸ Reading people.md' } }));
    await addMessage(row('other', { timestamp: 5, content: { type: 'text', text: 'nothing here' } }));
    expect((await searchMessages('  PEOPLE ')).map(hit => hit.messageId)).toEqual(['rich', 'old']);
    expect(await searchMessages('   ')).toEqual([]);

    for (let i = 0; i < 25; i++) await addMessage(row(`m${i}`, { timestamp: 100 + i, content: { type: 'text', text: `people ${i}` } }));
    const capped = await searchMessages('people');
    expect(capped).toHaveLength(20);
    expect(capped[0]?.messageId).toBe('m24');
  });

  // M7b step 4: the search runs on every keystroke, so it must stay under
  // 50 ms with 5 000 stored messages. If this fails, add a text index.
  it('answers under 50 ms over 5 000 rows', async () => {
    const rows = Array.from({ length: 5_000 }, (_, i) =>
      row(`bulk${i}`, {
        peerAccountId: i % 2 === 0 ? PEER : '0xbb',
        timestamp: i,
        content: { type: 'text', text: i % 500 === 0 ? `the needle ${i} is here` : `ordinary message number ${i} about the People chain` },
      }),
    );
    await db.messages.bulkAdd(rows);
    await searchMessages('warm up'); // the first read opens the database
    const started = performance.now();
    const hits = await searchMessages('needle');
    const elapsed = performance.now() - started;
    console.log(`searchMessages over 5000 rows: ${elapsed.toFixed(1)} ms, ${hits.length} hits`);
    expect(hits.map(hit => hit.messageId)).toEqual(Array.from({ length: 10 }, (_, k) => `bulk${(9 - k) * 500}`));
    expect(elapsed).toBeLessThan(50);
  });
});
