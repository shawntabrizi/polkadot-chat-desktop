/**
 * M22b: a phone's `SyncUpdate` lands in Dexie as history, and this device
 * sends back only what the phone cannot have: its own sends and its own
 * chat changes. Why each rule matters is on its test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { type MessageRow, appDatabase, db } from '../../app/database';
import { readSetting } from '../../app/settings';

import type { LocalMessage, SyncUpdate } from './codec';
import { type ApplyDeps, applyUpdate, collectEntities } from './entities';

const own = new Uint8Array(32).fill(0x0d);
const peerBytes = new Uint8Array(32).fill(0x44);
const peer = bytesToHex(peerBytes) as HexString;
const stranger = new Uint8Array(32).fill(0x99);

const message = (id: string, content: LocalMessage['remote']['versioned']['value'], status: LocalMessage['status'], at = 1_000, to = peerBytes): LocalMessage => ({
  remote: { messageId: id, timestamp: BigInt(at), versioned: { tag: 'v1', value: content } },
  peerId: to,
  status,
  order: BigInt(at),
});
const incoming = (seen: boolean): LocalMessage['status'] => ({ tag: 'Incoming', value: { tag: seen ? 'SEEN' : 'NEW', value: undefined } });
const outgoing = (tag: 'NEW' | 'SENT' | 'DELIVERED'): LocalMessage['status'] => ({ tag: 'Outgoing', value: { tag, value: undefined } });
const update = (entities: SyncUpdate['entities'], timePoint = 5_000): SyncUpdate => ({ id: 1, entities, timePoint: BigInt(timePoint) });

const depsWith = (overrides: Partial<ApplyDeps> = {}): ApplyDeps => ({
  ownStatementAccountId: own,
  ensureContact: vi.fn(async (account: HexString) => account === peer),
  removeChat: vi.fn(async () => undefined),
  deliverIncoming: vi.fn(async () => undefined),
  onOwnDeviceRemoved: vi.fn(),
  ...overrides,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('applyUpdate', () => {
  it('history from the phone: incoming read as the phone read it, own rows as sent or delivered, all marked synced', async () => {
    const deps = depsWith();
    await applyUpdate(
      update([
        {
          tag: 'Messages',
          value: [
            message('in-seen', { tag: 'text', value: 'seen on phone' }, incoming(true), 1_000),
            message('in-new', { tag: 'text', value: 'not seen yet' }, incoming(false), 2_000),
            message('out-done', { tag: 'text', value: 'from the phone' }, outgoing('DELIVERED'), 3_000),
            message('out-new', { tag: 'reply', value: { messageId: 'in-seen', ownContent: { text: 'answer', attachments: undefined } } }, outgoing('NEW'), 4_000),
          ],
        },
      ]),
      deps,
    );
    const rows = await db.messages.toArray();
    const byId = Object.fromEntries(rows.map(row => [row.messageId, row]));
    expect(byId['in-seen']).toMatchObject({ direction: 'incoming', status: 'received', content: { type: 'text', text: 'seen on phone' }, synced: true });
    expect(byId['out-done']).toMatchObject({ direction: 'outgoing', status: 'delivered', synced: true });
    // The phone's NEW is not on a statement yet; this device never sends it, so it must not show "sending" here for ever.
    expect(byId['out-new']).toMatchObject({ direction: 'outgoing', status: 'sent', content: { type: 'reply', messageId: 'in-seen', text: 'answer' } });
    // Only the message the phone had not seen counts as unread.
    expect((await db.rooms.get(peer))?.unreadCount).toBe(1);
  });

  it('a contact’s DeviceAdded, reaction and edit take the live path; calls and tokens are not history', async () => {
    const deps = depsWith();
    const device = { statementAccountId: new Uint8Array(32).fill(1), encryptionPublicKey: new Uint8Array(32).fill(2) };
    await applyUpdate(
      update([
        {
          tag: 'Messages',
          value: [
            message('dev', { tag: 'deviceAdded', value: device }, incoming(false)),
            message('react', { tag: 'reacted', value: { messageId: 'x', emoji: '👍' } }, incoming(true)),
            message('call', { tag: 'dataChannelClosed', value: { offerMessageId: 'c' } }, incoming(true)),
          ],
        },
      ]),
      deps,
    );
    const delivered = vi.mocked(deps.deliverIncoming).mock.calls.map(([, m]) => m.messageId);
    expect(delivered).toEqual(['dev', 'react']);
    expect(await db.messages.count()).toBe(0);
  });

  it('our phone’s DeviceRemoved of THIS device signs out; of another device it does not', async () => {
    const deps = depsWith();
    await applyUpdate(update([{ tag: 'Messages', value: [message('rm-other', { tag: 'deviceRemoved', value: { statementAccountId: new Uint8Array(32).fill(7) } }, outgoing('SENT'))] }]), deps);
    expect(deps.onOwnDeviceRemoved).not.toHaveBeenCalled();
    await applyUpdate(update([{ tag: 'Messages', value: [message('rm-me', { tag: 'deviceRemoved', value: { statementAccountId: own } }, outgoing('SENT'))] }]), deps);
    expect(deps.onOwnDeviceRemoved).toHaveBeenCalledTimes(1);
    // A contact removing ITS device is roster news for that contact, never a sign-out here.
    await applyUpdate(update([{ tag: 'Messages', value: [message('rm-peer', { tag: 'deviceRemoved', value: { statementAccountId: own } }, incoming(false))] }]), deps);
    expect(deps.onOwnDeviceRemoved).toHaveBeenCalledTimes(1);
  });

  it('chats: added through ensureContact, removed at the update time; messages of an unknown identity are left to the phone', async () => {
    const deps = depsWith();
    await applyUpdate(
      update(
        [
          { tag: 'ChatsAdded', value: [{ tag: 'Contact', value: peerBytes }] },
          { tag: 'ChatsRemoved', value: [{ tag: 'Contact', value: stranger }] },
          { tag: 'Messages', value: [message('lost', { tag: 'text', value: 'x' }, incoming(false), 1, stranger)] },
          { tag: 'Devices', value: [{ statementAccountId: own, encryptionPublicKey: own, status: { tag: 'ACTIVE', value: undefined }, lastUpdate: 9n }] },
        ],
        7_000,
      ),
      deps,
    );
    expect(deps.ensureContact).toHaveBeenCalledWith(peer);
    expect(deps.removeChat).toHaveBeenCalledWith(bytesToHex(stranger), 7_000);
    expect(await db.messages.get('lost')).toBeUndefined();
    expect(JSON.parse((await readSetting('deviceSync.devices')) ?? '[]')).toEqual([{ statementAccountId: bytesToHex(own), encryptionPublicKey: bytesToHex(own), status: 'ACTIVE', lastUpdate: 9 }]);
  });

  it('applying the same update twice changes nothing (the phone re-sends when an ack is lost)', async () => {
    const deps = depsWith();
    const again = update([{ tag: 'Messages', value: [message('once', { tag: 'text', value: 'x' }, incoming(false))] }]);
    await applyUpdate(again, deps);
    await applyUpdate(again, deps);
    expect(await db.messages.count()).toBe(1);
    expect((await db.rooms.get(peer))?.unreadCount).toBe(1);
  });
});

describe('collectEntities', () => {
  const row = (id: string, fields: Partial<MessageRow>): MessageRow => ({
    messageId: id,
    peerAccountId: peer,
    timestamp: 2_000,
    direction: 'outgoing',
    status: 'delivered',
    content: { type: 'text', text: id },
    reactions: [],
    editedAt: null,
    ...fields,
  });

  it('sends this device’s own texts and replies after the checkpoint, nothing the phone already has', async () => {
    await db.messages.bulkAdd([
      row('mine', {}),
      row('mine-sending', { status: 'sending', timestamp: 2_500 }),
      row('old', { timestamp: 500 }),
      row('from-phone', { synced: true }),
      row('incoming', { direction: 'incoming', status: 'received' }),
      row('file', { content: { type: 'attachment', items: [], caption: null } }),
      row('group', { peerAccountId: 'group:g1' }),
    ]);
    await db.contacts.put({ accountId: peer, username: 'p', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 1_500, updatedAt: 1_500 });
    await db.deletedChats.put({ peerId: bytesToHex(stranger) as HexString, deletedAt: 1_800 });
    const entities = await collectEntities(1_000);
    expect(entities.map(entity => entity.tag)).toEqual(['ChatsAdded', 'ChatsRemoved', 'Messages']);
    const messages = entities.find(entity => entity.tag === 'Messages');
    if (messages?.tag !== 'Messages') throw new Error('no messages');
    expect(messages.value.map(m => [m.remote.messageId, m.status.value.tag])).toEqual([
      ['mine', 'DELIVERED'],
      ['mine-sending', 'NEW'],
    ]);
    expect(await collectEntities(3_000)).toEqual([]);
  });
});
