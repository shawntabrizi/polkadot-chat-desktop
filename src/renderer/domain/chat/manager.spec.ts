/**
 * The manager is the web side; the peer is driven by hand over the same
 * in-memory store, the way a phone or a bot would.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { IdentityLookup } from '../identity/lookup';
import { decodeChatRequest, sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { createIdentityChannel } from './identityChannel';
import type { IdentityChannelEvent } from './identityEvents';
import { type ChatManager, createChatManager } from './manager';

const lookupOf = (...peers: TestPeer[]): IdentityLookup => ({
  getPeerIdentity: async accountId => {
    const peer = peers.find(candidate => bytesToHex(candidate.identity.identityAccountId) === bytesToHex(accountId));
    return peer ? { accountId, username: `user-${accountId[0]}`, chatPublicKey: peer.identity.identityChatPublicKey } : null;
  },
});

const peerChannel = (store: ReturnType<typeof createInMemoryStatementStore>, self: TestPeer, web: TestPeer, events: IdentityChannelEvent[]) =>
  createIdentityChannel({
    ownIdentityAccountId: self.identity.identityAccountId,
    ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onEvent: event => events.push(event),
  });

let manager: ChatManager | null = null;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  manager?.dispose();
  manager = null;
});

describe('chat manager: incoming request', () => {
  it('records a verified request and answers accept with deviceChatAccepted carrying this device', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const phone = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(phone) });

    const { requestId } = await sendChatRequest({
      recipientAccountId: web.identity.identityAccountId,
      recipientChatPublicKey: web.identity.identityChatPublicKey,
      senderIdentityAccountId: phone.identity.identityAccountId,
      senderIdentityChatPrivateKey: phone.identity.identityChatPrivateKey,
      senderDeviceEncryptionPublicKey: phone.device.encryptionPublicKey,
      senderDeviceSeed: phone.device.statementAccountSeed,
      welcomeMessage: 'hi web',
      statementStore: store,
      allocator: createExpiryAllocator(),
    });

    const request = await waitFor(async () => db.requests.get(requestId).then(row => row ?? null)) ;
    expect(request).toMatchObject({ direction: 'incoming', status: 'pending', welcomeMessage: 'hi web', peerUsername: `user-${phone.identity.identityAccountId[0]}` });
    expect(request.senderDevice?.encryptionPublicKey).toEqual(phone.device.encryptionPublicKey);
    expect(await db.contacts.count()).toBe(0);

    const phoneEvents: IdentityChannelEvent[] = [];
    const channel = peerChannel(store, phone, web, phoneEvents);
    await manager.acceptRequest(requestId);

    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    const contact = await db.contacts.get(bytesToHex(phone.identity.identityAccountId));
    expect(contact?.devices).toEqual([{ statementAccountId: phone.device.statementAccountPublicKey, encryptionPublicKey: phone.device.encryptionPublicKey }]);

    const accepted = await waitFor(() => phoneEvents.find(event => event.tag === 'accepted'));
    expect(accepted.tag === 'accepted' && accepted.requestId).toBe(requestId);
    expect(accepted.tag === 'accepted' && accepted.device).toEqual({
      statementAccountId: web.device.statementAccountPublicKey,
      encryptionPublicKey: web.device.encryptionPublicKey,
    });
    channel.dispose();
  });

  it('drops a request whose sender is unknown on chain or whose proof is wrong', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const stranger = makePeer();
    const impostor = makePeer();
    // The lookup knows `impostor` under its account, but `stranger` signs with
    // its own identity key and claims impostor's account: the proof fails.
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(impostor) });

    const base = {
      recipientAccountId: web.identity.identityAccountId,
      recipientChatPublicKey: web.identity.identityChatPublicKey,
      senderDeviceEncryptionPublicKey: stranger.device.encryptionPublicKey,
      senderDeviceSeed: stranger.device.statementAccountSeed,
      welcomeMessage: null,
      statementStore: store,
      allocator: createExpiryAllocator(),
    };
    await sendChatRequest({ ...base, senderIdentityAccountId: stranger.identity.identityAccountId, senderIdentityChatPrivateKey: stranger.identity.identityChatPrivateKey });
    await sendChatRequest({ ...base, senderIdentityAccountId: impostor.identity.identityAccountId, senderIdentityChatPrivateKey: stranger.identity.identityChatPrivateKey });

    await waitFor(() => store.acceptedStatements().length === 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await db.requests.count()).toBe(0);
  });

  it('declines locally without touching contacts', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const phone = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(phone) });
    const { requestId } = await sendChatRequest({
      recipientAccountId: web.identity.identityAccountId,
      recipientChatPublicKey: web.identity.identityChatPublicKey,
      senderIdentityAccountId: phone.identity.identityAccountId,
      senderIdentityChatPrivateKey: phone.identity.identityChatPrivateKey,
      senderDeviceEncryptionPublicKey: phone.device.encryptionPublicKey,
      senderDeviceSeed: phone.device.statementAccountSeed,
      welcomeMessage: null,
      statementStore: store,
      allocator: createExpiryAllocator(),
    });
    await waitFor(async () => db.requests.get(requestId).then(row => row ?? null));
    await manager.declineRequest(requestId);
    expect((await db.requests.get(requestId))?.status).toBe('declined');
    expect(await db.contacts.count()).toBe(0);
  });
});

describe('chat manager: outgoing request', () => {
  it('sends a request the peer can decode and turns the peer accept into a contact with its device', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });

    await manager.sendRequest({ accountId: bot.identity.identityAccountId, username: 'bot', chatPublicKey: bot.identity.identityChatPublicKey }, 'hello bot');

    const outgoing = (await db.requests.toArray())[0];
    expect(outgoing).toMatchObject({ direction: 'outgoing', status: 'pending', peerUsername: 'bot', welcomeMessage: 'hello bot' });

    const data = store.acceptedStatements().at(-1)?.data;
    const decoded = decodeChatRequest(data!, bot.identity.identityAccountId, bot.identity.identityChatPrivateKey);
    expect(decoded?.requestId).toBe(outgoing?.requestId);
    expect(decoded?.senderDevice?.statementAccountId).toEqual(web.device.statementAccountPublicKey);

    const botChannel = peerChannel(store, bot, web, []);
    await botChannel.post({
      tag: 'deviceChatAccepted',
      value: {
        requestId: decoded!.requestId,
        device: { statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey },
      },
    });

    const contact = await waitFor(async () => db.contacts.get(bytesToHex(bot.identity.identityAccountId)).then(row => row ?? null));
    expect(contact.username).toBe('bot');
    expect(contact.devices).toEqual([{ statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey }]);
    expect((await db.requests.get(decoded!.requestId))?.status).toBe('accepted');
    botChannel.dispose();
  });

  it('re-opens the identity channel for a pending outgoing request after a reload', async () => {
    const store = createInMemoryStatementStore();
    const web = makePeer();
    const bot = makePeer();
    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    await manager.sendRequest({ accountId: bot.identity.identityAccountId, username: 'bot', chatPublicKey: bot.identity.identityChatPublicKey }, null);
    const requestId = (await db.requests.toArray())[0]!.requestId;
    manager.dispose();

    manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(bot) });
    const botChannel = peerChannel(store, bot, web, []);
    await botChannel.post({
      tag: 'deviceChatAccepted',
      value: { requestId, device: { statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey } },
    });
    await waitFor(async () => db.requests.get(requestId).then(row => (row?.status === 'accepted' ? row : null)));
    botChannel.dispose();
  });
});
