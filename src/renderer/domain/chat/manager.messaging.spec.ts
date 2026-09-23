/**
 * Messaging through the manager (the web side) against a hand-driven peer
 * that runs the same SDK sessions over one in-memory store.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import { writeSetting } from '../../app/settings';
import type { ConnectionStatus } from '../../app/statementStore';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { createIdentityChannel } from './identityChannel';
import type { ChatContent, IdentityChannelEvent } from './identityEvents';
import { listMessages } from './messages';
import { type ChatManager, createChatManager } from './manager';
import { createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, createPeerSession } from './peerSession';

const lookupOf = (peer: TestPeer): IdentityLookup => ({
  getPeerIdentity: async accountId =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId)
      ? { accountId, username: 'bot', chatPublicKey: peer.identity.identityChatPublicKey }
      : null,
});

type Store = ReturnType<typeof createInMemoryStatementStore>;

/** The peer's transport, as a bot runs it: identity channel + device session towards the web device. */
const openPeerTransport = (store: Store, self: TestPeer, web: TestPeer) => {
  const events: IdentityChannelEvent[] = [];
  const received: IncomingChatMessage[] = [];
  const delivered: string[] = [];
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
    onDelivered: id => delivered.push(id),
    onBatchDelivered: () => undefined,
  });
  let counter = 0;
  return {
    events,
    received,
    delivered,
    channel,
    roster,
    send: (content: ChatContent, timestamp = Date.now()) => session.send(content, { messageId: `peer-${++counter}`, timestamp }),
    dispose: () => {
      channel.dispose();
      session.dispose();
    },
  };
};

/** Peer sends a request, the web accepts, the peer learns the web device. */
const establish = async (store: Store, web: TestPeer, peer: TestPeer, manager: ChatManager, transport: ReturnType<typeof openPeerTransport>) => {
  const { requestId } = await sendChatRequest({
    recipientAccountId: web.identity.identityAccountId,
    recipientChatPublicKey: web.identity.identityChatPublicKey,
    senderIdentityAccountId: peer.identity.identityAccountId,
    senderIdentityChatPrivateKey: peer.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: peer.device.encryptionPublicKey,
    senderDeviceSeed: peer.device.statementAccountSeed,
    welcomeMessage: 'hi from the bot',
    statementStore: store,
    allocator: createExpiryAllocator(),
  });
  await waitFor(() => db.requests.get(requestId));
  await manager.acceptRequest(requestId);
  const accepted = await waitFor(() => transport.events.find(event => event.tag === 'accepted'));
  if (accepted.tag === 'accepted') transport.roster.set([accepted.device]);
  return { requestId, peerKey: bytesToHex(peer.identity.identityAccountId) as HexString };
};

let manager: ChatManager | null = null;
let transport: ReturnType<typeof openPeerTransport> | null = null;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  transport?.dispose();
  manager?.dispose();
  transport = null;
  manager = null;
});

