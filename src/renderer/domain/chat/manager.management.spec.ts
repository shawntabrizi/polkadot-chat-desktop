/**
 * M12e chat management through the manager, against a hand-driven peer on
 * the same in-memory store (the helpers are those of manager.messaging.spec.ts):
 * - Withdraw: the request row goes and nothing more is submitted for it, so
 *   a late accept no longer turns into a chat (the owner's case: a request
 *   to a bot that will never accept, which he could not remove).
 * - Block: the peer's messages are dropped before a row or a notification
 *   exists, and a new request from them is not stored.
 * - Forward: the peer gets plain text only; the caption is local.
 * - Delete: the room goes; the contact and its session stay, so the peer's
 *   next message brings the chat back.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { createIdentityChannel } from './identityChannel';
import type { ChatContent, IdentityChannelEvent } from './identityEvents';
import { blockPeer, unblockPeer } from './chatActions';
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

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

describe('chat management: withdraw a pending request', () => {
  it('removes the row, submits nothing more, and a late accept no longer makes a chat', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    await manager.sendRequest({ accountId: bot.identity.identityAccountId, username: 'bot', chatPublicKey: bot.identity.identityChatPublicKey }, 'hello?');
    const request = (await db.requests.toArray())[0]!;
    const peerKey = request.peerAccountId;

    await manager.withdrawRequest(peerKey);
    expect(await db.requests.count()).toBe(0);
    await settle();
    const ownBefore = store.acceptedStatements().length;

    // The bot accepts after all: this device no longer listens for it.
    const botChannel = createIdentityChannel({
      ownIdentityAccountId: bot.identity.identityAccountId,
      ownIdentityChatPrivateKey: bot.identity.identityChatPrivateKey,
      peerIdentityAccountId: web.identity.identityAccountId,
      peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
      prover: createSr25519Prover(bot.device.statementAccountSeed),
      allocator: createExpiryAllocator(),
      statementStore: store,
      onEvent: () => undefined,
    });
    await botChannel.post({
      tag: 'deviceChatAccepted',
      value: { requestId: request.requestId, device: { statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey } },
    });
    await settle();
    expect(await db.contacts.count()).toBe(0);
    expect(await db.rooms.get(peerKey)).toBeUndefined();
    // Only the bot's own statement was added: no acknowledgement or resubmission from this device.
    expect(store.acceptedStatements().length).toBe(ownBefore + 1);
    botChannel.dispose();

    // After a restart nothing listens either: the row that would re-open the channel is gone.
    manager.dispose();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    await settle();
    expect(await db.contacts.count()).toBe(0);
  });
});

describe('chat management: block', () => {
  it("drops a blocked peer's messages before any row, and takes them again after unblock", async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    const before = (await listMessages(peerKey)).length;

    await blockPeer({ accountId: peerKey, username: 'bot' });
    await transport.send({ tag: 'text', value: 'spam' }, 100);
    await settle();
    await settle();
    expect(await listMessages(peerKey)).toHaveLength(before);
    expect((await db.rooms.get(peerKey))?.unreadCount).toBe(0);

    await unblockPeer(peerKey);
    await transport.send({ tag: 'text', value: 'hello again' }, 200);
    await waitFor(async () => (await listMessages(peerKey)).some(row => row.content.type === 'text' && row.content.text === 'hello again'));
  });

  it("does not store a new request from a blocked sender", async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const stranger = makePeer();
    await blockPeer({ accountId: bytesToHex(stranger.identity.identityAccountId) as HexString, username: 'stranger' });
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(stranger) });
    await sendChatRequest({
      recipientAccountId: web.identity.identityAccountId,
      recipientChatPublicKey: web.identity.identityChatPublicKey,
      senderIdentityAccountId: stranger.identity.identityAccountId,
      senderIdentityChatPrivateKey: stranger.identity.identityChatPrivateKey,
      senderDeviceEncryptionPublicKey: stranger.device.encryptionPublicKey,
      senderDeviceSeed: stranger.device.statementAccountSeed,
      welcomeMessage: 'buy now',
      statementStore: store,
      allocator: createExpiryAllocator(),
    });
    await settle();
    await settle();
    expect(await db.requests.count()).toBe(0);
  });
});

describe('chat management: forward and delete', () => {
  it('forwards as plain text on the wire, with the caption only on this device', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);

    await manager.sendMessage(peerKey, { type: 'text', text: 'the plan' }, { forwardedFrom: 'alice' });
    const row = (await listMessages(peerKey)).find(r => r.direction === 'outgoing');
    expect(row).toMatchObject({ content: { type: 'text', text: 'the plan' }, forwardedFrom: 'alice' });
    const received = await waitFor(() => transport!.received.find(m => m.content.tag === 'text' && m.content.value === 'the plan'));
    // No prefix, no extra field: the base text kind, as any other message.
    expect(received.content).toEqual({ tag: 'text', value: 'the plan' });
  });

  it("deletes the room but keeps the contact, so the peer's next message brings the chat back", async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    transport = openPeerTransport(store, bot, web);
    const { peerKey } = await establish(store, web, bot, manager, transport);
    await db.drafts.put({ peerId: peerKey, text: 'unsent', updatedAt: 1 });

    await manager.deleteChat(peerKey, Date.now());
    expect(await db.rooms.get(peerKey)).toBeUndefined();
    expect(await listMessages(peerKey)).toEqual([]);
    expect(await db.drafts.get(peerKey)).toBeUndefined();
    expect(await db.contacts.get(peerKey)).toBeDefined();

    await transport.send({ tag: 'text', value: 'still there?' }, Date.now() + 1000);
    const room = await waitFor(() => db.rooms.get(peerKey));
    expect(room.unreadCount).toBe(1);
  });
});
