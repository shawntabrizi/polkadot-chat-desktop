/**
 * M16b: epoch keys at rest (review M16 answer 3). The point of the `keys`
 * table is that a dump of the database (a bug report, a copied profile
 * folder) holds no usable group key: the groups row has none, and the keys
 * table holds them sealed under a key that only the app's safeStorage opens.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { setAtRestKeyProvider } from '../../app/atRest';
import { bytesToHex } from '../../app/bytes';
import { type GroupEpochKey, type GroupRow, appDatabase, db } from '../../app/database';

import { loadGroupKeys, putGroupWithKeys, withStoredKeys } from './groupKeyStore';
import { dexieGroupStorage } from './groupsV2';

const appKey = new Uint8Array(32).fill(9);
const epochKey = (epoch: number, byte: number): GroupEpochKey => ({ epoch, key: new Uint8Array(32).fill(byte), openedAt: 1, erasesAt: null, signer: '0x01' });

const row = (id: string, keys: GroupEpochKey[]): GroupRow => ({
  id,
  name: 'Crew',
  admin: '0x01',
  members: [],
  version: 1,
  createdAt: 1,
  self: 'member',
  left: [],
  invites: [],
  nextSeq: 1,
  lastSeq: {},
  gapNoted: false,
  updatedAt: 1,
  v: 2,
  epoch: keys.at(-1)?.epoch ?? 1,
  keys,
});

const holds = (haystack: Uint8Array, needle: Uint8Array): boolean => bytesToHex(haystack).includes(bytesToHex(needle).slice(2));

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
  setAtRestKeyProvider(async () => appKey);
});

describe('M16b: epoch keys live sealed in `keys`, never on the groups row', () => {
  it('a written row keeps no key; the table holds each key sealed, not in the clear', async () => {
    const k = epochKey(1, 0x42);
    await putGroupWithKeys(row('g1', [k]));
    const stored = await db.groups.get('g1');
    expect(stored?.keys).toBeUndefined();
    const sealed = await db.keys.where('groupId').equals('g1').toArray();
    expect(sealed).toHaveLength(1);
    expect(holds(sealed[0]!.sealed, k.key)).toBe(false);
    // Read through the storage the service uses, the key is back.
    expect((await dexieGroupStorage.getGroup('g1'))?.keys?.[0]?.key).toEqual(k.key);
  });

  it('without the app’s at-rest key (another computer, a copied folder) the sealed keys do not open', async () => {
    await putGroupWithKeys(row('g1', [epochKey(1, 0x42)]));
    setAtRestKeyProvider(async () => new Uint8Array(32).fill(1));
    await expect(loadGroupKeys('g1')).rejects.toThrow();
  });

  it('a sealed key moved onto another group’s row does not open (the row id is its additional data)', async () => {
    await putGroupWithKeys(row('g1', [epochKey(1, 0x42)]));
    const [sealed] = await db.keys.toArray();
    await db.keys.put({ ...sealed!, id: 'g2:1:0', groupId: 'g2' });
    await expect(loadGroupKeys('g2')).rejects.toThrow();
  });

  it('an M16 row with its keys inline moves them to the table on its first read', async () => {
    const k = epochKey(2, 0x07);
    await db.groups.put(row('old', [epochKey(1, 0x06), k]));
    const read = await withStoredKeys(await db.groups.get('old'));
    expect(read?.keys?.map(x => x.epoch).sort()).toEqual([1, 2]);
    expect((await db.groups.get('old'))?.keys).toBeUndefined();
    expect((await loadGroupKeys('old')).find(x => x.epoch === 2)?.key).toEqual(k.key);
  });

  it('erasing (an empty list: leave, removal, the 14-day erase) leaves nothing in the table', async () => {
    await putGroupWithKeys(row('g1', [epochKey(1, 0x42), { ...epochKey(2, 0x43), fork: true }]));
    await putGroupWithKeys(row('g1', []));
    expect(await db.keys.count()).toBe(0);
  });
});
