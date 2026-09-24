import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { describe, expect, it } from 'vitest';

import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { createIdentityChannel } from './identityChannel';
import type { IdentityChannelEvent } from './identityEvents';

const open = (store: ReturnType<typeof createInMemoryStatementStore>, self: TestPeer, peer: TestPeer, events: IdentityChannelEvent[]) =>
  createIdentityChannel({
    ownIdentityAccountId: self.identity.identityAccountId,
    ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
    peerIdentityAccountId: peer.identity.identityAccountId,
    peerIdentityChatPublicKey: peer.identity.identityChatPublicKey,
    prover: createSr25519Prover(self.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onEvent: event => events.push(event),
  });

describe('identity channel', () => {
  it('carries deviceChatAccepted with the acceptor DeviceInfo to the requester', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const aliceEvents: IdentityChannelEvent[] = [];
    const bobEvents: IdentityChannelEvent[] = [];
    const aliceChannel = open(store, alice, bob, aliceEvents);
    const bobChannel = open(store, bob, alice, bobEvents);

    await bobChannel.post({
      tag: 'deviceChatAccepted',
      value: {
        requestId: 'req-1',
        device: {
          statementAccountId: bob.device.statementAccountPublicKey,
          encryptionPublicKey: bob.device.encryptionPublicKey,
        },
      },
    });

    const accepted = await waitFor(() => aliceEvents.find(event => event.tag === 'accepted'));
    expect(accepted.tag === 'accepted' && accepted.requestId).toBe('req-1');
    expect(accepted.tag === 'accepted' && accepted.device.statementAccountId).toEqual(bob.device.statementAccountPublicKey);
    expect(accepted.tag === 'accepted' && accepted.device.encryptionPublicKey).toEqual(bob.device.encryptionPublicKey);
    // The channel acknowledges what it delivered: Bob's session sees a response.
    await waitFor(() => store.acceptedStatements().length >= 2);
    expect(bobEvents).toHaveLength(0);

    aliceChannel.dispose();
    bobChannel.dispose();
  });

  it('surfaces roster fan-out and plain chat content', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const aliceEvents: IdentityChannelEvent[] = [];
    const aliceChannel = open(store, alice, bob, aliceEvents);
    const bobChannel = open(store, bob, alice, []);

    const added = new Uint8Array(32).fill(9);
    await bobChannel.post({ tag: 'deviceAdded', value: { statementAccountId: added, encryptionPublicKey: bob.device.encryptionPublicKey } });
    await bobChannel.post({ tag: 'text', value: 'welcome' });
    await bobChannel.post({ tag: 'deviceRemoved', value: { statementAccountId: added } });

    await waitFor(() => aliceEvents.length === 3);
    expect(aliceEvents.map(event => event.tag)).toEqual(['deviceAdded', 'message', 'deviceRemoved']);
    const message = aliceEvents[1];
    expect(message?.tag === 'message' && message.content).toEqual({ tag: 'text', value: 'welcome' });

    aliceChannel.dispose();
    bobChannel.dispose();
  });

  it('drops the legacy chatAccepted @14, leaving the request pending', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const aliceEvents: IdentityChannelEvent[] = [];
    const aliceChannel = open(store, alice, bob, aliceEvents);
    const bobChannel = open(store, bob, alice, []);

    await bobChannel.post({ tag: 'chatAccepted', value: { messageId: 'req-1' } });
    await bobChannel.post({ tag: 'text', value: 'after' });

    await waitFor(() => aliceEvents.length === 1);
    expect(aliceEvents[0]?.tag).toBe('message');

    aliceChannel.dispose();
    bobChannel.dispose();
  });
});

describe('identity channel: capabilities (spec 0013, keyed as pca keys them)', () => {
  it('a set in the same batch as deviceChatAccepted is the accepting device\'s', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bot = makePeer();
    const aliceEvents: IdentityChannelEvent[] = [];
    const aliceChannel = open(store, alice, bot, aliceEvents);
    const botChannel = open(store, bot, alice, []);
    const device = { statementAccountId: bot.device.statementAccountPublicKey, encryptionPublicKey: bot.device.encryptionPublicKey };
    const caps = { version: 1, kinds: new Uint8Array(32).fill(0xff), fileVariants: [0, 1], hopDialects: [0], features: 3 };
    // Queued in one task: one batch (the accept's statement), as pca sends them.
    await Promise.all([
      botChannel.post({ tag: 'deviceChatAccepted', value: { requestId: 'req-1', device } }),
      botChannel.post({ tag: 'capabilities', value: caps }),
    ]);
    const set = await waitFor(() => aliceEvents.find(event => event.tag === 'message' && event.content.tag === 'capabilities'));
    expect(set.tag === 'message' && set.device).toEqual(bot.device.statementAccountPublicKey);

    // A set alone on the identity session names no device: the manager keys it by the identity account.
    await botChannel.post({ tag: 'capabilities', value: caps });
    await waitFor(() => aliceEvents.filter(event => event.tag === 'message').length === 2);
    const alone = aliceEvents.filter(event => event.tag === 'message')[1];
    expect(alone?.tag === 'message' && alone.device).toBeUndefined();
    aliceChannel.dispose();
    botChannel.dispose();
  });
});
