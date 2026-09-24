/**
 * Contacts: peers with an accepted chat request, with the device roster the
 * multi-device session addresses. Keyed by the hex of the identity account.
 */

import { type HexString, bytesEqual } from '../../app/bytes';
import { type ContactRow, type PeerDevice, appDatabase, db } from '../../app/database';

export type ContactSeed = {
  accountId: HexString;
  username: string;
  chatPublicKey: Uint8Array;
};

export const listContacts = async (): Promise<ContactRow[]> =>
  (await db.contacts.toArray()).sort((a, b) => a.username.localeCompare(b.username));

export const getContact = (accountId: HexString): Promise<ContactRow | undefined> => db.contacts.get(accountId);

const withDevice = (devices: PeerDevice[], device: PeerDevice): PeerDevice[] => [
  // One entry per statement account; a re-announced device replaces its old key.
  ...devices.filter(existing => !bytesEqual(existing.statementAccountId, device.statementAccountId)),
  device,
];

/**
 * Create the contact or add one device to it. The username and chat key are
 * refreshed on every call: a rotated identity chat key must not leave a stale
 * one on the row, or every later session derives dead topics.
 */
export const upsertContactDevice = (seed: ContactSeed, device: PeerDevice | null): Promise<ContactRow> =>
  appDatabase.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.get(seed.accountId);
    const now = Date.now();
    const devices = device ? withDevice(existing?.devices ?? [], device) : (existing?.devices ?? []);
    const row: ContactRow = {
      accountId: seed.accountId,
      username: seed.username,
      chatPublicKey: seed.chatPublicKey,
      devices,
      // A local label (M12e) survives every refresh of the chain data.
      ...(existing?.nickname ? { nickname: existing.nickname } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.contacts.put(row);
    return row;
  });

export const removeContactDevice = (accountId: HexString, statementAccountId: Uint8Array): Promise<ContactRow | undefined> =>
  appDatabase.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.get(accountId);
    if (!existing) return undefined;
    const row: ContactRow = {
      ...existing,
      devices: existing.devices.filter(device => !bytesEqual(device.statementAccountId, statementAccountId)),
      updatedAt: Date.now(),
    };
    await db.contacts.put(row);
    return row;
  });
