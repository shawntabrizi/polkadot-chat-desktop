/**
 * The name a group shows (owner ask 2026-09-24). A group's `name` may be
 * empty (0011 Group state); an unnamed group shows a name made from its
 * roster, as iMessage, Signal and Matrix do (Matrix client-server spec,
 * "Calculating the display name for a room"): the other members' names
 * (nickname, else username), sorted, the first three joined with commas and
 * "and N others" after them. Never ourselves. Recomputed from the roster at
 * each render, so it follows adds and removals.
 */

import { bytesToHex } from '../../app/bytes';
import type { HexString } from '../../app/bytes';
import { DEVICE_ROW_ID, type GroupRow, db } from '../../app/database';

/** How many names the derived name lists before "and N others". */
export const DERIVED_NAMES_SHOWN = 3;

/** What the derived name reads with nobody else in the group. */
export const EMPTY_GROUP_NAME = 'Empty group';

/** A contact as far as a name goes: the nickname is a local label and wins on this device. */
export type NameSource = { accountId: HexString; username: string; nickname?: string };

/** "alice", "alice, bob, carol", "alice, bob, carol and 2 others": `names` in any order. */
export const derivedName = (names: readonly string[]): string => {
  if (names.length === 0) return EMPTY_GROUP_NAME;
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b));
  const shown = sorted.slice(0, DERIVED_NAMES_SHOWN).join(', ');
  const rest = sorted.length - DERIVED_NAMES_SHOWN;
  return rest > 0 ? `${shown} and ${rest} ${rest === 1 ? 'other' : 'others'}` : shown;
};

/**
 * The name this device shows for `group`: its own name, else the derived
 * one over the members other than `self` who have not left. `contacts` gives
 * nicknames; a member who is not a contact shows its roster username.
 */
export const groupDisplayName = (group: Pick<GroupRow, 'name' | 'members' | 'left'>, self: HexString | null, contacts: readonly NameSource[] = []): string => {
  const own = group.name.trim();
  if (own !== '') return own;
  const nicknames = new Map(contacts.map(contact => [contact.accountId, contact.nickname ?? contact.username]));
  return derivedName(
    group.members.filter(member => member.account !== self && !group.left.includes(member.account)).map(member => nicknames.get(member.account) ?? member.username),
  );
};

/**
 * The name that goes out in text another person reads (a chat-request
 * invite, an invite link): the group's name, else the derived name as
 * `reader` would see it, from roster usernames only. A nickname is a local
 * label and is never sent (M12e).
 */
export const sharedGroupName = (group: Pick<GroupRow, 'name' | 'members' | 'left'>, reader: HexString | null): string => groupDisplayName(group, reader, []);

/** Our identity account on this device (the derived name leaves it out), or null before pairing. */
export const readSelfAccount = async (): Promise<HexString | null> => {
  const row = await db.userIdentity.get(DEVICE_ROW_ID);
  return row ? bytesToHex(row.identityAccountId) : null;
};
