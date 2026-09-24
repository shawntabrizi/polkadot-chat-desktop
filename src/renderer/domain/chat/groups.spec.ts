/**
 * Spec 0009 fan-out groups through the manager (this client) against
 * hand-driven members that run the same SDK sessions over one in-memory
 * store. Three identities in every test (four where a stranger is needed):
 * the rules of the RFC's Testing section.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { type GroupRow, appDatabase, db, groupPeerOf } from '../../app/database';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { makeGroupStore } from '../testing/groupStore';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { type GroupInfo, type OutgoingContent, toWire } from './content';
import { compareGroupRows, getGroup } from './groups';
import { type GroupsV2Storage, type IncomingGroupMessage, createGroupsV2 } from './groupsV2';
import { createIdentityChannel } from './identityChannel';
import type { ChatContent, GroupInfoWire, GroupMessageWire, IdentityChannelEvent } from './identityEvents';
import { listMessages } from './messages';
import { type ChatManager, createChatManager } from './manager';
import { createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, createPeerSession } from './peerSession';

type Store = ReturnType<typeof createInMemoryStatementStore>;

/** A member's own group rows, apart from the client's Dexie. */
const memoryGroupStorage = (): GroupsV2Storage => {
  const groups = new Map<string, GroupRow>();
  return {
    getGroup: async id => structuredClone(groups.get(id)),
    putGroup: async row => groups.set(row.id, structuredClone(row)),
    listGroups: async () => [...groups.values()].map(row => structuredClone(row)),
    addSystemRow: async () => undefined,
    ensureRoom: async () => undefined,
    listRows: async () => [],
    markSent: async () => undefined,
  };
};
type Member = TestPeer & { name: string; hex: HexString };

const member = (name: string): Member => {
  const peer = makePeer();
  return { ...peer, name, hex: bytesToHex(peer.identity.identityAccountId) };
};

const lookupOf = (members: Member[]): IdentityLookup => ({
  getPeerIdentity: async accountId => {
    const found = members.find(entry => entry.hex === bytesToHex(accountId));
    return found ? { accountId, username: found.name, chatPublicKey: found.identity.identityChatPublicKey } : null;
  },
});

/** A member's transport towards this client, as a bot runs it. */
const openTransport = (store: Store, self: Member, web: Member) => {
  const events: IdentityChannelEvent[] = [];
  const received: IncomingChatMessage[] = [];
  const channel = createIdentityChannel({
    ownIdentityAccountId: self.identity.identityAccountId,
    ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onEvent: event => events.push(event),
  });
  const roster = createPeerRoster([]);
  const session = createPeerSession({
    identity: self.identity,
    deviceKeys: self.device,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    peerRoster: roster,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onMessage: message => received.push(message),
    onSent: () => undefined,
    onDelivered: () => undefined,
    onBatchDelivered: () => undefined,
  });
  let counter = 0;
  return {
    events,
    received,
    roster,
    send: (content: OutgoingContent, ids: { messageId?: string; timestamp?: number } = {}) =>
      session.send(toWire(content), { messageId: ids.messageId ?? `${self.name}-${++counter}`, timestamp: ids.timestamp ?? Date.now() }),
    /** Content of `tag` this member received from the client. */
    of: <T extends ChatContent['tag']>(tag: T) => received.filter(message => message.content.tag === tag),
    dispose: () => {
      channel.dispose();
      session.dispose();
    },
  };
};
type Transport = ReturnType<typeof openTransport>;

/** The member sends a chat request, the client accepts, the member learns the client's device. */
const connect = async (store: Store, web: Member, peer: Member, manager: ChatManager): Promise<Transport> => {
  const transport = openTransport(store, peer, web);
  const { requestId } = await sendChatRequest({
    recipientAccountId: web.identity.identityAccountId,
    recipientChatPublicKey: web.identity.identityChatPublicKey,
    senderIdentityAccountId: peer.identity.identityAccountId,
    senderIdentityChatPrivateKey: peer.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: peer.device.encryptionPublicKey,
    senderDeviceSeed: peer.device.statementAccountSeed,
    welcomeMessage: null,
    statementStore: store,
    allocator: createExpiryAllocator(),
  });
  await waitFor(() => db.requests.get(requestId));
  await manager.acceptRequest(requestId);
  const accepted = await waitFor(() => transport.events.find(event => event.tag === 'accepted'));
  if (accepted.tag === 'accepted') transport.roster.set([accepted.device]);
  return transport;
};

