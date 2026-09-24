/**
 * M15c (review M16b ruling 2): attachment keys at rest. Why: the ciphertext
 * of every attachment is public on the Bulletin chain for 14 days (spec 0012
 * "Privacy"), so its key is all that protects it. A dump of the message table
 * (a bug report, a copied profile folder) must not hold one; the keys table
 * holds them sealed under the app's safeStorage key.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { setAtRestKeyProvider } from '../../app/atRest';
import { bytesToHex } from '../../app/bytes';
import { type MessageRow, appDatabase, db } from '../../app/database';

import { attachmentKeyId, itemWithKey, migrateAttachmentKeys, withAttachmentKeys } from './attachmentKeyStore';
import { clearHistoryLocally } from './chatActions';
import type { AttachmentItem } from './content';
import { addMessage, tombstoneMessage } from './messages';

const appKey = new Uint8Array(32).fill(9);
const PEER = `0x${'ab'.repeat(32)}` as const;

const item = (byte: number): AttachmentItem => ({
  mime: 'image/png',
  name: null,
  size: 1000,
  media: { kind: 'image', width: 4, height: 3 },
  blurhash: null,
  thumbnail: null,
  key: new Uint8Array(32).fill(byte),
  nonce: new Uint8Array(12).fill(byte + 1),
  chunkSize: 2_000_000,
  chunks: [new Uint8Array(32).fill(0x30)],
  store: { genesis: `0x${'e1'.repeat(32)}`, mirror: null },
  expiresAt: Date.now() + 1_000_000,
});

const row = (messageId: string, items: AttachmentItem[], timestamp = 1): MessageRow => ({
  messageId,
  peerAccountId: PEER,
  timestamp,
  direction: 'incoming',
  status: 'received',
  content: { type: 'attachment', items, caption: 'hi' },
  reactions: [],
  editedAt: null,
});

/** Every byte string of the stored row, hex: what a dump of the table would show. */
const dumpOf = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (v instanceof Uint8Array ? bytesToHex(v) : v));
const leaks = (value: unknown, secret: Uint8Array): boolean => dumpOf(value).includes(bytesToHex(secret).slice(2));

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
  setAtRestKeyProvider(async () => appKey);
});

describe('M15c: attachment keys live sealed in `keys`, never in the message row', () => {
  it('a new attachment row keeps no key or nonce; the key table holds them sealed; a download gets them back', async () => {
    const a = item(0x42);
    await addMessage(row('m1', [a]));
    const stored = await db.messages.get('m1');
    expect(leaks(stored, a.key)).toBe(false);
    expect(leaks(stored, a.nonce)).toBe(false);
    const sealed = await db.attachmentKeys.get(attachmentKeyId('m1', 0));
    expect(sealed).toBeDefined();
    expect(leaks(sealed, a.key)).toBe(false);
    if (stored?.content.type !== 'attachment') throw new Error('no attachment row');
    const opened = await itemWithKey('m1', 0, stored.content.items[0]!);
    expect(opened.key).toEqual(a.key);
    expect(opened.nonce).toEqual(a.nonce);
  });

  it('an album keeps one sealed key per item, each opening to its own key', async () => {
    const items = [item(1), item(2), item(3)];
    await addMessage(row('album', items));
    const joined = await withAttachmentKeys((await db.messages.get('album'))!);
    if (joined.content.type !== 'attachment') throw new Error('no attachment row');
    expect(joined.content.items.map(x => x.key[0])).toEqual([1, 2, 3]);
  });

  it('migration moves the keys of rows written before M15c, once, and they still open', async () => {
    const old = item(0x07);
    // As an M15a/M15b client wrote it: keys inline in the row.
    await db.messages.put(row('old', [old]));
    expect(leaks(await db.messages.get('old'), old.key)).toBe(true);
    expect(await migrateAttachmentKeys()).toBe(1);
    expect(leaks(await db.messages.get('old'), old.key)).toBe(false);
    const joined = await withAttachmentKeys((await db.messages.get('old'))!);
    if (joined.content.type !== 'attachment') throw new Error('no attachment row');
    expect(joined.content.items[0]?.key).toEqual(old.key);
    expect(await migrateAttachmentKeys()).toBe(0);
  });

  it('without the app’s at-rest key (a copied folder) the keys do not open', async () => {
    await addMessage(row('m1', [item(0x42)]));
    const stored = await db.messages.get('m1');
    if (stored?.content.type !== 'attachment') throw new Error('no attachment row');
    setAtRestKeyProvider(async () => new Uint8Array(32).fill(1));
    await expect(itemWithKey('m1', 0, stored.content.items[0]!)).rejects.toThrow();
  });

  it('a sealed key moved to another message does not open (the row id is its additional data)', async () => {
    await addMessage(row('m1', [item(0x42)]));
    await addMessage(row('m2', [item(0x43)]));
    const sealed = await db.attachmentKeys.get(attachmentKeyId('m1', 0));
    await db.attachmentKeys.put({ ...sealed!, id: attachmentKeyId('m2', 0), messageId: 'm2' });
    const other = await db.messages.get('m2');
    if (other?.content.type !== 'attachment') throw new Error('no attachment row');
    await expect(itemWithKey('m2', 0, other.content.items[0]!)).rejects.toThrow();
  });

  it('a deleted message (tombstone, Clear history) takes its keys with it; group epoch keys are not touched', async () => {
    await addMessage(row('m1', [item(1)], 1));
    await addMessage(row('m2', [item(2), item(3)], 2));
    await db.keys.put({ id: 'g1:1:0', groupId: 'g1', epoch: 1, fork: false, openedAt: 1, erasesAt: null, signer: '0x01', nonce: new Uint8Array(12), sealed: new Uint8Array(48) });
    await tombstoneMessage('m1');
    expect(await db.attachmentKeys.get(attachmentKeyId('m1', 0))).toBeUndefined();
    expect(await db.attachmentKeys.get(attachmentKeyId('m2', 1))).toBeDefined();
    await clearHistoryLocally(PEER, 10);
    expect(await db.attachmentKeys.where('id').startsWith('att:').count()).toBe(0);
    expect(await db.keys.get('g1:1:0')).toBeDefined();
  });
});
