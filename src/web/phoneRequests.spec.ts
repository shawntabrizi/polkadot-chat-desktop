/**
 * The web build's half of "requests accepted elsewhere stay gone"
 * (src/renderer/domain/chat/manager.requests.spec.ts): here the phone
 * sign-in comes from this browser's sealed record after a reload (passphrase
 * unlock), as src/web/main.tsx boots it, and each start is a new page on the
 * same IndexedDB. docs/decisions.md "Requests accepted elsewhere".
 */

import { createExpiryAllocator, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bytesToHex } from '../renderer/app/bytes';
import { appDatabase, db } from '../renderer/app/database';
import type { ChatManager } from '../renderer/domain/chat/manager';
import { sendChatRequest } from '../renderer/domain/requests/gateway';
import { makePeer, waitFor } from '../renderer/domain/testing/peers';
import { acceptOnPhone, makePhoneSignIn, startPhoneSignedIn } from '../renderer/domain/testing/phoneSignIn';
import { pendingIncomingOf } from '../renderer/ui/Requests';

import { webDatabase } from './database';
import { type WebIdentityDeps, createWebIdentity } from './identity';
import { newVaultParams } from './vault';

const PASSPHRASE = 'correct horse battery';
const deps = (): WebIdentityDeps => ({
  db: webDatabase(),
  askNewPassphrase: async () => PASSPHRASE,
  backendFetch: null,
  clipboard: { writeText: async () => undefined, readText: async () => '', clear: () => undefined },
  vaultParams: () => newVaultParams(1_000),
});

const shownRequests = async () => pendingIncomingOf(await db.requests.toArray(), await db.contacts.toArray(), await db.blocked.toArray());

let manager: ChatManager | null = null;
const cleanups: VoidFunction[] = [];

beforeEach(async () => {
  await webDatabase().records.clear();
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  manager?.dispose();
  manager = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('web build, phone sign-in: accepted requests after a reload', () => {
  it('keeps a request accepted here, and drops one accepted on the phone, from "New requests"', async () => {
    const store = createInMemoryStatementStore();
    const signIn = makePhoneSignIn();
    const emily = makePeer();
    const shawntest = makePeer();
    const lookup = {
      getPeerIdentity: async (accountId: Uint8Array) => {
        const peer = [emily, shawntest].find(candidate => bytesToHex(candidate.identity.identityAccountId) === bytesToHex(accountId));
        return peer ? { accountId, username: peer === emily ? 'emilyo.01' : 'shawntest.01', chatPublicKey: peer.identity.identityChatPublicKey } : null;
      },
    };
    const requestFrom = async (sender: typeof emily) =>
      (
        await sendChatRequest({
          recipientAccountId: signIn.paired.identityAccountId,
          recipientChatPublicKey: signIn.identityChatPublicKey,
          senderIdentityAccountId: sender.identity.identityAccountId,
          senderIdentityChatPrivateKey: sender.identity.identityChatPrivateKey,
          senderDeviceEncryptionPublicKey: sender.device.encryptionPublicKey,
          senderDeviceSeed: sender.device.statementAccountSeed,
          welcomeMessage: null,
          statementStore: store,
          allocator: createExpiryAllocator(),
        })
      ).requestId;

    await createWebIdentity(deps()).savePaired(signIn.paired);
    const page = async () => {
      const identity = createWebIdentity(deps());
      await identity.unlock(PASSPHRASE);
      return startPhoneSignedIn(signIn, store, lookup, () => identity.pairedSecrets());
    };

    manager = await page();
    const fromEmily = await requestFrom(emily);
    const fromShawntest = await requestFrom(shawntest);
    await waitFor(async () => (await shownRequests()).length === 2);
    await manager.acceptRequest(fromEmily);
    manager.dispose();
    manager = null;

    // Closed; meanwhile the phone accepts shawntest.01's request.
    cleanups.push(await acceptOnPhone(signIn, store, shawntest, fromShawntest));

    manager = await page();
    // The "accepted" system row is the accept's last write.
    await waitFor(async () => (await db.messages.get(`accepted:${fromShawntest}`)) ?? null);
    expect((await db.requests.get(fromShawntest))?.status).toBe('accepted');
    expect((await db.requests.get(fromEmily))?.status).toBe('accepted');
    expect(await shownRequests()).toEqual([]);
  });
});