describe('chat manager: messaging', () => {
  it('accept creates the room with the system row and the welcome message, read', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { requestId, peerKey } = await establish(store, web, bot, manager, transport);

    const rows = await listMessages(peerKey);
    expect(rows.map(r => [r.direction, r.content])).toEqual([
      ['incoming', { type: 'text', text: 'hi from the bot' }],
      ['system', { type: 'contactAdded' }],
    ]);
    expect(rows[0]?.messageId).toBe(requestId);
    expect((await db.rooms.get(peerKey))?.unreadCount).toBe(0);
  });

  it('sends text to the peer and moves the row sending → sent → delivered on the ack', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    await manager.sendMessage(peerKey, { type: 'text', text: 'hello bot' });
    const outgoing = (await listMessages(peerKey)).find(r => r.direction === 'outgoing');
    expect(outgoing?.status).toBe('sent');

    await waitFor(() => transport!.received.find(m => m.content.tag === 'text' && m.content.value === 'hello bot'));
    await waitFor(async () => (await db.messages.get(outgoing!.messageId))?.status === 'delivered');
    expect((await db.rooms.get(peerKey))?.lastPreview).toBe('hello bot');
  });

  it('applies the peer’s text, reaction, edit and reply, and counts unread', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await manager.sendMessage(peerKey, { type: 'text', text: 'mine' });
    const mine = (await listMessages(peerKey)).find(r => r.direction === 'outgoing')!;

    await transport.send({ tag: 'text', value: 'theirs' }, 100);
    await transport.send({ tag: 'reacted', value: { messageId: mine.messageId, emoji: '🔥' } }, 101);
    await transport.send({ tag: 'edit', value: { messageId: 'peer-1', newContent: { text: 'theirs (fixed)', attachments: undefined } } }, 102);
    await transport.send({ tag: 'reply', value: { messageId: mine.messageId, ownContent: { text: 'answer', attachments: undefined } } }, 103);

    await waitFor(async () => (await listMessages(peerKey)).some(r => r.content.type === 'reply'));
    const theirs = await db.messages.get('peer-1');
    expect(theirs).toMatchObject({ direction: 'incoming', content: { type: 'text', text: 'theirs (fixed)' }, editedAt: 102 });
    expect((await db.messages.get(mine.messageId))?.reactions).toEqual([{ emoji: '🔥', by: 'peer' }]);
    // The welcome message was read on accept; the two new visible rows are not.
    expect((await db.rooms.get(peerKey))?.unreadCount).toBe(2);
    await manager.markRead(peerKey);
    expect((await db.rooms.get(peerKey))?.unreadCount).toBe(0);

    // Our own reaction and edit go out and are applied locally.
    await manager.react(peerKey, 'peer-1', '👍', true);
    await manager.edit(peerKey, mine.messageId, 'mine (edited)');
    expect((await db.messages.get('peer-1'))?.reactions).toEqual([{ emoji: '👍', by: 'me' }]);
    expect((await db.messages.get(mine.messageId))?.content).toEqual({ type: 'text', text: 'mine (edited)' });
    await waitFor(() => transport!.received.some(m => m.content.tag === 'edit'));
    expect(transport.received.map(m => m.content.tag)).toEqual(expect.arrayContaining(['reacted', 'edit']));
  });

  it('declines a call offer with dataChannelClosed and keeps a system row', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    await transport.send({ tag: 'dataChannelOffer', value: { sdp: new Uint8Array([1]), purpose: 'VIDEO_CALL' } });
    const closed = await waitFor(() => transport!.received.find(m => m.content.tag === 'dataChannelClosed'));
    expect(closed.content.tag === 'dataChannelClosed' && closed.content.value.offerMessageId).toBe('peer-1');
    expect((await listMessages(peerKey)).some(r => r.content.type === 'callDeclined')).toBe(true);
  });

  it('shows a bot welcome text that rides the identity session', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    await transport.channel.post({ tag: 'text', value: 'welcome from identity session' });
    await waitFor(async () => (await listMessages(peerKey)).some(r => r.content.type === 'text' && r.content.text === 'welcome from identity session'));
  });

  it('rebuilds transport after a connection drop and keeps receiving', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    let listener: ((status: ConnectionStatus) => void) | null = null;
    manager = await createChatManager({
      identity: web.identity,
      deviceKeys: web.device,
      statementStore: store,
      lookup: lookupOf(bot),
      onConnectionStatus: next => {
        listener = next;
        return () => undefined;
      },
    });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    listener!('disconnected');
    listener!('connected');
    await new Promise(resolve => setTimeout(resolve, 10));

    await transport.send({ tag: 'text', value: 'after reconnect' });
    await waitFor(async () => (await listMessages(peerKey)).some(r => r.content.type === 'text' && r.content.text === 'after reconnect'));
    await manager.sendMessage(peerKey, { type: 'text', text: 'still works' });
    await waitFor(() => transport!.received.some(m => m.content.tag === 'text' && m.content.value === 'still works'));
  });

  it('marks a message failed when there is no session for the peer', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    await expect(manager.sendMessage('0xdead', { type: 'text', text: 'x' })).rejects.toThrow('no chat session');
    expect((await db.messages.toArray()).map(r => r.status)).toEqual(['failed']);
  });

  // Retry must re-queue the same message id: the peer dedups by it, and the
  // user's reactions and replies already point at it (M6 step 9).
  it('sends a failed message again with the same id', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await db.messages.add({
      messageId: 'failed-1',
      peerAccountId: peerKey,
      timestamp: Date.now(),
      direction: 'outgoing',
      status: 'failed',
      content: { type: 'text', text: 'try again' },
      reactions: [],
      editedAt: null,
    });

    await manager.retry(peerKey, 'failed-1');
    expect((await db.messages.get('failed-1'))?.status).toBe('sent');
    const arrived = await waitFor(() => transport!.received.find(m => m.messageId === 'failed-1'));
    expect(arrived.content).toEqual({ tag: 'text', value: 'try again' });
  });

  it('keeps a retried message failed when it still cannot go out', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    await expect(manager.sendMessage('0xdead', { type: 'text', text: 'x' })).rejects.toThrow('no chat session');
    const [row] = await db.messages.toArray();
    await expect(manager.retry('0xdead', row!.messageId)).rejects.toThrow('no chat session');
    expect((await db.messages.get(row!.messageId))?.status).toBe('failed');
  });

  // RFC-0003 over the real sessions and codec: kind 20 goes out and comes in.
  it('delete for everyone: tombstones our row at once and sends deleted(messageId) to the peer', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await manager.sendMessage(peerKey, { type: 'text', text: 'oops, wrong chat' });
    const mine = (await listMessages(peerKey)).find(r => r.direction === 'outgoing')!;

    await manager.deleteForEveryone(peerKey, mine.messageId);
    expect((await db.messages.get(mine.messageId))?.content).toEqual({ type: 'deleted' });
    const deletion = await waitFor(() => transport!.received.find(m => m.content.tag === 'deleted'));
    expect(deletion.content).toEqual({ tag: 'deleted', value: { targetMessageId: mine.messageId } });
    // The deletion is its own message with a fresh id, never a row of its own.
    expect(deletion.messageId).not.toBe(mine.messageId);
    expect((await listMessages(peerKey)).filter(r => r.direction === 'outgoing')).toHaveLength(1);
  });

  it('delete for everyone of a message that never went out removes it and sends nothing', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await db.messages.add({
      messageId: 'never-sent',
      peerAccountId: peerKey,
      timestamp: Date.now(),
      direction: 'outgoing',
      status: 'failed',
      content: { type: 'text', text: 'draft that failed' },
      reactions: [],
      editedAt: null,
    });

    await manager.deleteForEveryone(peerKey, 'never-sent');
    expect(await db.messages.get('never-sent')).toBeUndefined();
    // A later message still goes out, and no deletion went before it.
    await manager.sendMessage(peerKey, { type: 'text', text: 'after' });
    await waitFor(() => transport!.received.find(m => m.content.tag === 'text' && m.content.value === 'after'));
    expect(transport.received.some(m => m.content.tag === 'deleted')).toBe(false);
  });

  it('refuses to delete the peer’s message for everyone', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey, requestId } = await establish(store, web, bot, manager, transport);
    await expect(manager.deleteForEveryone(peerKey, requestId)).rejects.toThrow('Only your own message');
    expect((await db.messages.get(requestId))?.content).toEqual({ type: 'text', text: 'hi from the bot' });
  });

  it('applies the peer’s deletion: known target, target after its deletion, and never our own message', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await manager.sendMessage(peerKey, { type: 'text', text: 'mine stays' });
    const mine = (await listMessages(peerKey)).find(r => r.direction === 'outgoing')!;

    await transport.send({ tag: 'text', value: 'regret' }, 100); // peer-1
    await transport.send({ tag: 'deleted', value: { targetMessageId: 'peer-1' } }, 101); // peer-2
    await transport.send({ tag: 'deleted', value: { targetMessageId: 'peer-4' } }, 102); // peer-3, before its target
    await transport.send({ tag: 'text', value: 'never shown' }, 103); // peer-4
    await transport.send({ tag: 'deleted', value: { targetMessageId: mine.messageId } }, 104); // peer-5, not theirs
    await transport.send({ tag: 'text', value: 'done' }, 105); // peer-6

    await waitFor(async () => (await db.messages.get('peer-6')) !== undefined);
    expect((await db.messages.get('peer-1'))?.content).toEqual({ type: 'deleted' });
    expect((await db.messages.get('peer-4'))?.content).toEqual({ type: 'deleted' });
    expect((await db.messages.get(mine.messageId))?.content).toEqual({ type: 'text', text: 'mine stays' });
    // Deletions are never rows.
    expect(await db.messages.get('peer-2')).toBeUndefined();
    expect(await db.messages.get('peer-3')).toBeUndefined();
    expect(await db.messages.get('peer-5')).toBeUndefined();
    const texts = (await listMessages(peerKey)).flatMap(r => (r.content.type === 'text' ? [r.content.text] : []));
    expect(texts).not.toContain('regret');
    expect(texts).not.toContain('never shown');
  });

  // Spec 0006 round trip, against a peer that speaks the extension (a pca bot).
  const keyboard: ChatContent = {
    tag: 'buttons',
    value: {
      text: 'Pick one',
      rows: [
        [
          { label: 'Echo', action: { tag: 'command', value: 'echo hi' } },
          { label: 'Colour', action: { tag: 'callback', value: new Uint8Array([1, 2]) } },
        ],
        [
          { label: 'Docs', action: { tag: 'url', value: 'https://polkadot.com' } },
          { label: 'Stake', action: { tag: 'tx', value: new Uint8Array([9]) } },
        ],
      ],
      oneShot: false,
    },
  };

  it('buttons: a command press is our own text bubble; a callback press is a buttonPress with the payload and no bubble', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await transport.send(keyboard); // peer-1, newest in the room
    const row = await waitFor(() => db.messages.get('peer-1'));
    expect(row.content.type).toBe('buttons');
    expect((await db.rooms.get(peerKey))?.lastPreview).toBe('Pick one');

    await manager.pressButton(peerKey, 'peer-1', 0, 0);
    await waitFor(() => transport!.received.find(m => m.content.tag === 'text' && m.content.value === 'echo hi'));
    expect((await listMessages(peerKey)).some(r => r.direction === 'outgoing' && r.content.type === 'text' && r.content.text === 'echo hi')).toBe(true);

    const before = (await listMessages(peerKey)).length;
    await manager.pressButton(peerKey, 'peer-1', 0, 1);
    const press = await waitFor(() => transport!.received.find(m => m.content.tag === 'buttonPress'));
    expect(press.content).toEqual({ tag: 'buttonPress', value: { messageId: 'peer-1', row: 0, index: 1, payload: new Uint8Array([1, 2]) } });
    expect(await listMessages(peerKey)).toHaveLength(before);
    // The keyboard stays (not oneShot) and remembers its first press.
    expect((await db.messages.get('peer-1'))?.content).toMatchObject({ type: 'buttons', pressed: { row: 0, index: 0 } });
  });

  it('buttons: a tx action is never run, and a oneShot keyboard takes one press only', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await transport.send(keyboard, 100); // peer-1
    await transport.send({ tag: 'buttons', value: { ...(keyboard.value as object), oneShot: true } } as ChatContent, 101); // peer-2
    await waitFor(() => db.messages.get('peer-2'));

    await expect(manager.pressButton(peerKey, 'peer-1', 1, 1)).rejects.toThrow('cannot run');
    await manager.pressButton(peerKey, 'peer-2', 0, 1);
    await expect(manager.pressButton(peerKey, 'peer-2', 0, 1)).rejects.toThrow('already used');
    await waitFor(() => transport!.received.find(m => m.content.tag === 'buttonPress'));
    expect(transport.received.filter(m => m.content.tag === 'buttonPress')).toHaveLength(1);
  });

  it('buttonPress: accepted only for a keyboard we sent to that peer; shown as a system row that does not count unread', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await manager.sendButtons(peerKey, keyboard.value as { text: string; rows: never[]; oneShot: boolean });
    const mine = (await listMessages(peerKey)).find(r => r.direction === 'outgoing' && r.content.type === 'buttons')!;
    await waitFor(() => transport!.received.find(m => m.content.tag === 'buttons'));
    await transport.send({ tag: 'text', value: 'their text' }, 100); // peer-1
    await waitFor(() => db.messages.get('peer-1'));
    const unread = (await db.rooms.get(peerKey))?.unreadCount;

    const pressOf = (messageId: string, row: number, index: number): ChatContent => ({ tag: 'buttonPress', value: { messageId, row, index, payload: new Uint8Array() } });
    await transport.send(pressOf('peer-1', 0, 0), 101); // peer-2: their own message, not ours
    await transport.send(pressOf('unknown', 0, 0), 102); // peer-3
    await transport.send(pressOf(mine.messageId, 5, 0), 103); // peer-4: no such button
    await transport.send(pressOf(mine.messageId, 0, 1), 104); // peer-5: valid
    await waitFor(() => db.messages.get('press:peer-5'));
    const rows = await listMessages(peerKey);
    expect(rows.filter(r => r.content.type === 'buttonPressed').map(r => [r.direction, r.content])).toEqual([['system', { type: 'buttonPressed', label: 'Colour' }]]);
    expect((await db.rooms.get(peerKey))?.unreadCount).toBe(unread);
  });
});