const infoOf = (message: IncomingChatMessage | undefined): GroupInfoWire['value'] | null =>
  message?.content.tag === 'groupInfo' ? message.content.value : null;
const wrappedOf = (message: IncomingChatMessage | undefined): GroupMessageWire['value'] | null =>
  message?.content.tag === 'groupMessage' ? message.content.value : null;

/** A roster as an admin member sends it. */
const roster = (groupId: string, admin: Member, members: Member[], version: number): GroupInfo => ({
  groupId,
  name: 'Crew',
  admin: admin.hex,
  members: members.map(entry => ({ account: entry.hex, username: entry.name, joinedAt: 1 })),
  version,
  createdAt: 1,
});
const wrap = (groupId: string, seq: number, content: OutgoingContent): OutgoingContent => ({ type: 'groupMessage', groupId, infoVersion: 1, seq, content });

let manager: ChatManager | null = null;
let transports: Transport[] = [];

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  for (const transport of transports) transport.dispose();
  manager?.dispose();
  transports = [];
  manager = null;
});

/** The client (`web`) with chats open to `alice` and `bot` (and `stranger` when asked). */
const setUp = async (withStranger = false) => {
  const store = createInMemoryStatementStore();
  const web = member('web');
  const alice = member('alice');
  const bot = member('bot');
  const stranger = member('stranger');
  manager = await createChatManager({
    identity: web.identity,
    deviceKeys: web.device,
    statementStore: store,
    lookup: lookupOf([alice, bot, stranger]),
    username: 'web',
  });
  const toAlice = await connect(store, web, alice, manager);
  const toBot = await connect(store, web, bot, manager);
  const toStranger = withStranger ? await connect(store, web, stranger, manager) : null;
  transports = [toAlice, toBot, ...(toStranger ? [toStranger] : [])];
  return { store, web, alice, bot, stranger, toAlice, toBot, toStranger, manager };
};

