/**
 * Owner report (2026-09-28), signed in with the phone: "New requests" listed
 * chats he had already accepted, on the phone or here. A request that one of
 * our devices accepted must leave the list and stay gone across restarts,
 * or the person answers the same stranger twice and cannot tell which chats
 * are real. docs/decisions.md "Requests accepted elsewhere".
 */

import { createExpiryAllocator, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';
import { type PhoneSignIn, acceptOnPhone, makePhoneSignIn, startPhoneSignedIn } from '../testing/phoneSignIn';
import { pendingIncomingOf } from '../../ui/Requests';

import type { ChatManager } from './manager';

type Store = ReturnType<typeof createInMemoryStatementStore>;

const lookupOf = (peer: TestPeer, username: string): IdentityLookup => ({
  getPeerIdentity: async accountId =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId) ? { accountId, username, chatPublicKey: peer.identity.identityChatPublicKey } : null,
});

/** What "New requests" shows now. */
const shownRequests = async () => pendingIncomingOf(await db.requests.toArray(), await db.contacts.toArray(), await db.blocked.toArray());

const requestFrom = async (store: Store, sender: TestPeer, signIn: PhoneSignIn): Promise<string> => {
  const { requestId } = await sendChatRequest({
    recipientAccountId: signIn.paired.identityAccountId,
    recipientChatPublicKey: signIn.identityChatPublicKey,
    senderIdentityAccountId: sender.identity.identityAccountId,
    senderIdentityChatPrivateKey: sender.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: sender.device.encryptionPublicKey,
    senderDeviceSeed: sender.device.statementAccountSeed,
    welcomeMessage: 'hi, it is emily',
    statementStore: store,
    allocator: createExpiryAllocator(),
  });
  return requestId;
};

let manager: ChatManager | null = null;
const cleanups: VoidFunction[] = [];

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  manager?.dispose();
  manager = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const setUp = () => {
  const emily = makePeer();
  return { store: createInMemoryStatementStore(), signIn: makePhoneSignIn(), emily, lookup: lookupOf(emily, 'emilyo.01') };
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('phone sign-in: a request accepted on this device', () => {
  it('stays accepted and out of "New requests" after a restart, with its statement still in the store', async () => {
    const { store, signIn, emily, lookup } = setUp();
    manager = await startPhoneSignedIn(signIn, store, lookup);
    const requestId = await requestFrom(store, emily, signIn);
    await waitFor(async () => (await shownRequests()).length === 1);
    await manager.acceptRequest(requestId);
    expect(await shownRequests()).toEqual([]);

    manager.dispose();
    // A new app instance on the same storage; the request statement is re-read from the store.
    manager = await startPhoneSignedIn(signIn, store, lookup);
    await settle();
    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    expect(await db.contacts.get(bytesToHex(emily.identity.identityAccountId))).toBeDefined();
    expect(await shownRequests()).toEqual([]);
  });

  it('comes back as accepted from our own DeviceChatAccepted when the chat database is lost but the sign-in is kept', async () => {
    const { store, signIn, emily, lookup } = setUp();
    manager = await startPhoneSignedIn(signIn, store, lookup);
    const requestId = await requestFrom(store, emily, signIn);
    await waitFor(async () => (await shownRequests()).length === 1);
    await manager.acceptRequest(requestId);
    await waitFor(() => store.acceptedStatements().length >= 2);
    manager.dispose();

    // The chat rows are gone (a wiped or evicted IndexedDB); the saved sign-in, and so this device's key, is not.
    await appDatabase.delete({ disableAutoOpen: false });
    manager = await startPhoneSignedIn(signIn, store, lookup);
    await waitFor(async () => (await db.messages.get(requestId)) ?? null);
    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    expect(await shownRequests()).toEqual([]);
  });
});

describe('phone sign-in: a request accepted on the phone', () => {
  it('leaves "New requests" and becomes a chat while this device runs', async () => {
    const { store, signIn, emily, lookup } = setUp();
    manager = await startPhoneSignedIn(signIn, store, lookup);
    const requestId = await requestFrom(store, emily, signIn);
    await waitFor(async () => (await shownRequests()).length === 1);

    cleanups.push(await acceptOnPhone(signIn, store, emily, requestId));

    // The welcome message row is the accept's last write.
    await waitFor(async () => (await db.messages.get(requestId)) ?? null);
    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    expect(await shownRequests()).toEqual([]);
    const contact = await db.contacts.get(bytesToHex(emily.identity.identityAccountId));
    expect(contact?.devices).toEqual([{ statementAccountId: emily.device.statementAccountPublicKey, encryptionPublicKey: emily.device.encryptionPublicKey }]);
    expect(await db.rooms.get(bytesToHex(emily.identity.identityAccountId))).toBeDefined();
    expect((await db.messages.get(requestId))?.content).toEqual({ type: 'text', text: 'hi, it is emily' });
  });

  it('is not shown at the next start when the phone accepted while this device was closed', async () => {
    const { store, signIn, emily, lookup } = setUp();
    manager = await startPhoneSignedIn(signIn, store, lookup);
    const requestId = await requestFrom(store, emily, signIn);
    await waitFor(async () => (await shownRequests()).length === 1);
    manager.dispose();
    manager = null;

    cleanups.push(await acceptOnPhone(signIn, store, emily, requestId));

    manager = await startPhoneSignedIn(signIn, store, lookup);
    await waitFor(async () => (await db.messages.get(requestId)) ?? null);
    expect((await db.requests.get(requestId))?.status).toBe('accepted');
    expect(await shownRequests()).toEqual([]);
  });

  it('ignores an accept on our identity topic that none of our devices signed (the requester holds the same key)', async () => {
    const { store, signIn, emily, lookup } = setUp();
    manager = await startPhoneSignedIn(signIn, store, lookup);
    const requestId = await requestFrom(store, emily, signIn);
    await waitFor(async () => (await shownRequests()).length === 1);

    cleanups.push(await acceptOnPhone(signIn, store, emily, requestId, emily));
    await waitFor(() => store.acceptedStatements().length >= 2);
    await settle();

    expect((await db.requests.get(requestId))?.status).toBe('pending');
    expect(await db.contacts.count()).toBe(0);
    expect(await shownRequests()).toHaveLength(1);
  });
});
