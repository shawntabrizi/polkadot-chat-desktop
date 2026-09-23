/**
 * Spec 0009 fan-out groups: the rows. A group is an id, a name, an admin and
 * a roster; its room is keyed `group:<groupId>`. The transport (fan-out over
 * the pairwise sessions) is the manager's; this module owns the rules that
 * need no network: which roster wins, who may post, the sender's `seq`, and
 * the system rows a roster change writes.
 */

import type { HexString } from '../../app/bytes';
import { type GroupPeerId, type GroupRow, type MessageRow, appDatabase, db, groupPeerOf } from '../../app/database';

import type { GroupInfo, GroupMember, MessageContent } from './content';
import { addMessage } from './messages';

export const getGroup = (groupId: string): Promise<GroupRow | undefined> => db.groups.get(groupId);

export const listGroups = (): Promise<GroupRow[]> => db.groups.toArray();

/** The wire form of a stored group. */
export const groupInfoOf = (group: GroupRow): GroupInfo => ({
  groupId: group.id,
  name: group.name,
  admin: group.admin,
  members: group.members,
  version: group.version,
  createdAt: group.createdAt,
});

export const isMember = (group: GroupRow, account: HexString): boolean => group.members.some(member => member.account === account);

/** A member's username in the roster, or a short account for someone not in it. */
export const memberName = (group: GroupRow, account: HexString): string =>
  group.members.find(member => member.account === account)?.username ?? `${account.slice(0, 8)}…`;

/** Members other than us: who a group message fans out to. */
export const otherMembers = (group: GroupRow, self: HexString): GroupMember[] => group.members.filter(member => member.account !== self);

const systemRow = (groupId: string, messageId: string, timestamp: number, text: string): MessageRow => ({
  messageId,
  peerAccountId: groupPeerOf(groupId),
  groupId,
  timestamp,
  direction: 'system',
  status: 'received',
  content: { type: 'groupEvent', text } satisfies MessageContent,
  reactions: [],
  editedAt: null,
});

/** Make sure the group's room exists (the chat list shows it before anything is said). */
const ensureGroupRoom = async (groupId: string, at: number): Promise<void> => {
  const peer = groupPeerOf(groupId);
  if (await db.rooms.get(peer)) return;
  await db.rooms.put({ peerAccountId: peer, groupId, unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: at, updatedAt: at });
};

const newRow = (info: GroupInfo, now: number, self: 'member' | 'removed'): GroupRow => ({
  id: info.groupId,
  name: info.name,
  admin: info.admin,
  members: info.members,
  version: info.version,
  createdAt: info.createdAt,
  self,
  left: [],
  invites: [],
  nextSeq: 1,
  lastSeq: {},
  gapNoted: false,
  updatedAt: now,
});

/** "alice joined" / "bob was removed" lines between two rosters. */
const rosterChanges = (before: GroupRow, after: GroupInfo, left: readonly HexString[]): string[] => {
  const was = new Set(before.members.map(member => member.account));
  const now = new Set(after.members.map(member => member.account));
  const lines: string[] = [];
  for (const member of after.members) if (!was.has(member.account)) lines.push(`${member.username} joined`);
  for (const member of before.members) {
    // A member that left said so already ("… left"); the new roster only confirms it.
    if (!now.has(member.account) && !left.includes(member.account)) lines.push(`${member.username} was removed`);
  }
  if (after.name !== before.name) lines.push(`Group renamed to ${after.name}`);
  return lines;
};

export type GroupInfoResult = 'created' | 'updated' | 'removed' | 'ignored';

/**
 * Spec 0009 roster rules for a `groupInfo` from `sender`:
 * - only the admin's roster counts: `sender` must be `info.admin`, and a
 *   known group keeps the admin it was created with;
 * - the highest `version` wins; the same or a lower one is ignored;
 * - a roster without us: we were removed (`self: 'removed'`), and send no
 *   more; a first roster without us is not ours to keep.
 * Writes the room and one system row per version.
 */
export const applyGroupInfo = (sender: HexString, info: GroupInfo, self: HexString, now: number = Date.now()): Promise<GroupInfoResult> =>
  appDatabase.transaction('rw', [db.groups, db.rooms, db.messages, db.pendingDeletions], async () => {
    if (sender !== info.admin || !info.members.some(member => member.account === info.admin)) return 'ignored';
    const existing = await db.groups.get(info.groupId);
    const inRoster = info.members.some(member => member.account === self);
    const rowId = `group-info:${info.groupId}:${info.version}`;
    if (!existing) {
      if (!inRoster) return 'ignored';
      await db.groups.put(newRow(info, now, 'member'));
      await ensureGroupRoom(info.groupId, now);
      const adminName = info.members.find(member => member.account === info.admin)?.username ?? 'The admin';
      await addMessage(systemRow(info.groupId, rowId, now, `${adminName} added you to ${info.name}`), { read: true });
      return 'created';
    }
    if (existing.admin !== info.admin || info.version <= existing.version) return 'ignored';
    const lines = rosterChanges(existing, info, existing.left);
    const removed = !inRoster;
    await db.groups.put({
      ...existing,
      name: info.name,
      members: info.members,
      version: info.version,
      left: [],
      self: removed ? (existing.self === 'left' ? 'left' : 'removed') : existing.self,
      updatedAt: now,
    });
    if (removed && existing.self === 'member') lines.push('You were removed from the group');
    if (lines.length > 0) await addMessage(systemRow(info.groupId, rowId, now, lines.join(' · ')), { read: true });
    return removed ? 'removed' : 'updated';
  });