/*
 * Spec 0005 through the manager, two clients on one store. Why: typing and
 * seen are ephemeral, so the harm of a mistake is a phantom bubble, an unread
 * count or a notification for a hint; and seen must only ever mark our own
 * messages to the peer that sent it.
 */
describe('chat manager: typing and seen (spec 0005)', () => {
  const setup = async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    return { manager, transport, peerKey };
  };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  it('shows the peer typing without a row, unread or preview, and a real message clears it', async () => {
    const { manager, transport, peerKey } = await setup();
    const rowsBefore = (await listMessages(peerKey)).length;
    const roomBefore = await db.rooms.get(peerKey);

    await transport.send({ tag: 'typing', value: { until: BigInt(Date.now() + 6_000), kind: 1 } });
    await waitFor(() => manager.typing.snapshot().get(peerKey)?.kind === 'working');
    expect((await listMessages(peerKey)).length).toBe(rowsBefore);
    const room = await db.rooms.get(peerKey);
    expect(room?.unreadCount).toBe(roomBefore?.unreadCount);
    expect(room?.lastPreview).toBe(roomBefore?.lastPreview);

    await transport.send({ tag: 'text', value: 'the answer' });
    await waitFor(async () => (await listMessages(peerKey)).some(r => r.content.type === 'text' && r.content.text === 'the answer'));
    expect(manager.typing.snapshot().has(peerKey)).toBe(false);
  });

  it('ignores a stale typing from the peer', async () => {
    const { manager, transport, peerKey } = await setup();
    await transport.send({ tag: 'typing', value: { until: BigInt(Date.now() - 1), kind: 0 } });
    await transport.send({ tag: 'text', value: 'marker' });
    await waitFor(async () => (await listMessages(peerKey)).some(r => r.content.type === 'text' && r.content.text === 'marker'));
    expect(manager.typing.snapshot().has(peerKey)).toBe(false);
  });

  it('marks our messages up to the peer’s seen as seen, without a row', async () => {
    const { manager, transport, peerKey } = await setup();
    await manager.sendMessage(peerKey, { type: 'text', text: 'first' });
    await sleep(2);
    await manager.sendMessage(peerKey, { type: 'text', text: 'second' });
    const [first, second] = (await listMessages(peerKey)).filter(r => r.direction === 'outgoing');
    const rowsBefore = (await listMessages(peerKey)).length;

    await transport.send({ tag: 'seen', value: { upTo: first!.messageId, at: 777n } });
    await waitFor(async () => (await db.messages.get(first!.messageId))?.seenAt === 777);
    expect((await db.messages.get(second!.messageId))?.seenAt).toBeUndefined();
    expect((await listMessages(peerKey)).length).toBe(rowsBefore);

    // A receipt that names the peer's own message marks nothing.
    await transport.send({ tag: 'seen', value: { upTo: 'peer-1', at: 888n } });
    await transport.send({ tag: 'seen', value: { upTo: second!.messageId, at: 999n } });
    await waitFor(async () => (await db.messages.get(second!.messageId))?.seenAt === 999);
    expect((await db.messages.get(first!.messageId))?.seenAt).toBe(777);
  });

  it('sends seen for the newest peer message when the room is read, only with read receipts on', async () => {
    const { manager, transport, peerKey } = await setup();
    await transport.send({ tag: 'text', value: 'one' });
    await waitFor(() => db.messages.get('peer-1'));

    await writeSetting('chat.readReceipts', 'off');
    await manager.markRead(peerKey);
    await sleep(100);
    expect(transport.received.some(m => m.content.tag === 'seen')).toBe(false);

    await writeSetting('chat.readReceipts', 'on');
    await manager.markRead(peerKey);
    const seen = await waitFor(() => transport!.received.find(m => m.content.tag === 'seen'));
    expect(seen.content.tag === 'seen' && seen.content.value.upTo).toBe('peer-1');
  });

  it('sends typing{composing} while composing, and nothing then for the real message', async () => {
    const { manager, transport, peerKey } = await setup();
    manager.composing(peerKey, 'h');
    const typing = await waitFor(() => transport!.received.find(m => m.content.tag === 'typing'));
    expect(typing.content.tag === 'typing' && typing.content.value.kind).toBe(0);
    const until = typing.content.tag === 'typing' ? Number(typing.content.value.until) : 0;
    expect(until - Date.now()).toBeGreaterThan(4_000);
    expect(until - Date.now()).toBeLessThanOrEqual(6_000);

    await manager.sendMessage(peerKey, { type: 'text', text: 'hello' });
    await waitFor(() => transport!.received.some(m => m.content.tag === 'text' && m.content.value === 'hello'));
    expect(transport.received.filter(m => m.content.tag === 'typing')).toHaveLength(1);
  });

  it('sends no typing when the typing indicator is off', async () => {
    const { manager, transport, peerKey } = await setup();
    await writeSetting('chat.typingIndicator', 'off');
    manager.composing(peerKey, 'h');
    await manager.sendMessage(peerKey, { type: 'text', text: 'marker' });
    await waitFor(() => transport!.received.some(m => m.content.tag === 'text' && m.content.value === 'marker'));
    await sleep(50);
    expect(transport.received.some(m => m.content.tag === 'typing')).toBe(false);
  });
});

