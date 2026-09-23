import { beforeEach, describe, expect, it } from 'vitest';

import { type MessageRow, appDatabase, db } from '../../app/database';

import { addMessage, applyEdit, applyReaction, ensureRoom, listMessages, listRooms, markDeliveredBefore, markRoomRead, setMessageStatus } from './messages';

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
});
