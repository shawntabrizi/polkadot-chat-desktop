/**
 * M12e chat management as the list shows it. Why each rule matters:
 * - Delete acts at once with no confirm (design system §10), so Undo must
 *   bring everything back: the rows stay in Dexie until the 6 s end, and only
 *   then are the room and its messages gone from this device.
 * - Clear history keeps the contact and the chat (only the messages go).
 * - Pinned chats stay on top in the order they were pinned, at most 5.
 * - Archived chats leave the main list for the collapsed section, and their
 *   unread still reaches the dock badge.
 * - A pending request says how long it has waited (owner: a request to a bot
 *   that will never answer).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HexString } from '../app/bytes';
import { type MessageRow, appDatabase, db } from '../app/database';
import { ASSISTANT_PEER } from '../domain/assistant/assistant';
import { FAUCET_PEER } from '../domain/faucet/faucet';
import { upsertContactDevice } from '../domain/contacts/repository';
import { MAX_PINNED, clearHistoryLocally, deleteChatLocally, setArchived, setMarkedUnread, setNickname, setPinned } from '../domain/chat/chatActions';
import { addMessage, countUnread, ensureRoom, listMessages, setRoomMuted } from '../domain/chat/messages';
import { UNDO_MS, clearKey, createPendingActions, deleteKey } from '../domain/chat/undo';

import { buildRows, loadList, outgoingPreview } from './ChatList';

const ALICE = '0xaa' as HexString;
const BOB = '0xbb' as HexString;

const message = (peer: HexString, messageId: string, timestamp: number, direction: MessageRow['direction'] = 'incoming'): MessageRow => ({
  messageId,
  peerAccountId: peer,
  timestamp,
  direction,
  status: direction === 'incoming' ? 'received' : 'sent',
  content: { type: 'text', text: messageId },
  reactions: [],
  editedAt: null,
});

const contact = async (accountId: HexString, username: string) => {
  await upsertContactDevice({ accountId, username, chatPublicKey: new Uint8Array(32) }, null);
};

/** The keys of the main list (Assistant and Faucet are not seeded here) and of the Archived section. */
const listed = async (pending: ReadonlySet<string> = new Set()) => {
  const built = buildRows(await loadList(), { kind: 'other' }, () => undefined, undefined, pending);
  return { main: built.rows.map(row => row.key).filter(key => !key.startsWith('local:')), archived: built.archived.map(row => row.key) };
};

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
  await contact(ALICE, 'alice');
  await contact(BOB, 'bob');
  await addMessage(message(ALICE, 'a1', 1000));
  await addMessage(message(ALICE, 'a2', 2000, 'outgoing'));
  await addMessage(message(BOB, 'b1', 1500));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('delete chat with Undo', () => {
  it('hides the chat at once, and after the Undo time the room and its messages are gone from this device', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = createPendingActions();
    const { done } = pending.schedule(deleteKey(ALICE), () => deleteChatLocally(ALICE, 3000));
    // Hidden from the list, but nothing is deleted yet: Undo is still possible.
    expect((await listed(pending.snapshot())).main).toEqual([BOB]);
    expect(await listMessages(ALICE)).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await done;
    expect(pending.snapshot().size).toBe(0);
    expect((await listed(pending.snapshot())).main).toEqual([BOB]);
    expect(await listMessages(ALICE)).toEqual([]);
    expect(await db.rooms.get(ALICE)).toBeUndefined();
    // The peer is still known: their next message brings the chat back.
    expect(await db.contacts.get(ALICE)).toBeDefined();
    await addMessage(message(ALICE, 'a3', 4000));
    expect((await listed()).main).toContain(ALICE);
  });

  it('Undo within the time brings the chat back with every message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = createPendingActions();
    const commit = vi.fn(() => deleteChatLocally(ALICE, 3000));
    const { undo } = pending.schedule(deleteKey(ALICE), commit);
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    undo();
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(commit).not.toHaveBeenCalled();
    expect((await listed(pending.snapshot())).main).toEqual([ALICE, BOB]);
    expect(await listMessages(ALICE)).toHaveLength(2);
  });

  it('keeps a message that arrived during the Undo time, and the chat with it', async () => {
    await addMessage(message(ALICE, 'late', 5000));
    await deleteChatLocally(ALICE, 3000);
    expect((await listMessages(ALICE)).map(row => row.messageId)).toEqual(['late']);
    expect((await db.rooms.get(ALICE))?.lastPreview).toBe('late');
  });
});

describe('clear history', () => {
  it('empties the chat but keeps the contact, the room and its place in the list', async () => {
    const pending = createPendingActions();
    pending.schedule(clearKey(ALICE), () => Promise.resolve(), 60_000);
    // While the Undo time runs the row shows no last message.
    const rows = buildRows(await loadList(), { kind: 'other' }, () => undefined, undefined, pending.snapshot()).rows;
    expect(rows.some(row => row.key === ALICE)).toBe(true);
    await setMarkedUnread(ALICE, true);
    await clearHistoryLocally(ALICE, 3000);
    expect(await listMessages(ALICE)).toEqual([]);
    expect(await db.rooms.get(ALICE)).toMatchObject({ lastPreview: '', unreadCount: 0, markedUnread: false });
    expect(await db.contacts.get(ALICE)).toBeDefined();
    expect((await listed()).main).toEqual([ALICE, BOB]);
  });
});