describe('chat manager: spec 0008 botInfo and the automatic /start (M10)', () => {
  const guideInfo = {
    kind: 1,
    name: 'Guide',
    description: 'Polkadot support guide',
    greeting: 'Hi! Ask me about Polkadot.',
    commands: [{ name: 'staking', description: 'Staking basics' }],
    version: 1,
  };

  it('stores a botInfo from the identity channel with its greeting row, never a bubble, and sends no /start', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    // As pca does: botInfo on the identity channel right after the accept.
    await transport.channel.post({ tag: 'botInfo', value: guideInfo });
    const info = await waitFor(async () => (await db.peerInfo.get(peerKey))?.botInfo ?? undefined);
    expect(info).toEqual(guideInfo);
    const rows = await listMessages(peerKey);
    expect(rows.filter(row => row.content.type === 'botGreeting')).toHaveLength(1);
    expect(rows.some(row => row.direction === 'incoming' && row.content.type !== 'text')).toBe(false);

    await manager.roomOpened(peerKey);
    expect((await listMessages(peerKey)).some(row => row.direction === 'outgoing')).toBe(false);
  });

  // An older bot answers the request on the identity channel but sends no
  // botInfo: it gets exactly one `/start`, however often the room opens.
  it('sends /start once to a peer that acts like a bot and has not described itself', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    // Before any bot sign: a person, no /start.
    await manager.roomOpened(peerKey);
    expect((await listMessages(peerKey)).some(row => row.direction === 'outgoing')).toBe(false);

    await transport.channel.post({ tag: 'text', value: 'Welcome! I am a bot.' });
    await waitFor(async () => (await db.peerInfo.get(peerKey))?.botSignalAt ?? undefined);
    await Promise.all([manager.roomOpened(peerKey), manager.roomOpened(peerKey)]);
    await manager.roomOpened(peerKey);
    const sent = (await listMessages(peerKey)).filter(row => row.direction === 'outgoing');
    expect(sent.map(row => (row.content.type === 'text' ? row.content.text : row.content.type))).toEqual(['/start']);
    await waitFor(() => transport?.received.find(message => message.content.tag === 'text' && message.content.value === '/start'));
  });

  it('sendBotInfo puts this client’s botInfo on the identity channel (the test-script operator flag)', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await manager.sendBotInfo(peerKey, guideInfo);
    const event = await waitFor(() => transport?.events.find(entry => entry.tag === 'message' && entry.content.tag === 'botInfo'));
    expect(event.tag === 'message' ? event.content : null).toEqual({ tag: 'botInfo', value: guideInfo });
  });
});
