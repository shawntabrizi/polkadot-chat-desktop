/**
 * Messaging through the manager (the web side) against a hand-driven peer
 * that runs the same SDK sessions over one in-memory store.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
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
});