describe('pin, archive, unread', () => {
  it('puts pinned chats first in pin order, and refuses a sixth pin', async () => {
    expect((await listed()).main).toEqual([ALICE, BOB]);
    await setPinned(BOB, true, 10);
    expect((await listed()).main).toEqual([BOB, ALICE]);
    // A new message to ALICE does not move it above the pinned chat.
    await addMessage(message(ALICE, 'a9', 9000));
    expect((await listed()).main).toEqual([BOB, ALICE]);
    await setPinned(ALICE, true, 20);
    expect((await listed()).main).toEqual([BOB, ALICE]);

    for (let i = 0; i < MAX_PINNED - 2; i++) {
      const peer = `0x${(0xc0 + i).toString(16)}` as HexString;
      await contact(peer, `user${i}`);
      await addMessage(message(peer, `m${i}`, 100 + i));
      expect(await setPinned(peer, true, 30 + i)).toBe(true);
    }
    const extra = '0xee' as HexString;
    await contact(extra, 'extra');
    await addMessage(message(extra, 'e1', 50));
    expect(await setPinned(extra, true)).toBe(false);
    expect((await db.rooms.get(extra))?.pinnedAt).toBeUndefined();
  });

  it('moves an archived chat to the Archived section, still counting its unread in the badge', async () => {
    await setArchived(BOB, true);
    expect(await listed()).toEqual({ main: [ALICE], archived: [BOB] });
    // bob's one incoming message is unread, alice's is too (not read yet).
    expect(await countUnread()).toBe(2);
    await setArchived(BOB, false);
    expect(await listed()).toEqual({ main: [ALICE, BOB], archived: [] });
  });

  // M12f (Telegram): an archived chat must not hide a peer who writes again,
  // but a muted one stays out of sight, as the user asked twice.
  it('brings an archived chat back on a new message from the peer, unless it is muted', async () => {
    await setArchived(BOB, true);
    // An own message (sent from another device, or a forward) does not bring it back.
    await addMessage(message(BOB, 'b-own', 8000, 'outgoing'));
    expect((await listed()).archived).toEqual([BOB]);
    await addMessage(message(BOB, 'b2', 9000));
    expect(await listed()).toEqual({ main: [BOB, ALICE], archived: [] });

    await setArchived(ALICE, true);
    await setRoomMuted(ALICE, true);
    await addMessage(message(ALICE, 'a9', 9500));
    expect(await listed()).toEqual({ main: [BOB], archived: [ALICE] });
  });

  // M12f: pinned means top. The owner pins a chat to see it first, above the
  // two fixed local rows; unpinned chats stay below them.
  it('puts pinned chats above the Assistant and the Faucet, and the others below', async () => {
    await ensureRoom(FAUCET_PEER);
    await setPinned(BOB, true, 10);
    const keys = buildRows(await loadList(), { kind: 'other' }, () => undefined).rows.map(row => row.key);
    expect(keys).toEqual([BOB, ASSISTANT_PEER, FAUCET_PEER, ALICE]);
  });

  it('keeps archive, pin and marks when a new message arrives', async () => {
    await setPinned(BOB, true, 10);
    await setMarkedUnread(ALICE, true);
    await addMessage(message(BOB, 'b2', 9000));
    await addMessage(message(ALICE, 'a9', 9001, 'outgoing'));
    expect((await db.rooms.get(BOB))?.pinnedAt).toBe(10);
    expect((await db.rooms.get(ALICE))?.markedUnread).toBe(true);
  });

  it('counts a chat marked as unread as one in the badge until it is read', async () => {
    await db.rooms.update(ALICE, { unreadCount: 0 });
    await db.rooms.update(BOB, { unreadCount: 0 });
    await setMarkedUnread(ALICE, true);
    expect(await countUnread()).toBe(1);
    await setMarkedUnread(ALICE, false);
    expect(await countUnread()).toBe(0);
  });
});

describe('nickname', () => {
  it('shows the nickname as the name, keeps the username, and survives a contact refresh', async () => {
    await setNickname(ALICE, '  Mum  ');
    // The chain data of the contact is refreshed on every device change.
    await upsertContactDevice({ accountId: ALICE, username: 'alice', chatPublicKey: new Uint8Array(32) }, null);
    const row = buildRows(await loadList(), { kind: 'other' }, () => undefined).rows.find(entry => entry.key === ALICE);
    expect(row).toMatchObject({ name: 'Mum', username: 'alice' });
    await setNickname(ALICE, '');
    expect((await db.contacts.get(ALICE))?.nickname).toBeUndefined();
  });
});

describe('pending outgoing request', () => {
  it('says how long it has waited', () => {
    const now = Date.UTC(2026, 8, 24, 12);
    expect(outgoingPreview(now - 3 * 24 * 3_600_000, now)).toBe('No answer yet · sent 3 d ago');
    expect(outgoingPreview(now - 5 * 60_000, now)).toBe('No answer yet · sent 5 min ago');
  });

  // M12i review: "No answer yet" a second after sending reads as a failure,
  // and the demo row already says "Sent" for 15 s. One request, one wording.
  it('reads "Sent · just now" for the first 15 s, as the demo row does', () => {
    const now = Date.UTC(2026, 8, 24, 12);
    expect(outgoingPreview(now, now)).toBe('Sent · just now');
    expect(outgoingPreview(now - 14_999, now)).toBe('Sent · just now');
    expect(outgoingPreview(now - 15_000, now)).toBe('No answer yet · sent just now');
  });
});