describe('spec 0009 groups', () => {
  it('create: the roster v1 goes to every member, with us as admin, and the room exists', async () => {
    const { web, alice, bot, toAlice, toBot, manager } = await setUp();
    const groupId = await manager.createGroup('Crew', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    for (const transport of [toAlice, toBot]) {
      const info = infoOf(await waitFor(() => transport.of('groupInfo')[0]));
      expect(info?.groupId).toBe(groupId);
      expect(info?.version).toBe(1);
      expect(bytesToHex(info?.admin ?? new Uint8Array())).toBe(web.hex);
      expect(info?.members.map(entry => entry.username)).toEqual(['web', 'alice', 'bot']);
    }
    expect((await getGroup(groupId))?.members).toHaveLength(3);
    expect((await db.rooms.get(groupPeerOf(groupId)))?.groupId).toBe(groupId);
  });

  it('fan-out: one message reaches every other member with the same envelope id and seq', async () => {
    const { alice, bot, toAlice, toBot, manager } = await setUp();
    const groupId = await manager.createGroup('Crew', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    await manager.sendToGroup(groupId, { type: 'text', text: 'hello all' });
    const [a, b] = await Promise.all([waitFor(() => toAlice.of('groupMessage')[0]), waitFor(() => toBot.of('groupMessage')[0])]);
    expect(a.messageId).toBe(b.messageId);
    expect(wrappedOf(a)).toMatchObject({ groupId, infoVersion: 1, seq: 1n, content: { tag: 'text', value: 'hello all' } });
    expect(wrappedOf(b)?.seq).toBe(1n);
    const own = (await listMessages(groupPeerOf(groupId))).find(row => row.direction === 'outgoing');
    expect(own?.messageId).toBe(a.messageId);
    expect(own?.content).toEqual({ type: 'text', text: 'hello all' });
  });

  it('a member joins from the admin roster; copies of one envelope id through two paths make one row', async () => {
    const { web, alice, bot, toAlice, toBot } = await setUp();
    const groupId = 'group-dedup';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(groupId));
    await toAlice.send(wrap(groupId, 1, { type: 'text', text: 'hi' }), { messageId: 'shared-id', timestamp: 1000 });
    // The same envelope again, through the bot's session (a relay path).
    await toBot.send(wrap(groupId, 1, { type: 'text', text: 'hi' }), { messageId: 'shared-id', timestamp: 1000 });
    await waitFor(async () => (await getGroup(groupId))?.lastSeq[bot.hex] === 1);
    const rows = (await listMessages(groupPeerOf(groupId))).filter(row => row.direction === 'incoming');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.senderAccountId).toBe(alice.hex);
  });

  it('rejects a group message from an account not in the roster', async () => {
    const { web, alice, bot, toAlice, toStranger } = await setUp(true);
    const groupId = 'group-members';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(groupId));
    await toStranger?.send(wrap(groupId, 1, { type: 'text', text: 'let me in' }), { messageId: 'stranger-1' });
    await toAlice.send(wrap(groupId, 1, { type: 'text', text: 'members only' }), { messageId: 'alice-members-only' });
    await waitFor(async () => (await listMessages(groupPeerOf(groupId))).some(row => row.messageId === 'alice-members-only'));
    expect(await db.messages.get('stranger-1')).toBeUndefined();
  });

  it('ignores a roster from anyone but the admin, and a version that is not higher', async () => {
    const { web, alice, bot, toAlice, toBot } = await setUp();
    const groupId = 'group-admin';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 2) });
    await waitFor(() => getGroup(groupId));
    // The bot claims to be the admin of alice's group, then names alice as admin without being her.
    await toBot.send({ type: 'groupInfo', info: roster(groupId, bot, [bot, web], 3) });
    await toBot.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web], 4) });
    // Alice's own older version.
    await toAlice.send({ type: 'groupInfo', info: { ...roster(groupId, alice, [alice, web], 1), name: 'Old' } });
    await toAlice.send(wrap(groupId, 1, { type: 'text', text: 'marker' }), { messageId: 'marker' });
    await waitFor(() => db.messages.get('marker'));
    const group = await getGroup(groupId);
    expect(group?.version).toBe(2);
    expect(group?.admin).toBe(alice.hex);
    expect(group?.members.map(entry => entry.username)).toEqual(['alice', 'web', 'bot']);
  });

  it('a roster bump without us marks us removed, and we send nothing more', async () => {
    const { web, alice, bot, toAlice, manager } = await setUp();
    const groupId = 'group-removed';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(groupId));
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, bot], 2) });
    await waitFor(async () => (await getGroup(groupId))?.self === 'removed');
    await expect(manager.sendToGroup(groupId, { type: 'text', text: 'still here?' })).rejects.toThrow('no longer a member');
    const events = (await listMessages(groupPeerOf(groupId))).filter(row => row.content.type === 'groupEvent').map(row => (row.content.type === 'groupEvent' ? row.content.text : ''));
    expect(events.at(-1)).toContain('You were removed from the group');
  });

  it('the admin removes a member: v2 reaches the member kept and the member removed', async () => {
    const { alice, bot, toAlice, toBot, manager } = await setUp();
    const groupId = await manager.createGroup('Crew', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    await manager.updateRoster(groupId, [{ account: bot.hex, username: 'bot' }]);
    const toKept = infoOf(await waitFor(() => toBot.of('groupInfo').find(message => infoOf(message)?.version === 2)));
    const toRemoved = infoOf(await waitFor(() => toAlice.of('groupInfo').find(message => infoOf(message)?.version === 2)));
    expect(toKept?.members.map(entry => entry.username)).toEqual(['web', 'bot']);
    expect(toRemoved?.members.some(entry => bytesToHex(entry.account) === alice.hex)).toBe(false);
    // The next message fans out to the new roster only.
    await manager.sendToGroup(groupId, { type: 'text', text: 'just us' });
    await waitFor(() => toBot.of('groupMessage')[0]);
    expect(toAlice.of('groupMessage')).toHaveLength(0);
  });

  it('leave: groupLeave goes to every member; the admin answers a leave with a roster without the leaver', async () => {
    const { web, alice, bot, toAlice, toBot, manager } = await setUp();
    // Our own leave from alice's group.
    const theirs = 'group-leave';
    await toAlice.send({ type: 'groupInfo', info: roster(theirs, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(theirs));
    await manager.leaveGroup(theirs);
    for (const transport of [toAlice, toBot]) {
      const leave = await waitFor(() => transport.of('groupLeave')[0]);
      expect(leave.content).toEqual({ tag: 'groupLeave', value: { groupId: theirs } });
    }
    expect((await getGroup(theirs))?.self).toBe('left');
    // The bot leaves our group: as admin we send v2 without it.
    const ours = await manager.createGroup('Ours', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    await toBot.send({ type: 'groupLeave', groupId: ours });
    const v2 = infoOf(await waitFor(() => toAlice.of('groupInfo').find(message => infoOf(message)?.groupId === ours && infoOf(message)?.version === 2)));
    expect(v2?.members.map(entry => entry.username)).toEqual(['web', 'alice']);
  });

  it('orders by timestamp with the sender seq as tie-break, and notes a seq gap once', async () => {
    const { web, alice, bot, toAlice } = await setUp();
    const groupId = 'group-order';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(groupId));
    await toAlice.send(wrap(groupId, 2, { type: 'text', text: 'second' }), { messageId: 'o-2', timestamp: 5000 });
    await toAlice.send(wrap(groupId, 1, { type: 'text', text: 'first' }), { messageId: 'o-1', timestamp: 5000 });
    await toAlice.send(wrap(groupId, 4, { type: 'text', text: 'after a gap' }), { messageId: 'o-4', timestamp: 6000 });
    await toAlice.send(wrap(groupId, 9, { type: 'text', text: 'another gap' }), { messageId: 'o-9', timestamp: 7000 });
    await waitFor(() => db.messages.get('o-9'));
    const rows = (await listMessages(groupPeerOf(groupId))).sort(compareGroupRows);
    const texts = rows.filter(row => row.direction === 'incoming').map(row => (row.content.type === 'text' ? row.content.text : ''));
    expect(texts).toEqual(['first', 'second', 'after a gap', 'another gap']);
    const gaps = rows.filter(row => row.content.type === 'groupEvent' && row.content.text === 'Some messages may be missing');
    expect(gaps).toHaveLength(1);
  });

  it('a bot member replies to all: its wrapped reply and its wrapped botInfo land in the group and on the bot', async () => {
    const { alice, bot, toAlice, toBot, manager } = await setUp();
    const groupId = await manager.createGroup('Crew', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    await manager.sendToGroup(groupId, { type: 'text', text: 'hello all' });
    const asked = await waitFor(() => toBot.of('groupMessage')[0]);
    const info = { kind: 1, name: 'Guide', description: 'Answers questions', greeting: '', commands: [], version: 1 };
    await toBot.send(wrap(groupId, 1, { type: 'botInfo', info }), { messageId: 'bot-info' });
    await toBot.send(wrap(groupId, 2, { type: 'reply', messageId: asked.messageId, text: 'hello, humans' }), { messageId: 'bot-reply' });
    const reply = await waitFor(() => db.messages.get('bot-reply'));
    expect(reply.peerAccountId).toBe(groupPeerOf(groupId));
    expect(reply.senderAccountId).toBe(bot.hex);
    expect(reply.content).toEqual({ type: 'reply', messageId: asked.messageId, text: 'hello, humans' });
    expect((await db.peerInfo.get(bot.hex))?.botInfo?.name).toBe('Guide');
    // Alice's copy of our message is the same envelope; her reply to it lands in one room.
    await toAlice.send(wrap(groupId, 1, { type: 'reaction', messageId: asked.messageId, emoji: '👍', add: true }));
    await waitFor(async () => ((await db.messages.get(asked.messageId))?.reactions.length ?? 0) > 0);
  });

  it('typing fans out with the current seq and does not advance it; the next message takes the next seq', async () => {
    const { alice, bot, toAlice, manager } = await setUp();
    const groupId = await manager.createGroup('Crew', [
      { account: alice.hex, username: 'alice' },
      { account: bot.hex, username: 'bot' },
    ], { fanOut: true });
    await manager.sendToGroup(groupId, { type: 'text', text: 'one' });
    await manager.sendTyping(groupPeerOf(groupId), 'composing', Date.now() + 4000);
    await manager.sendToGroup(groupId, { type: 'text', text: 'two' });
    const wrapped = await waitFor(() => (toAlice.of('groupMessage').length === 3 ? toAlice.of('groupMessage').map(wrappedOf) : null));
    const seqOf = (tag: string, text?: string) =>
      wrapped.find(entry => entry?.content.tag === tag && (text === undefined || (entry.content.tag === 'text' && entry.content.value === text)))?.seq;
    expect([seqOf('text', 'one'), seqOf('typing'), seqOf('text', 'two')]).toEqual([1n, 1n, 2n]);
  });

  it('only the author deletes or edits a group message', async () => {
    const { web, alice, bot, toAlice, toBot } = await setUp();
    const groupId = 'group-author';
    await toAlice.send({ type: 'groupInfo', info: roster(groupId, alice, [alice, web, bot], 1) });
    await waitFor(() => getGroup(groupId));
    await toAlice.send(wrap(groupId, 1, { type: 'text', text: 'mine' }), { messageId: 'alice-text' });
    await waitFor(() => db.messages.get('alice-text'));
    await toBot.send(wrap(groupId, 1, { type: 'edit', messageId: 'alice-text', text: 'hijacked' }));
    await toBot.send(wrap(groupId, 2, { type: 'deleted', targetMessageId: 'alice-text' }));
    await toBot.send(wrap(groupId, 3, { type: 'text', text: 'marker' }), { messageId: 'bot-marker' });
    await waitFor(() => db.messages.get('bot-marker'));
    expect((await db.messages.get('alice-text'))?.content).toEqual({ type: 'text', text: 'mine' });
    await toAlice.send(wrap(groupId, 2, { type: 'deleted', targetMessageId: 'alice-text' }));
    await waitFor(async () => (await db.messages.get('alice-text'))?.content.type === 'deleted');
  });
});

// ── Spec 0011 through the manager (M16) ────────────────────────────────────

describe('spec 0011 private groups through the manager', () => {
  /**
   * The client (`web`, the manager) with chats to alice and a bot; alice and
   * the bot run `createGroupsV2` on memory storage over the same store, with
   * their DMs to the client on their real sessions.
   */
  const setUpV2 = async () => {
    const { adapter, submittedBy } = makeGroupStore();
    const store = adapter;
    const web = member('web');
    const alice = member('alice');
    const bot = member('bot');
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf([alice, bot, web]), username: 'web' });
    const toAlice = await connect(store, web, alice, manager);
    const toBot = await connect(store, web, bot, manager);
    transports = [toAlice, toBot];
    const serviceOf = (self: Member, transport: Transport) => {
      const got: IncomingGroupMessage[] = [];
      const service = createGroupsV2({
        self: self.hex,
        signer: bytesToHex(self.device.statementAccountPublicKey),
        ownChatPrivateKey: self.identity.identityChatPrivateKey,
        ownChatPublicKey: self.identity.identityChatPublicKey,
        store,
        prover: createSr25519Prover(self.device.statementAccountSeed),
        chatKeyOf: async account => [web, alice, bot].find(m => m.hex === account)?.identity.identityChatPublicKey ?? null,
        postingOf: async account => {
          const found = [web, alice, bot].find(m => m.hex === account);
          return found ? [bytesToHex(found.device.statementAccountPublicKey)] : [];
        },
        nameOf: async account => [web, alice, bot].find(m => m.hex === account)?.name ?? '?',
        isBot: async () => false,
        reachable: account => account === web.hex,
        sendControl: async (_to, control) => void (await transport.send({ type: 'groupControl', control })),
        applyMessage: async (_groupId, _sender, message) => void got.push(message),
        storage: memoryGroupStorage(),
      });
      return { service, got };
    };
    const a = serviceOf(alice, toAlice);
    const b = serviceOf(bot, toBot);
    await a.service.start();
    await b.service.start();
    /** Hands every kind-249 control the client sent this member to its service. */
    const deliver = async (transport: Transport, service: typeof a.service) => {
      const controls = await waitFor(() => (transport.of('groupControl').length > 0 ? transport.of('groupControl') : null));
      for (const message of controls) if (message.content.tag === 'groupControl') await service.onControl(web.hex, message.content.value);
    };
    return { store, submittedBy, web, alice, bot, toAlice, toBot, a, b, deliver };
  };

  it('create sends a welcome (kind 249) over each DM; one group message costs one submission and one message on the meter', async () => {
    const { web, a, b, toAlice, toBot, deliver, submittedBy } = await setUpV2();
    const contacts = await db.contacts.toArray();
    const groupId = await manager!.createGroup(
      'Crew',
      contacts.map(contact => ({ account: contact.accountId, username: contact.username })),
    );
    expect((await getGroup(groupId))?.v).toBe(2);
    await deliver(toAlice, a.service);
    await deliver(toBot, b.service);
    const before = manager!.submissions.snapshot();
    const statementsBefore = submittedBy(bytesToHex(web.device.statementAccountPublicKey));
    await manager!.sendToGroup(groupId, { type: 'text', text: 'hello all' });
    const after = manager!.submissions.snapshot();
    // Settings › Diagnostics: one group message is one submission and one message, not n−1 of each.
    expect(after.submissions - before.submissions).toBe(1);
    expect(after.messages - before.messages).toBe(1);
    expect(submittedBy(bytesToHex(web.device.statementAccountPublicKey)) - statementsBefore).toBe(1);
    await waitFor(() => a.got.some(m => m.content.tag === 'text' && m.content.value === 'hello all'));
    await waitFor(() => b.got.some(m => m.content.tag === 'text' && m.content.value === 'hello all'));
    const own = (await listMessages(groupPeerOf(groupId))).find(row => row.direction === 'outgoing');
    expect(own?.status).toBe('sent');
  });

  it('a reaction rides as one statement; typing is not sent in a v2 group', async () => {
    const { a, toAlice, deliver } = await setUpV2();
    const contacts = await db.contacts.toArray();
    const groupId = await manager!.createGroup(
      'Crew',
      contacts.map(contact => ({ account: contact.accountId, username: contact.username })),
    );
    await deliver(toAlice, a.service);
    await manager!.sendToGroup(groupId, { type: 'text', text: 'react to me' });
    const target = (await listMessages(groupPeerOf(groupId))).find(row => row.direction === 'outgoing')!;
    const before = manager!.submissions.snapshot().submissions;
    await manager!.sendTyping(groupPeerOf(groupId), 'composing', Date.now() + 4000);
    expect(manager!.submissions.snapshot().submissions).toBe(before);
    await manager!.react(groupPeerOf(groupId), target.messageId, '👍', true);
    expect(manager!.submissions.snapshot().submissions - before).toBe(1);
    await waitFor(() => a.got.some(m => m.content.tag === 'reacted' && m.content.value.messageId === target.messageId));
  }, 10_000);

  it('a member’s carrier lands in the room with its sender; the room names the epoch', async () => {
    const { bot, b, toBot, deliver } = await setUpV2();
    const contacts = await db.contacts.toArray();
    const groupId = await manager!.createGroup(
      'Crew',
      contacts.map(contact => ({ account: contact.accountId, username: contact.username })),
    );
    await deliver(toBot, b.service);
    await b.service.send(groupId, { tag: 'text', value: 'hello, humans' }, { messageId: 'bot-v2-reply', timestamp: Date.now() });
    const row = await waitFor(() => db.messages.get('bot-v2-reply'));
    expect(row.peerAccountId).toBe(groupPeerOf(groupId));
    expect(row.senderAccountId).toBe(bot.hex);
    expect((await getGroup(groupId))?.epoch).toBe(1);
  });
});
