import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appDatabase, db } from '../../app/database';
import { deriveStatementAccountPublicKey, generateEncryptionPrivateKey, generateStatementAccountSeed } from '../device/keys';
import { forgetCachedDeviceKeys } from '../device/repository';

import { resetIdentity } from './reset';
import { seedSelfIdentity } from './selfIdentity';

const seed = async (): Promise<void> => {
  const statementSeed = generateStatementAccountSeed();
  await seedSelfIdentity(
    { statementSeed, chatPrivateKey: generateEncryptionPrivateKey(), deviceEncryptionPrivateKey: generateEncryptionPrivateKey() },
    deriveStatementAccountPublicKey(statementSeed),
  );
  await db.contacts.put({ accountId: `0x${'44'.repeat(32)}`, username: 'peer.01', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 1, updatedAt: 1 });
};

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('resetIdentity', () => {
  // After a reset the next start must find nothing: no keys to chat as the old
  // identity, no chats that belong to it. Otherwise the start-up re-seeding
  // would bring the old identity back from a half-deleted state.
  it('deletes identity.json first, then the whole renderer database, then reloads', async () => {
    await seed();
    const order: string[] = [];
    const reset = vi.fn(async () => {
      order.push('main');
    });
    await resetIdentity({
      identityApi: { reset },
      database: {
        delete: async () => {
          order.push('database');
          await appDatabase.delete({ disableAutoOpen: false });
        },
      },
      reload: () => order.push('reload'),
    });
    expect(order).toEqual(['main', 'database', 'reload']);
    expect(await db.secrets.count()).toBe(0);
    expect(await db.userIdentity.count()).toBe(0);
    expect(await db.contacts.count()).toBe(0);
  });

  // If the main process keeps the identity (a sign-up is running, a disk
  // error), the chats must stay, or the app would open that identity with its
  // history gone.
  it('keeps the database and does not reload when the main process refuses', async () => {
    await seed();
    const reload = vi.fn();
    const remove = vi.fn(async () => undefined);
    await expect(
      resetIdentity({ identityApi: { reset: async () => Promise.reject(new Error('A sign-up is running.')) }, database: { delete: remove }, reload }),
    ).rejects.toThrow(/sign-up/);
    expect(remove).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await db.contacts.count()).toBe(1);
    expect(await db.secrets.count()).toBe(3);
  });
});
