import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';

import { getContact, listContacts, removeContactDevice, upsertContactDevice } from './repository';

const seed = { accountId: '0xaa' as const, username: 'alice', chatPublicKey: new Uint8Array(32).fill(1) };
const device = (fill: number) => ({ statementAccountId: new Uint8Array(32).fill(fill), encryptionPublicKey: new Uint8Array(32).fill(fill + 100) });

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('contacts repository', () => {
  it('creates a contact with its first device and adds more without duplicates', async () => {
    await upsertContactDevice(seed, device(1));
    await upsertContactDevice(seed, device(2));
    // Same statement account, new key: the device re-announced itself.
    await upsertContactDevice(seed, { ...device(1), encryptionPublicKey: new Uint8Array(32).fill(0xee) });

    const contact = await getContact('0xaa');
    expect(contact?.devices).toHaveLength(2);
    expect(contact?.devices.find(d => d.statementAccountId[0] === 1)?.encryptionPublicKey[0]).toBe(0xee);
  });

  it('refreshes the username and chat key on every upsert', async () => {
    await upsertContactDevice(seed, device(1));
    await upsertContactDevice({ ...seed, username: 'alice2', chatPublicKey: new Uint8Array(32).fill(7) }, null);
    const contact = await getContact('0xaa');
    expect(contact?.username).toBe('alice2');
    expect(contact?.chatPublicKey[0]).toBe(7);
    expect(contact?.devices).toHaveLength(1);
  });

  it('removes one device and keeps the rest', async () => {
    await upsertContactDevice(seed, device(1));
    await upsertContactDevice(seed, device(2));
    await removeContactDevice('0xaa', device(1).statementAccountId);
    expect((await getContact('0xaa'))?.devices.map(d => d.statementAccountId[0])).toEqual([2]);
    expect(await removeContactDevice('0xbb', device(1).statementAccountId)).toBeUndefined();
  });

  it('lists contacts by username', async () => {
    await upsertContactDevice({ ...seed, accountId: '0xcc', username: 'zed' }, null);
    await upsertContactDevice(seed, null);
    expect((await listContacts()).map(c => c.username)).toEqual(['alice', 'zed']);
    expect(await db.contacts.count()).toBe(2);
  });
});
