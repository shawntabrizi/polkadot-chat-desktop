/**
 * M16b: epoch keys at rest in the `keys` table (next to `secrets`), sealed
 * with the app's at-rest key. `groupsV2` keeps working with `GroupRow.keys`
 * in memory; this module is the Dexie side of that field: a row read here
 * comes back with its keys opened, and a row written here loses its keys to
 * the table. A row from M16 that still holds its keys inline moves them to
 * the table on its first read.
 */

import { openAtRest, sealAtRest } from '../../app/atRest';
import { bytesToHex } from '../../app/bytes';
import { type GroupEpochKey, type GroupKeyRow, type GroupRow, appDatabase, db } from '../../app/database';

const keyId = (groupId: string, key: Pick<GroupEpochKey, 'epoch' | 'fork'>): string => `${groupId}:${key.epoch}:${key.fork ? 1 : 0}`;

/** What was last written per group, so a row put for another reason (a carrier's dedup ids) does not reseal its keys. */
const written = new Map<string, string>();
const fingerprint = (keys: readonly GroupEpochKey[]): string =>
  keys
    .map(k => [k.epoch, k.fork ? 1 : 0, k.openedAt, k.erasesAt ?? '', k.signer, bytesToHex(k.key)].join(':'))
    .sort()
    .join('|');

/** Replaces the group's keys in the table with `keys` (an empty list erases them). */
export const saveGroupKeys = async (groupId: string, keys: readonly GroupEpochKey[]): Promise<void> => {
  const print = fingerprint(keys);
  // The table can change under the cache (Delete chat, an identity reset): skip only when its rows are still the ones written.
  if (written.get(groupId) === print) {
    const stored = (await db.keys.where('groupId').equals(groupId).primaryKeys()).sort().join('|');
    if (stored === keys.map(k => keyId(groupId, k)).sort().join('|')) return;
  }
  // Sealed before the transaction: Web Crypto is not an IndexedDB request and would end it.
  const rows: GroupKeyRow[] = await Promise.all(
    keys.map(async k => {
      const id = keyId(groupId, k);
      const { nonce, sealed } = await sealAtRest(k.key, id);
      return { id, groupId, epoch: k.epoch, fork: !!k.fork, openedAt: k.openedAt, erasesAt: k.erasesAt, signer: k.signer, nonce, sealed };
    }),
  );
  await appDatabase.transaction('rw', db.keys, async () => {
    await db.keys.where('groupId').equals(groupId).delete();
    if (rows.length > 0) await db.keys.bulkPut(rows);
  });
  written.set(groupId, print);
};

export const loadGroupKeys = async (groupId: string): Promise<GroupEpochKey[]> => {
  const rows = await db.keys.where('groupId').equals(groupId).toArray();
  const keys = await Promise.all(
    rows.map(async (row): Promise<GroupEpochKey> => ({
      epoch: row.epoch,
      key: await openAtRest({ nonce: row.nonce, sealed: row.sealed }, row.id),
      openedAt: row.openedAt,
      erasesAt: row.erasesAt,
      signer: row.signer,
      ...(row.fork ? { fork: true } : {}),
    })),
  );
  written.set(groupId, fingerprint(keys));
  return keys;
};

/** A stored group row with its keys joined; an M16 row's inline keys move to the table first. */
export const withStoredKeys = async (row: GroupRow | undefined): Promise<GroupRow | undefined> => {
  if (!row || row.v !== 2) return row;
  if (row.keys) {
    const { keys, ...rest } = row;
    await saveGroupKeys(row.id, keys);
    await db.groups.put(rest);
    return { ...rest, keys: [...keys] };
  }
  return { ...row, keys: await loadGroupKeys(row.id) };
};

/** Writes a group row: its keys to the table, the rest to `groups`. */
export const putGroupWithKeys = async (row: GroupRow): Promise<void> => {
  const { keys, ...rest } = row;
  if (row.v === 2) await saveGroupKeys(row.id, keys ?? []);
  await db.groups.put(row.v === 2 ? rest : row);
};
