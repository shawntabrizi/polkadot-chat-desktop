/**
 * The M2 flow offline: a self-owned identity (seeded the way the desktop
 * seeds it) sends a chat request to a peer built like a `pca` bot, the peer
 * accepts, and a text goes out and an echo comes back.
 *
 * Both sides use the identity account as the statement account. The device
 * encryption key must still be apart from the chat key: bot-core reads the
 * identity-session topic with the identity key, so a device session on that
 * topic is never read (the first live run failed that way).
 */

import { x25519 } from '@noble/curves/ed25519.js';
import {
  createAccountId,
  createExpiryAllocator,
  createInMemoryStatementStore,
  createSessionId,
  createSr25519Prover,
} from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import { forgetCachedDeviceKeys, getDeviceKeys } from '../device/repository';
import type { IdentityLookup } from '../identity/lookup';
import { seedSelfIdentity } from '../identity/selfIdentity';
import { readUserIdentity } from '../identity/userIdentity';
import { decodeChatRequest } from '../requests/gateway';
import { type TestPeer, makeDeviceKeys, makeIdentity, tick, waitFor } from '../testing/peers';

import { createIdentityChannel } from './identityChannel';
import type { IdentityChannelEvent } from './identityEvents';
import { type ChatManager, createChatManager } from './manager';
import { listMessages } from './messages';
import { createPeerRoster } from './peerRoster';
import { createPeerSession } from './peerSession';

type Store = ReturnType<typeof createInMemoryStatementStore>;

/** One device whose statement account is the identity account, with its own encryption key (bot-core, the mobile app). */
const makeSingleDevicePeer = (): TestPeer => {
  const device = makeDeviceKeys();
  return { device, identity: { ...makeIdentity(), identityAccountId: device.statementAccountPublicKey } };
};

/** The self side, through the same Dexie seeding and reads the app runs at start. */
const seedSelf = async (): Promise<TestPeer> => {
  const keys = makeSingleDevicePeer();
  await seedSelfIdentity(
    {
      statementSeed: keys.device.statementAccountSeed,
      chatPrivateKey: keys.identity.identityChatPrivateKey,
      deviceEncryptionPrivateKey: keys.device.encryptionPrivateKey,
    },
    keys.device.statementAccountPublicKey,
  );
  const identity = await readUserIdentity();
  if (!identity) throw new Error('seeding wrote no identity');
  return { identity, device: await getDeviceKeys() };
};

const lookupOf = (peer: TestPeer): IdentityLookup => ({
  getPeerIdentity: async accountId =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId)
      ? { accountId, username: 'echobot.47', chatPublicKey: peer.identity.identityChatPublicKey }
      : null,
});

/**
 * The bot's side, as bot-core runs it: it reads the request off its discovery
 * topic, answers `deviceChatAccepted` + a welcome on the identity channel, and
 * echoes every text that arrives on the device session.
 */
const runEchoBot = (store: Store, bot: TestPeer, self: TestPeer) => {
  const prover = createSr25519Prover(bot.device.statementAccountSeed);
  // One allocator for everything this account signs, as the manager does.
  const allocator = createExpiryAllocator();
  const events: IdentityChannelEvent[] = [];
  const channel = createIdentityChannel({
    ownIdentityAccountId: bot.identity.identityAccountId,
    ownIdentityChatPrivateKey: bot.identity.identityChatPrivateKey,
    peerIdentityAccountId: self.identity.identityAccountId,
    peerIdentityChatPublicKey: self.identity.identityChatPublicKey,
    prover,
    allocator,
    statementStore: store,
    onEvent: event => events.push(event),
  });
  const roster = createPeerRoster([]);
  let echoed = 0;
  const session = createPeerSession({
    identity: bot.identity,
    deviceKeys: bot.device,
    peerIdentityAccountId: self.identity.identityAccountId,
    peerIdentityChatPublicKey: self.identity.identityChatPublicKey,
    peerRoster: roster,
    prover,
    allocator,
    statementStore: store,
    onMessage: message => {
      if (message.content.tag !== 'text') return;
      void session.send({ tag: 'text', value: `echo: ${message.content.value}` }, { messageId: `echo-${++echoed}`, timestamp: Date.now() });
    },
    onSent: () => undefined,
    onDelivered: () => undefined,
    onBatchDelivered: () => undefined,
  });

  const accept = async (): Promise<string> => {
    const request = await waitFor(() =>
      store
        .acceptedStatements()
        .map(statement => (statement.data ? decodeChatRequest(statement.data, bot.identity.identityAccountId, bot.identity.identityChatPrivateKey) : null))
        .find(decoded => decoded !== null),
    );
    if (!request.senderDevice) throw new Error('request carries no sender device');
    roster.set([request.senderDevice]);
    await channel.post({
      tag: 'deviceChatAccepted',
      value: { requestId: request.requestId, device: { statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey } },
    });
    return request.requestId;
  };

  return {
    accept,
    events,
    dispose: () => {
      channel.dispose();
      session.dispose();
    },
  };
};

