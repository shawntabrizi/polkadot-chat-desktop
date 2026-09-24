/**
 * Owner ask 2026-09-24: an unnamed group shows a name made from its roster,
 * so a person can tell two unnamed groups apart and see who is in one. These
 * cases fail if the rule drops a member, shows us to ourselves, ignores the
 * nickname this device gave someone, or keeps an old roster's name.
 */

import { describe, expect, it } from 'vitest';

import type { HexString } from '../../app/bytes';
import type { GroupRow } from '../../app/database';

import { EMPTY_GROUP_NAME, derivedName, groupDisplayName, sharedGroupName } from './groupNames';

const ME = '0x01' as HexString;
const acct = (n: number) => `0x${n.toString(16).padStart(2, '0')}` as HexString;
const group = (name: string, usernames: string[], left: HexString[] = []): Pick<GroupRow, 'name' | 'members' | 'left'> => ({
  name,
  members: [{ account: ME, username: 'me', joinedAt: 0 }, ...usernames.map((username, i) => ({ account: acct(i + 2), username, joinedAt: 0 }))],
  left,
});

describe('derived group names', () => {
  it('two members (you and one other): the group shows that one name', () => {
    expect(groupDisplayName(group('', ['bob']), ME)).toBe('bob');
  });

  it('four members: the three others, sorted, joined with commas; you are not listed', () => {
    const name = groupDisplayName(group('', ['carol', 'alice', 'bob']), ME);
    expect(name).toBe('alice, bob, carol');
    expect(name).not.toContain('me');
  });

  it('more than three others: the first three and "and N others", so the name stays short', () => {
    expect(groupDisplayName(group('', ['dave', 'carol', 'alice', 'bob']), ME)).toBe('alice, bob, carol and 1 other');
    expect(groupDisplayName(group('', ['erin', 'dave', 'carol', 'alice', 'bob']), ME)).toBe('alice, bob, carol and 2 others');
  });

  it('a nickname this device gave a member wins over the username (and sorts by the nickname)', () => {
    const contacts = [{ accountId: acct(3), username: 'bob', nickname: 'Aaron (work)' }];
    expect(groupDisplayName(group('', ['alice', 'bob']), ME, contacts)).toBe('Aaron (work), alice');
  });

  it('follows the roster: an added member appears, a removed or departed one goes', () => {
    expect(groupDisplayName(group('', ['alice']), ME)).toBe('alice');
    expect(groupDisplayName(group('', ['alice', 'bob']), ME)).toBe('alice, bob');
    expect(groupDisplayName(group('', ['alice', 'bob'], [acct(2)]), ME)).toBe('bob');
    expect(groupDisplayName(group('', []), ME)).toBe(EMPTY_GROUP_NAME);
  });

  it('a group with a name shows its name, not the roster', () => {
    expect(groupDisplayName(group('Hiking club', ['alice', 'bob']), ME)).toBe('Hiking club');
    expect(groupDisplayName(group('   ', ['alice']), ME)).toBe('alice');
  });

  it('text another person reads never carries a local nickname, and names the group as the reader sees it', () => {
    const g = group('', ['alice', 'bob']);
    // Invitee bob (0x03) sees "alice, me": the sender is listed, the reader is not.
    expect(sharedGroupName(g, acct(3))).toBe('alice, me');
    expect(derivedName(['b', 'A', 'c'])).toBe('A, b, c');
  });
});
