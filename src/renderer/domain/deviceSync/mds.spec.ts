/**
 * M22b multi-device through the chat manager. The SDK wraps each message
 * for every device of the contact, never for our own other devices; so a
 * contact learns our phone only if we tell it (Android
 * `ContactDeviceFanOutService`). Without that `deviceAdded` the contact's
 * messages would never reach the phone.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import { createIdentityChannel } from '../chat/identityChannel';
import type { IdentityChannelEvent } from '../chat/identityEvents';
import { type ChatManager, createChatManager } from '../chat/manager';
import { createPeerRoster } from '../chat/peerRoster';
import { type IncomingChatMessage, createPeerSession } from '../chat/peerSession';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

type Store = ReturnType<typeof createInMemoryStatementStore>;

const lookupOf = (peer: TestPeer): IdentityLookup => ({
  getPeerIdentity: async accountId =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId) ? { accountId, username: 'friend', chatPublicKey: peer.identity.identityChatPublicKey } : null,
});

/** The contact: its identity channel and its multi-device session towards us. */
const contactSide = (store: Store, self: TestPeer, us: TestPeer) => {
  const events: IdentityChannelEvent[] = [];
  const received: IncomingChatMessage[] = [];
  const channel = createIdentityChannel({
    ownIdentityAccountId: self.identity.identityAccountId,
    ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
    peerIdentityAccountId: us.identity.identityAccountId,
    peerIdentityChatPublicKey: us.identity.identityChatPublicKey,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onEvent: event => events.push(event),
  });
  const roster = createPeerRoster([]);
  const session = createPeerSession({
    identity: self.identity,
    deviceKeys: self.device,
    peerIdentityAccountId: us.identity.identityAccountId,
    peerIdentityChatPublicKey: us.identity.identityChatPublicKey,
    peerRoster: roster,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onMessage: message => received.push(message),
    onSent: () => undefined,
    onDelivered: () => undefined,
    onBatchDelivered: () => undefined,
  });
  return {
    events,
    received,
    roster,
    dispose: () => {
      channel.dispose();
      session.dispose();
    },
  };
};

const requestFrom = async (store: Store, from: TestPeer, to: TestPeer) =>
  sendChatRequest({
    recipientAccountId: to.identity.identityAccountId,
    recipientChatPublicKey: to.identity.identityChatPublicKey,
    senderIdentityAccountId: from.identity.identityAccountId,
    senderIdentityChatPrivateKey: from.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: from.device.encryptionPublicKey,
    senderDeviceSeed: from.device.statementAccountSeed,
    welcomeMessage: null,
    statementStore: store,
    allocator: createExpiryAllocator(),
  });

let manager: ChatManager | null = null;
let contact: ReturnType<typeof contactSide> | null = null;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});
afterEach(() => {
  contact?.dispose();
  manager?.dispose();
  contact = null;
  manager = null;
});

describe('multi-device: our phone is one of our devices', () => {
  it('a chat accepted here tells the contact about our phone (identity account + phone device key)', async () => {
    const store = createInMemoryStatementStore();
    const us = makePeer();
    const friend = makePeer();
    const phoneKey = new Uint8Array(32).fill(0x5a);
    manager = await createChatManager({
      identity: us.identity,
      deviceKeys: us.device,
      statementStore: store,
      lookup: lookupOf(friend),
      phone: { device: { statementAccountId: us.identity.identityAccountId, encryptionPublicKey: phoneKey }, linkFactory: null, tightBudget: async () => true, onRemoved: () => undefined },
    });
    contact = contactSide(store, friend, us);
    const { requestId } = await requestFrom(store, friend, us);
    await waitFor(() => db.requests.get(requestId));
    await manager.acceptRequest(requestId);
    const accepted = await waitFor(() => contact?.events.find(event => event.tag === 'accepted'));
    if (accepted.tag === 'accepted') contact.roster.set([accepted.device]);
    // The in-memory store does not replay resident statements to a new subscription (a node does), so
    // the contact reads our batch with the next statement; the un-acked deviceAdded rides in it.
    await manager.sendMessage(bytesToHex(friend.identity.identityAccountId) as `0x${string}`, { type: 'text', text: 'hello' });
    const added = await waitFor(() => contact?.received.find(message => message.content.tag === 'deviceAdded'), 400);
    expect(added.content).toEqual({ tag: 'deviceAdded', value: { statementAccountId: us.identity.identityAccountId, encryptionPublicKey: phoneKey } });
    // Sync has no WebRTC here: it says so and signals nothing.
    expect(manager.deviceSync?.snapshot().state).toBe('paused');
  });

  it('a local account (no phone) sends no deviceAdded and has no device sync', async () => {
    const store = createInMemoryStatementStore();
    const us = makePeer();
    const friend = makePeer();
    manager = await createChatManager({ identity: us.identity, deviceKeys: us.device, statementStore: store, lookup: lookupOf(friend) });
    contact = contactSide(store, friend, us);
    const { requestId } = await requestFrom(store, friend, us);
    await waitFor(() => db.requests.get(requestId));
    await manager.acceptRequest(requestId);
    const accepted = await waitFor(() => contact?.events.find(event => event.tag === 'accepted'));
    if (accepted.tag === 'accepted') contact.roster.set([accepted.device]);
    await manager.sendMessage(bytesToHex(friend.identity.identityAccountId) as `0x${string}`, { type: 'text', text: 'after' });
    await waitFor(() => contact?.received.find(message => message.content.tag === 'text'), 400);
    expect(contact.received.some(message => message.content.tag === 'deviceAdded')).toBe(false);
    expect(manager.deviceSync).toBeNull();
  });
});
