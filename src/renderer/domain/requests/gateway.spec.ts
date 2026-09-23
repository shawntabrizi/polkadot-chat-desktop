import { x25519 } from '@noble/curves/ed25519.js';
import { createExpiryAllocator, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { Bytes } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { makePeer, waitFor } from '../testing/peers';

import { decodeChatRequest, sendChatRequest, subscribeToIncomingRequests, verifyIdentityProof } from './gateway';
import { computeAllPeerTopic } from './topics';

const send = (store: ReturnType<typeof createInMemoryStatementStore>, from: ReturnType<typeof makePeer>, to: ReturnType<typeof makePeer>, welcomeMessage: string | null = 'hello') =>
  sendChatRequest({
    recipientAccountId: to.identity.identityAccountId,
    recipientChatPublicKey: to.identity.identityChatPublicKey,
    senderIdentityAccountId: from.identity.identityAccountId,
    senderIdentityChatPrivateKey: from.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: from.device.encryptionPublicKey,
    senderDeviceSeed: from.device.statementAccountSeed,
    welcomeMessage,
    statementStore: store,
    allocator: createExpiryAllocator(),
  });

const lastData = (store: ReturnType<typeof createInMemoryStatementStore>): Uint8Array => {
  const data = store.acceptedStatements().at(-1)?.data;
  if (!data) throw new Error('no statement submitted');
  return data;
};

describe('chat request round trip', () => {
  it('reaches the recipient on its discovery topics and decodes with the identity chat key', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();

    const { requestId } = await send(store, alice, bob);

    const statement = store.acceptedStatements().at(-1);
    // Full topic + day topic + channel: what the phone and the bots subscribe to.
    expect(statement?.topics).toHaveLength(3);
    expect(statement?.topics).toContain(`0x${Buffer.from(computeAllPeerTopic(bob.identity.identityAccountId)).toString('hex')}`);

    const decoded = decodeChatRequest(lastData(store), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey);
    expect(decoded).not.toBeNull();
    expect(decoded?.requestId).toBe(requestId);
    expect(decoded?.welcomeMessage).toBe('hello');
    // The sender is the identity, the device is what the session will address.
    expect(decoded?.senderIdentityAccountId).toEqual(alice.identity.identityAccountId);
    expect(decoded?.senderDevice?.statementAccountId).toEqual(alice.device.statementAccountPublicKey);
    expect(decoded?.senderDevice?.encryptionPublicKey).toEqual(alice.device.encryptionPublicKey);
    expect(verifyIdentityProof(decoded!, bob.identity.identityChatPrivateKey, alice.identity.identityChatPublicKey)).toBe(true);
  });

  it('is unreadable with another identity chat key', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const eve = makePeer();
    await send(store, alice, bob);
    expect(decodeChatRequest(lastData(store), bob.identity.identityAccountId, eve.identity.identityChatPrivateKey)).toBeNull();
  });

  // The signature covers the recipient, so a request captured on Bob's topic
  // cannot be replayed to Carol by re-publishing it on her topic.
  it('rejects a request signed for a different recipient', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const carol = makePeer();
    await send(store, alice, bob);
    expect(decodeChatRequest(lastData(store), carol.identity.identityAccountId, bob.identity.identityChatPrivateKey)).toBeNull();
  });

  // mds.md: the proof is keyed by the sender's CURRENT identity chat key, so a
  // request built with a stale (or stolen) key does not verify.
  it('fails the identity proof when the sender identity key does not match the chain', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    await send(store, alice, bob);
    const decoded = decodeChatRequest(lastData(store), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey);
    const rotatedKey = x25519.getPublicKey(x25519.utils.randomSecretKey());
    expect(verifyIdentityProof(decoded!, bob.identity.identityChatPrivateKey, rotatedKey)).toBe(false);
  });

  it('accepts the bot-core form with an outer Bytes() wrapper', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const { requestId } = await send(store, alice, bob, null);
    const wrapped = Bytes().enc(lastData(store));
    const decoded = decodeChatRequest(wrapped, bob.identity.identityAccountId, bob.identity.identityChatPrivateKey);
    expect(decoded?.requestId).toBe(requestId);
    expect(decoded?.welcomeMessage).toBeNull();
  });

  it('returns null for garbage instead of throwing', () => {
    const bob = makePeer();
    expect(decodeChatRequest(new Uint8Array([1, 2, 3]), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey)).toBeNull();
  });
});

describe('subscribeToIncomingRequests', () => {
  it('delivers requests already on the topics and requests published later, each once', async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStatementStore();
      const alice = makePeer();
      const bob = makePeer();
      const carol = makePeer();
      await send(store, alice, bob);

      const received: Uint8Array[] = [];
      const stop = subscribeToIncomingRequests(
        { ownAccountId: bob.identity.identityAccountId, statementStore: store, pollIntervalMs: 1_000 },
        data => received.push(data),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toHaveLength(1);

      await send(store, carol, bob);
      expect(received).toHaveLength(2);

      // The poll sees both statements again but must not replay them.
      await vi.advanceTimersByTimeAsync(2_500);
      expect(received).toHaveLength(2);

      stop();
      expect(store.activeSubscriptions()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores requests addressed to someone else', async () => {
    const store = createInMemoryStatementStore();
    const alice = makePeer();
    const bob = makePeer();
    const carol = makePeer();
    const received: Uint8Array[] = [];
    const stop = subscribeToIncomingRequests({ ownAccountId: bob.identity.identityAccountId, statementStore: store }, data =>
      received.push(data),
    );
    await send(store, alice, carol);
    await waitFor(() => store.acceptedStatements().length === 1);
    expect(received).toHaveLength(0);
    stop();
  });
});
