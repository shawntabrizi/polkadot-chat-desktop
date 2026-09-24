/**
 * Owner ask 2026-09-24, as the list, the search and the New group picker
 * show it. Why: an unnamed group must be findable and recognisable by who is
 * in it (the list and the search show the derived name, never us), and the
 * picker must not offer a contact whose app cannot hold the group key (a
 * pick there would be refused by the manager, or worse, a welcome to a phone
 * that shows "Unsupported message").
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { type HexString, hexToBytes } from '../app/bytes';
import { type GroupRow, type PeerCapabilitiesRow, type PeerInfoRow, appDatabase, db, groupPeerOf } from '../app/database';
import { OWN_CAPABILITIES } from '../domain/chat/capabilities';
import { setNickname } from '../domain/chat/chatActions';
import { upsertContactDevice } from '../domain/contacts/repository';

import { buildRows, loadList } from './ChatList';
import { contactGroupSupport } from './GroupRoom';
import { rowMatches } from './searchSections';

const ME = `0x${'01'.repeat(32)}` as HexString;
const ALICE = `0x${'aa'.repeat(32)}` as HexString;
const BOB = `0x${'bb'.repeat(32)}` as HexString;

const group = (name: string): GroupRow =>
  ({
    id: 'g1',
    name,
    admin: ME,
    members: [
      { account: ME, username: 'me', joinedAt: 1 },
      { account: BOB, username: 'bob', joinedAt: 1 },
      { account: ALICE, username: 'alice', joinedAt: 1 },
    ],
    version: 1,
    createdAt: 1,
    self: 'member',
    left: [],
    invites: [],
    nextSeq: 1,
    lastSeq: {},
    gapNoted: false,
    updatedAt: 1,
  }) as GroupRow;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
  await db.userIdentity.put({ id: 'self', identityAccountId: hexToBytes(ME), rootAccountId: hexToBytes(ME), peerDeviceEncPubKey: new Uint8Array(32), peerStatementAccountId: null, pairedAt: 1 });
});

const groupRow = async () => buildRows(await loadList(), { kind: 'other' }, () => undefined, undefined, new Set()).rows.find(row => row.key === groupPeerOf('g1'))!;

describe('an unnamed group in the list and the search', () => {
  it('shows the other members sorted, without us, and a search for a member finds it', async () => {
    await db.groups.put(group(''));
    const row = await groupRow();
    expect(row.name).toBe('alice, bob');
    expect(rowMatches(row, 'bob')).toBe(true);
    expect(rowMatches(row, 'me')).toBe(false);
  });

  it('uses the nickname this device gave a member, and a named group keeps its name', async () => {
    await upsertContactDevice({ accountId: BOB, username: 'bob', chatPublicKey: new Uint8Array(32) }, null);
    await setNickname(BOB, 'Bobby');
    await db.groups.put(group(''));
    expect((await groupRow()).name).toBe('alice, Bobby');
    await db.groups.put(group('Hiking club'));
    expect((await groupRow()).name).toBe('Hiking club');
  });
});

describe('the member picker (New group, Add member)', () => {
  const device = (fill: number) => ({ statementAccountId: new Uint8Array(32).fill(fill), encryptionPublicKey: new Uint8Array(32).fill(fill + 1) });
  const hexOf = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;
  const contact = (accountId: HexString, devices: ReturnType<typeof device>[]) => ({ accountId, username: accountId.slice(2, 6), chatPublicKey: new Uint8Array(32), devices, createdAt: 1, updatedAt: 1 });
  const capable = contact(ALICE, [device(0x10)]);
  const phoneUser = contact(BOB, [device(0x20), device(0x30)]);
  const unknown = contact(`0x${'cc'.repeat(32)}` as HexString, [device(0x40)]);
  const rows: PeerCapabilitiesRow[] = [
    { peer: ALICE, device: hexOf(device(0x10).statementAccountId), caps: OWN_CAPABILITIES, timestamp: 1 },
    // The desktop advertised groups; the phone next to it never advertised anything (a baseline client).
    { peer: BOB, device: hexOf(device(0x20).statementAccountId), caps: OWN_CAPABILITIES, timestamp: 1 },
  ];
  const none = new Map<string, PeerInfoRow>();

  it('takes a contact whose devices all advertised groups; greys a phone user and a contact never heard from, each with its reason', () => {
    expect(contactGroupSupport(capable as never, rows, none)).toBe('ready');
    expect(contactGroupSupport(phoneUser as never, rows, none)).toBe('unsupported');
    expect(contactGroupSupport(unknown as never, rows, none)).toBe('unknown');
  });

  it('a bot counts by its botInfo (the M20 transition rule) until it sends a set of its own', () => {
    const bots = new Map<string, PeerInfoRow>([[unknown.accountId, { peerId: unknown.accountId, botInfo: { kind: 'bot' } } as unknown as PeerInfoRow]]);
    expect(contactGroupSupport(unknown as never, rows, bots)).toBe('ready');
  });
});