/**
 * Our own new group (we are its admin) or a new roster we send. Stores it
 * as the admin's truth at once; the manager fans it out.
 */
export const saveOwnGroupInfo = (info: GroupInfo, invites: HexString[], now: number = Date.now()): Promise<void> =>
  appDatabase.transaction('rw', [db.groups, db.rooms, db.messages, db.pendingDeletions], async () => {
    const existing = await db.groups.get(info.groupId);
    const rowId = `group-info:${info.groupId}:${info.version}`;
    if (!existing) {
      await db.groups.put({ ...newRow(info, now, 'member'), invites });
      await ensureGroupRoom(info.groupId, now);
      await addMessage(systemRow(info.groupId, rowId, now, `You created ${info.name}`), { read: true });
      return;
    }
    const lines = rosterChanges(existing, info, existing.left);
    await db.groups.put({ ...existing, name: info.name, members: info.members, version: info.version, left: [], invites, updatedAt: now });
    if (lines.length > 0) await addMessage(systemRow(info.groupId, rowId, now, lines.join(' · ')), { read: true });
  });

/** An invite whose roster went out: the member is reached now. */
export const clearInvite = (groupId: string, account: HexString): Promise<number> =>
  db.groups
    .where('id')
    .equals(groupId)
    .modify(group => {
      group.invites = group.invites.filter(entry => entry !== account);
    });

/**
 * `groupLeave` from `sender`: marked left until the admin's next roster.
 * `false` for an unknown group, a non-member, or a repeat.
 */
export const recordLeave = (groupId: string, sender: HexString, messageId: string, at: number): Promise<boolean> =>
  appDatabase.transaction('rw', [db.groups, db.rooms, db.messages, db.pendingDeletions], async () => {
    const group = await db.groups.get(groupId);
    if (!group || !isMember(group, sender) || group.left.includes(sender)) return false;
    await db.groups.put({ ...group, left: [...group.left, sender], updatedAt: Date.now() });
    await addMessage(systemRow(groupId, `group-leave:${messageId}`, at, `${memberName(group, sender)} left`), { read: true });
    return true;
  });

/** Our own leave: nothing more is sent to the group, and nothing more is taken from it. */
export const markSelfLeft = (groupId: string, at: number = Date.now()): Promise<void> =>
  appDatabase.transaction('rw', [db.groups, db.rooms, db.messages, db.pendingDeletions], async () => {
    const group = await db.groups.get(groupId);
    if (!group || group.self !== 'member') return;
    await db.groups.put({ ...group, self: 'left', updatedAt: at });
    await addMessage(systemRow(groupId, `group-self-left:${groupId}`, at, 'You left the group'), { read: true });
  });

export type Admission = { group: GroupRow; peer: GroupPeerId };

/**
 * May a `groupMessage` from `sender` enter the room? Only while we are a
 * member, and only from an account in our roster that has not left
 * (spec 0009: receivers reject non-members). Tracks the sender's `seq`: the
 * first gap in a group adds "Some messages may be missing" once.
 */
export const admitGroupMessage = (groupId: string, sender: HexString, seq: number, at: number): Promise<Admission | null> =>
  appDatabase.transaction('rw', [db.groups, db.rooms, db.messages, db.pendingDeletions], async () => {
    const group = await db.groups.get(groupId);
    if (!group || group.self !== 'member' || !isMember(group, sender) || group.left.includes(sender)) return null;
    const last = group.lastSeq[sender];
    const gap = last !== undefined && seq > last + 1;
    const lastSeq = { ...group.lastSeq, [sender]: Math.max(last ?? 0, seq) };
    const noteGap = gap && !group.gapNoted;
    const updated: GroupRow = { ...group, lastSeq, gapNoted: group.gapNoted || noteGap };
    await db.groups.put(updated);
    if (noteGap) await addMessage(systemRow(groupId, `group-gap:${groupId}`, at - 1, 'Some messages may be missing'), { read: true });
    return { group: updated, peer: groupPeerOf(groupId) };
  });

/** Our next `seq` in the group (per-sender monotonic, from 1). */
export const takeSeq = (groupId: string): Promise<number> =>
  appDatabase.transaction('rw', db.groups, async () => {
    const group = await db.groups.get(groupId);
    if (!group) throw new Error('no such group');
    await db.groups.update(groupId, { nextSeq: group.nextSeq + 1 });
    return group.nextSeq;
  });

/** Spec 0009 ordering: timestamp first, the sender's `seq` as the tie-break. */
export const compareGroupRows = (a: Pick<MessageRow, 'timestamp' | 'groupSeq'>, b: Pick<MessageRow, 'timestamp' | 'groupSeq'>): number =>
  a.timestamp - b.timestamp || (a.groupSeq ?? 0) - (b.groupSeq ?? 0);