let manager: ChatManager | null = null;
let bot: ReturnType<typeof runEchoBot> | null = null;

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  bot?.dispose();
  manager?.dispose();
  bot = null;
  manager = null;
});

describe('self-owned identity: request and reply with a single-device bot', () => {
  it('sends a request, gets the accept, sends ping and receives the echo', async () => {
    const store = createInMemoryStatementStore();
    const self = await seedSelf();
    // The seeding is what makes this test the desktop case.
    expect(self.device.statementAccountPublicKey).toEqual(self.identity.identityAccountId);
    expect(self.device.encryptionPublicKey).not.toEqual(self.identity.identityChatPublicKey);

    const peer = makeSingleDevicePeer();
    manager = await createChatManager({ identity: self.identity, deviceKeys: self.device, statementStore: store, lookup: lookupOf(peer) });
    bot = runEchoBot(store, peer, self);

    await manager.sendRequest({ accountId: peer.identity.identityAccountId, username: 'echobot.47', chatPublicKey: peer.identity.identityChatPublicKey }, null);
    const requestId = await bot.accept();

    const peerKey = bytesToHex(peer.identity.identityAccountId) as HexString;
    const contact = await waitFor(async () => (await db.contacts.get(peerKey)) ?? null);
    expect(contact.devices).toEqual([{ statementAccountId: peer.identity.identityAccountId, encryptionPublicKey: peer.device.encryptionPublicKey }]);
    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    // The session starts right after the "chat accepted" row is written.
    await waitFor(async () => (await db.messages.get(`accepted:${requestId}`)) ?? null);
    await tick();

    await manager.sendMessage(peerKey, { type: 'text', text: 'ping abc123' });
    // The ping rides the device-session topic, which must not be the identity-session topic.
    const accounts = [createAccountId(self.identity.identityAccountId), createAccountId(peer.identity.identityAccountId)] as const;
    const sessionTopic = (ownPrivateKey: Uint8Array) =>
      bytesToHex(createSessionId(x25519.getSharedSecret(ownPrivateKey, peer.identity.identityChatPublicKey), { accountId: accounts[0], pin: undefined }, { accountId: accounts[1], pin: undefined }));
    const deviceTopic = sessionTopic(self.device.encryptionPrivateKey);
    expect(deviceTopic).not.toBe(sessionTopic(self.identity.identityChatPrivateKey));
    await waitFor(() => store.acceptedStatements().some(statement => statement.topics?.some(topic => String(topic).toLowerCase() === deviceTopic)));
    const echo = await waitFor(async () => (await listMessages(peerKey)).find(row => row.direction === 'incoming') ?? null, 2000);
    expect(echo.content).toEqual({ type: 'text', text: 'echo: ping abc123' });
    // The identity channel listens on the same topic; it must not add the echo a second time.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await listMessages(peerKey)).filter(row => row.direction === 'incoming')).toHaveLength(1);
    // The bot's ACK moves the ping to delivered.
    await waitFor(async () => (await listMessages(peerKey)).find(row => row.direction === 'outgoing' && row.status === 'delivered') ?? null, 2000);
  });
});
