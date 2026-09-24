/**
 * Spec 0011 private groups v2 (M16): transport, keys, state and removal.
 *
 * A group is its epoch key `K_e`. Every message this client sends to a v2
 * group is ONE statement on `Topic_e` / `ChMsgs_e`: the new message plus our
 * own messages of the current epoch from the last 24 h (the carry), newest
 * first, at most 4096 bytes of plaintext. No ACK. Messages sent within the
 * same second share one statement.
 *
 * One store subscription (`matchAny`) covers the current and still-kept
 * topics of every v2 group; it is re-opened when that set changes. A carrier
 * counts only when its signer is a posting account of `from` in the applied
 * state and `from` may post; messages dedup by `<from>:<messageId>`.
 *
 * State: posted whole on `ChState_e` by an admin; applied by (epoch,
 * version, lower signer) when the signer's role allows the change. Removal:
 * a rekey on the old topic (one entry per remaining member, sealed with
 * K(admin, member)) and the new state on the new topic: two submissions.
 *
 * Pairwise control (kind 249, over the DM session): `welcome` (the epoch key
 * and the state's hash), `keyRequest`, and `historyRequest` / `history`.
 *
 * Rows live in Dexie (`groups`, with the v2 fields); the manager owns the DM
 * sessions and applies each taken message as it does a v1 group message.
 */

import { AccountFullError, type StatementProver, type StatementStoreAdapter, submitStatementOnce } from '@novasamatech/statement-store';
import { compact } from 'scale-ts';

import { type HexString, bytesEqual, bytesToHex, hexToBytes } from '../../app/bytes';
import { type GroupEpochKey, type GroupRow, type MessageRow, db, groupPeerOf } from '../../app/database';

import type { GroupMember } from './content';
import {
  ALL_PERMISSIONS,
  GROUP2_BOUNDS,
  GROUP_MEMBER_CAP,
  type GroupState,
  type InviteLink,
  type Member2,
  PERMISSIONS,
  ROLES,
  type Rekey,
  decodeGroupData,
  decodeGroupMessages,
  decodeGroupState,
  decodeInviteLink,
  encodeGroupData,
  encodeGroupMessages,
  encodeGroupState,
  encodeInviteLink,
  fromBase64Url,
  toBase64Url,
} from './groupCodec';
import {
  type EpochKeys,
  VARIANT,
  createGroupExpiryAllocator,
  deriveEpoch,
  hash256,
  joinProof,
  makeRekeyEntry,
  open,
  openRekeyEntry,
  pairwiseSecret,
  randomBytes,
  seal,
} from './groupKeys';
import { putGroupWithKeys, withStoredKeys } from './groupKeyStore';
import { ensureGroupRoom, groupSystemRow } from './groups';
import { ChatMessageCodec, type ChatContent, type GroupControl, type HistorySinceWire } from './identityEvents';
import { addMessage, listMessages, setMessageStatus } from './messages';

/**
 * Where a group's rows live. The app uses Dexie (`dexieGroupStorage`); a
 * spec gives each member its own memory storage, because one process holds
 * one Dexie database and a group test needs several members.
 */
export type GroupsV2Storage = {
  getGroup: (groupId: string) => Promise<GroupRow | undefined>;
  putGroup: (row: GroupRow) => Promise<unknown>;
  listGroups: () => Promise<GroupRow[]>;
  /** A system row (read) in the group's room, and the room itself. */
  addSystemRow: (row: MessageRow) => Promise<unknown>;
  ensureRoom: (groupId: string, at: number) => Promise<void>;
  listRows: (groupId: string) => Promise<MessageRow[]>;
  /** Our own row went out on a statement. */
  markSent: (messageId: string) => Promise<void>;
};

/** Epoch keys go to the sealed `keys` table (M16b), the rest of the row to `groups`. */
export const dexieGroupStorage: GroupsV2Storage = {
  getGroup: async groupId => withStoredKeys(await db.groups.get(groupId)),
  putGroup: putGroupWithKeys,
  listGroups: async () => Promise.all((await db.groups.toArray()).map(async row => (await withStoredKeys(row))!)),
  addSystemRow: row => addMessage(row, { read: true }),
  ensureRoom: ensureGroupRoom,
  listRows: groupId => listMessages(groupPeerOf(groupId)),
  markSent: async messageId => {
    const own = await db.messages.get(messageId);
    if (own?.direction === 'outgoing' && (own.status === 'sending' || own.status === 'failed')) await setMessageStatus(messageId, 'sent');
  },
};

const DAY = 86_400_000;
export const CARRY_WINDOW_MS = DAY;
export const OLD_KEY_KEEP_MS = 14 * DAY;
export const FORK_KEEP_MS = DAY;
export const ROTATION_MS = 7 * DAY;
export const ROTATION_JITTER_MS = 3_600_000;
export const HISTORY_PAGE_BYTES = 4096;
export const SEND_INTERVAL_MS = 1000;
const SEEN_IDS = 1000;
const PENDING_PER_GROUP = 64;
const KEY_REQUEST_EVERY_MS = 60_000;
const SWEEP_MS = 30_000;
const HISTORY_LIMIT = 100;

// ── Rules without I/O (spec'd directly) ───────────────────────────────────

export const memberOf = (state: GroupState | null | undefined, account: HexString): Member2 | null => state?.members.find(m => m.account === account) ?? null;

/** The member a statement signer speaks for: its own account or one of its posting accounts (mds devices). */
export const memberBySigner = (state: GroupState | null | undefined, signer: HexString): Member2 | null =>
  state?.members.find(m => m.account === signer || m.posting.includes(signer)) ?? null;

/** An admin flag: the owner has all; role 1 needs the bit; role 0 has none (0011 "Admin flags only take effect for role ≥ 1"). */
export const can = (member: Member2 | null, flag: number): boolean =>
  !!member && (member.role === ROLES.owner || (member.role >= ROLES.admin && (member.permissions & flag) === flag));

export const canPost = (member: Member2 | null): boolean => !!member && (member.role === ROLES.owner || (member.permissions & PERMISSIONS.post) !== 0);

/**
 * May `signer` (a member of `current`) turn `current` into `next`? null when
 * allowed, else the reason. 0011 Rules plus reviewer ruling 5 (a role-0
 * member's permissions need `manage admins`; nobody removes the owner; the
 * owner leaves only by the heir rule). The same checks as pca's.
 */
export const stateChangeRefusal = (current: GroupState, next: GroupState, signer: Member2 | null): string | null => {
  if (!signer || signer.role < ROLES.admin) return 'not-admin';
  const isOwner = signer.role === ROLES.owner;
  const before = new Map(current.members.map(m => [m.account, m]));
  const after = new Map(next.members.map(m => [m.account, m]));
  const added = next.members.filter(m => !before.has(m.account));
  const removed = current.members.filter(m => !after.has(m.account));
  if (added.length > 0 && !can(signer, PERMISSIONS.add) && !can(signer, PERMISSIONS.approve)) return 'no-add';
  if (removed.length > 0 && !can(signer, PERMISSIONS.remove)) return 'no-remove';
  const oldOwner = current.members.find(m => m.role === ROLES.owner);
  const newOwner = next.members.find(m => m.role === ROLES.owner);
  if (!oldOwner || !newOwner) return 'no-owner';
  if (oldOwner.account !== newOwner.account && !isOwner) {
    const heir = current.members
      .filter(m => m.role === ROLES.admin && m.account !== oldOwner.account)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.account < b.account ? -1 : 1))[0];
    if (after.has(oldOwner.account) || heir?.account !== newOwner.account) return 'owner-only';
  }
  for (const m of next.members) {
    const was = before.get(m.account);
    if (!was) {
      if (m.role > ROLES.member && !isOwner && !can(signer, PERMISSIONS.admins)) return 'no-admins';
      continue;
    }
    if (was.role === m.role && was.permissions === m.permissions) continue;
    if (was.account === oldOwner.account || m.role === ROLES.owner) continue;
    if (was.role >= ROLES.admin && !isOwner) return 'owner-only';
    if (!can(signer, PERMISSIONS.admins)) return 'no-admins';
  }
  const info = ['name', 'slowModeSecs', 'joinPolicy', 'historyShare', 'defaultPermissions'] as const;
  const avatarChanged = (current.avatar ? bytesToHex(current.avatar) : null) !== (next.avatar ? bytesToHex(next.avatar) : null);
  if ((avatarChanged || info.some(key => current[key] !== next[key])) && !can(signer, PERMISSIONS.info)) return 'no-info';
  if (current.pinned.join('\n') !== next.pinned.join('\n') && !can(signer, PERMISSIONS.pin)) return 'no-pin';
  const invites = (s: GroupState) =>
    s.invites.map(i => [bytesToHex(i.inviteId), bytesToHex(i.secret), i.createdBy, i.expiresAt, i.maxUses].join(':')).join(',');
  if (invites(current) !== invites(next) && !can(signer, PERMISSIONS.add)) return 'no-invites';
  return null;
};

/** 0011 order: higher epoch, then higher version; at a tie the lower signer account bytes win. */
export const stateWins = (
  candidate: { epoch: number; version: number; signer: HexString },
  current: { epoch: number; version: number; signer: HexString },
): boolean =>
  candidate.epoch !== current.epoch
    ? candidate.epoch > current.epoch
    : candidate.version !== current.version
      ? candidate.version > current.version
      : candidate.signer < current.signer;

/**
 * Who to ask for missing messages (0011 "History on request"): a bot admin
 * first (always online), else the most recently active admin, else a bot,
 * else any member we can reach.
 */
export const historyProvider = (
  state: GroupState,
  self: HexString,
  facts: {
    isBot: (account: HexString) => boolean;
    reachable: (account: HexString) => boolean;
    lastActive: (account: HexString) => number;
  },
): HexString | null => {
  const others = state.members.filter(m => m.account !== self && facts.reachable(m.account));
  const admins = others.filter(m => m.role >= ROLES.admin);
  const byActivity = (list: Member2[]) => [...list].sort((a, b) => facts.lastActive(b.account) - facts.lastActive(a.account));
  return (
    admins.find(m => facts.isBot(m.account))?.account ??
    byActivity(admins)[0]?.account ??
    others.find(m => facts.isBot(m.account))?.account ??
    byActivity(others)[0]?.account ??
    null
  );
};

/** A new admin's flags (M16b): everything but `manage admins`, which the owner grants on purpose. */
export const ADMIN_PERMISSIONS = ALL_PERMISSIONS & ~PERMISSIONS.admins;

/**
 * Slow mode at the receiver hides a role-0 carrier that came sooner than
 * `slowModeSecs` after the member's previous one, by arrival time (0011
 * Limits). Two carriers sent exactly `slowModeSecs` apart can arrive closer
 * than that (network delay), so the receiver allows this much.
 */
export const SLOW_MODE_GRACE_MS = 2000;

/** How long a role-0 member still waits before its next statement under slow mode; 0 when it may send. */
export const slowModeWait = (state: GroupState | null | undefined, me: Member2 | null, lastSentAt: number | undefined, now: number): number =>
  state && me?.role === ROLES.member && state.slowModeSecs > 0 ? Math.max(0, (lastSentAt ?? 0) + state.slowModeSecs * 1000 - now) : 0;

/** The owner leaving without a transfer makes the longest-standing admin the owner (0011 Rules). */
export const heirOf = (state: GroupState): Member2 | null =>
  state.members.filter(m => m.role === ROLES.admin).sort((a, b) => a.joinedAt - b.joinedAt || (a.account < b.account ? -1 : 1))[0] ?? null;

/** The copyable form of an invite link: 0011 puts the SCALE link, base64url, in a URL fragment (`…/g#<b64>`). */
export const INVITE_LINK_PREFIX = 'polkadotapp://g#';
export const inviteLinkText = (link: InviteLink): string => `${INVITE_LINK_PREFIX}${toBase64Url(encodeInviteLink(link))}`;

/**
 * An invite link in anything a person pastes or clicks: `polkadotapp://g#…`,
 * any `…/g#…` URL, or the bare base64url. Null when it is not one.
 */
export const parseInviteLink = (text: string): InviteLink | null => {
  const trimmed = text.trim();
  const token = /(?:^|[/:])g#([A-Za-z0-9_-]+)/.exec(trimmed)?.[1] ?? (/^[A-Za-z0-9_-]{40,}$/.test(trimmed) ? trimmed : null);
  if (!token) return null;
  try {
    return decodeInviteLink(fromBase64Url(token));
  } catch {
    return null;
  }
};

/** 0011 Invite link: a request opener is rich text only, so the capability rides in the text. */
export const joinOpenerText = (groupName: string, inviteId: Uint8Array, proof: Uint8Array): string =>
  `Join request: ${groupName} [grp:${toBase64Url(inviteId)}:${toBase64Url(proof)}]`;

export const parseJoinOpener = (text: string | null): { inviteId: Uint8Array; proof: Uint8Array } | null => {
  const found = /\[grp:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)\]/.exec(text ?? '');
  if (!found) return null;
  try {
    const inviteId = fromBase64Url(found[1]!);
    const proof = fromBase64Url(found[2]!);
    return inviteId.length === 16 && proof.length === 32 ? { inviteId, proof } : null;
  } catch {
    return null;
  }
};

/** The posting additions a new state has not recorded yet (members still listed only). */
const pendingPosting = (added: GroupRow['postingAdded'], state: GroupState): Record<string, HexString[]> => {
  const out: Record<string, HexString[]> = {};
  for (const [account, list] of Object.entries(added ?? {})) {
    const member = memberOf(state, account as HexString);
    const left = member ? list.filter(p => !member.posting.includes(p)) : [];
    if (left.length > 0) out[account] = left;
  }
  return out;
};

const withPosting = (state: GroupState, added: Record<string, HexString[]>): GroupState =>
  Object.keys(added).length === 0
    ? state
    : {
        ...state,
        members: state.members.map(m => (added[m.account] ? { ...m, posting: [...new Set([...m.posting, ...added[m.account]!])].slice(0, GROUP2_BOUNDS.posting) } : m)),
      };

/** The slow-mode choices of the members panel, in seconds (0 = off). */
export const SLOW_MODE_CHOICES = [0, 10, 30, 60, 300, 900, 3600] as const;
export const slowModeWords = (secs: number): string => (secs % 3600 === 0 ? `${secs / 3600} h` : secs % 60 === 0 ? `${secs / 60} min` : `${secs} s`);
/** 0011 `joinPolicy`, as the members panel says it. */
export const JOIN_POLICY_WORDS: Record<number, string> = { 0: 'admins add members', 1: 'invite link, an admin approves', 2: 'anyone with the invite link' };

/** Why a state change of ours is refused, in words (`stateChangeRefusal` codes). */
const REFUSAL_TEXT: Record<string, string> = {
  'not-admin': 'Only an admin can change this group.',
  'no-add': 'You cannot add members to this group.',
  'no-remove': 'You cannot remove members from this group.',
  'owner-only': 'Only the owner can change an admin or the owner.',
  'no-admins': 'You cannot change roles in this group.',
  'no-info': 'You cannot change this group’s settings.',
  'no-pin': 'You cannot pin messages in this group.',
  'no-invites': 'You cannot create invite links for this group.',
  'no-owner': 'A group needs exactly one owner.',
};

/** Content kinds that never ride inside a carrier; `groupLeave` (248) does (0011 decoder bounds). */
const FORBIDDEN_IN_CARRIER: readonly string[] = ['groupInfo', 'groupMessage', 'groupControl', 'undecodable'];

/**
 * The carrier plaintext for `fresh` (new, oldest first) plus the carry: newest
 * first, until 4096 bytes. Only own messages of `epoch` from the last 24 h ride
 * (reviewer ruling 3: the carry never crosses an epoch). Null when the new
 * messages alone do not fit.
 */
export const buildCarrier = (
  from: HexString,
  fresh: readonly Uint8Array[],
  carry: readonly { bytes: Uint8Array; sentAt: number; epoch: number }[],
  epoch: number,
  now: number,
): { plaintext: Uint8Array; carried: number } | null => {
  const items = [...fresh].reverse();
  if (encodeGroupMessages(from, items).length > GROUP2_BOUNDS.plaintext) return null;
  const kept = carry.filter(item => item.epoch === epoch && now - item.sentAt < CARRY_WINDOW_MS);
  let carried = 0;
  for (const item of [...kept].reverse()) {
    if (encodeGroupMessages(from, [...items, item.bytes]).length > GROUP2_BOUNDS.plaintext) break;
    items.push(item.bytes);
    carried += 1;
  }
  return { plaintext: encodeGroupMessages(from, items), carried };
};

// ── The service ───────────────────────────────────────────────────────────

export type IncomingGroupMessage = {
  messageId: string;
  timestamp: number;
  content: ChatContent;
};

export type GroupsV2Deps = {
  /** Our identity account (the member). */
  self: HexString;
  /** This device's statement account (the signer, one of our posting accounts). */
  signer: HexString;
  ownChatPrivateKey: Uint8Array;
  ownChatPublicKey: Uint8Array;
  /** The metered adapter: a group message counts as one submission. */
  store: StatementStoreAdapter;
  prover: StatementProver;
  /** A peer's identity chat public key (contact row, else the People chain). */
  chatKeyOf: (account: HexString) => Promise<Uint8Array | null>;
  /** A member's extra signer accounts (its devices' statement accounts other than its identity account). */
  postingOf: (account: HexString) => Promise<HexString[]>;
  nameOf: (account: HexString) => Promise<string>;
  isBot: (account: HexString) => Promise<boolean>;
  /** Is there a DM session with this account? */
  reachable: (account: HexString) => boolean;
  /** One kind-249 message over the DM session. */
  sendControl: (peer: HexString, control: GroupControl) => Promise<void>;
  /** A taken message: the manager applies it to the room as a group message from `sender`. */
  applyMessage: (groupId: string, sender: HexString, message: IncomingGroupMessage) => Promise<void>;
  /**
   * M16b: is `account` someone whose `welcome` adds us at once (a contact
   * we chose), rather than a stranger whose welcome shows as an invite?
   * Absent: everyone is trusted (the M16 behaviour).
   */
  trusted?: (account: HexString) => Promise<boolean>;
  /** M16b: did we ask to join this group by a link? Its admin's `welcome` is then expected. */
  joinRequested?: (groupId: string) => Promise<boolean>;
  now?: () => number;
  random?: (length: number) => Uint8Array;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  storage?: GroupsV2Storage;
};

export type GroupStatement = {
  topics?: string[];
  channel?: string;
  data?: Uint8Array;
  proof?: { type: string; value: { signer?: string } };
  expiry?: bigint;
};

type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type Outbox = {
  items: { bytes: Uint8Array; messageId: string; timestamp: number }[];
  waiters: Waiter[];
  timer: ReturnType<typeof setTimeout> | null;
};

export type GroupsV2 = ReturnType<typeof createGroupsV2>;

const lower = (hex: string): HexString => hex.toLowerCase() as HexString;

export const isV2 = (group: GroupRow | undefined | null): group is GroupRow & { v: 2 } => group?.v === 2;

export const createGroupsV2 = (deps: GroupsV2Deps) => {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? randomBytes;
  const log = deps.log ?? (() => undefined);
  const allocator = createGroupExpiryAllocator(now);
  const self = lower(deps.self);
  const ownSigner = lower(deps.signer);

  // topic hex -> where it belongs
  let byTopic = new Map<string, { groupId: string; epoch: number; fork: boolean }>();
  let subscribedKey = '';
  let unsubscribe: VoidFunction = () => undefined;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  const seenStatements = new Set<string>();
  const pending = new Map<string, GroupStatement[]>();
  const lastArrival = new Map<string, number>(); // `${groupId}:${account}` -> ms
  const outboxes = new Map<string, Outbox>();
  // A newcomer's history can arrive before the state it is checked against: held until then.
  const heldHistory = new Map<string, { from: HexString; history: Extract<GroupControl, { tag: 'history' }>['value'] }[]>();

  // Everything that reads and writes a group row runs one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const storage = deps.storage ?? dexieGroupStorage;
  const getRow = (groupId: string) => storage.getGroup(groupId);
  const putRow = (row: GroupRow) => storage.putGroup({ ...row, updatedAt: now() });

  const keyOf = (row: GroupRow, epoch: number, fork = false): GroupEpochKey | undefined => row.keys?.find(k => k.epoch === epoch && !!k.fork === fork);
  const epochOf = (row: GroupRow, epoch: number, fork = false): EpochKeys | null => {
    const key = keyOf(row, epoch, fork);
    return key ? deriveEpoch(key.key, row.id, epoch) : null;
  };
  const currentEpoch = (row: GroupRow): EpochKeys | null => (row.epoch ? epochOf(row, row.epoch) : null);

  const note = (groupId: string, id: string, text: string, at = now()) => storage.addSystemRow(groupSystemRow(groupId, id, at, text));

  // ── Topic index and the one subscription ────────────────────────────────

  const reindex = async (): Promise<void> => {
    const next = new Map<string, { groupId: string; epoch: number; fork: boolean }>();
    for (const row of await storage.listGroups()) {
      if (!isV2(row) || row.self !== 'member') continue;
      for (const key of row.keys ?? [])
        next.set(bytesToHex(deriveEpoch(key.key, row.id, key.epoch).topic), {
          groupId: row.id,
          epoch: key.epoch,
          fork: !!key.fork,
        });
    }
    byTopic = next;
    if (stopped) return;
    const topics = [...next.keys()].sort();
    const setKey = topics.join(',');
    if (setKey === subscribedKey) return;
    const added = topics.filter(topic => !subscribedKey.includes(topic));
    subscribedKey = setKey;
    unsubscribe();
    unsubscribe = () => undefined;
    if (topics.length === 0) return;
    // One filter for every group (a node takes up to 128 topics per filter).
    unsubscribe = deps.store.subscribeStatements({ matchAny: topics.map(hexToBytes) }, page => {
      for (const statement of page.statements) void receive(statement as GroupStatement);
    });
    if (added.length > 0) await sweep(added);
  };

  /**
   * Reads the store for `topics` now (a new topic, a reconnect, and every 30 s
   * as a safety net). Runs inside `serial` (it calls `receiveNow`).
   */
  const sweep = async (topics: string[] = [...byTopic.keys()]): Promise<void> => {
    for (let i = 0; i < topics.length; i += 128) {
      const result = await deps.store.queryStatements({
        matchAny: topics.slice(i, i + 128).map(hexToBytes),
      });
      if (result.isErr()) {
        log('GROUP2_SWEEP_FAILED', { error: String(result.error.message) });
        continue;
      }
      for (const statement of result.value) await receiveNow(statement as GroupStatement);
    }
  };

  // ── Submitting ───────────────────────────────────────────────────────────

  const submitData = async (topic: Uint8Array, channel: Uint8Array, data: Uint8Array): Promise<void> => {
    const result = await submitStatementOnce({
      statementStore: deps.store,
      prover: deps.prover,
      allocator,
      channel,
      topics: [topic],
      data,
    });
    if (result.isErr()) {
      // 0011 Unresolved 3, seen live: DM statements never expire and have the
      // higher expiry, so an account full of them has no room for a group statement.
      if (result.error instanceof AccountFullError) throw new Error('Your account’s space on the network is full of chat statements, so a group statement cannot be stored.');
      throw result.error;
    }
  };

  const sealState = async (ep: EpochKeys, state: GroupState) => {
    const plaintext = encodeGroupState(state);
    const sealed = await seal(ep.msgKey, {
      signer: ownSigner,
      epoch: ep.epoch,
      variant: VARIANT.state,
      plaintext,
      nonce: random(12),
    });
    return {
      plaintext,
      data: encodeGroupData({ tag: 'state', value: sealed }),
    };
  };

  const welcomeOf = (row: GroupRow): GroupControl => {
    const key = keyOf(row, row.epoch ?? 0);
    if (!key || !row.state || !row.stateBytes) throw new Error('This group has no key or state to share.');
    return {
      tag: 'welcome',
      value: {
        groupId: row.id,
        epoch: key.epoch,
        epochKey: key.key,
        stateVersion: row.state.version,
        stateHash: hash256(row.stateBytes),
      },
    };
  };

  // ── State ────────────────────────────────────────────────────────────────

  /** The v1 mirror of a state: usernames from what we already know, else the People chain. */
  const rosterOf = async (row: GroupRow, state: GroupState): Promise<GroupMember[]> =>
    Promise.all(
      [...state.members]
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.account < b.account ? -1 : 1))
        .map(async m => ({
          account: m.account,
          username: row.members.find(x => x.account === m.account)?.username ?? (await deps.nameOf(m.account).catch(() => `${m.account.slice(0, 8)}…`)),
          joinedAt: m.joinedAt,
        })),
    );

  /** Stores `state` as the group's truth and writes one room line for what changed. */
  const applyState = async (row: GroupRow, incoming: GroupState, bytes: Uint8Array, signer: HexString): Promise<GroupRow> => {
    const before = row.state ?? null;
    // 0011 Multi-device: a member's `deviceAdded` holds on every receiver until an admin's state records it.
    const postingAdded = pendingPosting(row.postingAdded, incoming);
    const state = withPosting(incoming, postingAdded);
    const members = await rosterOf(row, state);
    const nameOf = (account: HexString) =>
      members.find(m => m.account === account)?.username ?? row.members.find(m => m.account === account)?.username ?? `${account.slice(0, 8)}…`;
    const listed = !!memberOf(state, self);
    const owner = state.members.find(m => m.role === ROLES.owner)?.account ?? row.admin;
    const next: GroupRow = {
      ...row,
      name: state.name,
      admin: owner,
      members,
      version: state.version,
      createdAt: row.state ? row.createdAt : state.createdAt,
      state,
      stateBytes: bytes,
      stateSigner: signer,
      pendingWelcome: null,
      postingAdded,
      self: listed ? (row.self === 'left' ? 'left' : 'member') : row.self === 'left' ? 'left' : 'removed',
      ...(listed ? {} : { keys: [], carry: [], locked: false }),
    };
    await putRow(next);
    await storage.ensureRoom(row.id, now());
    const actor = signer === ownSigner ? 'You' : nameOf(memberBySigner(state, signer)?.account ?? memberBySigner(before, signer)?.account ?? signer);
    const lines: string[] = [];
    if (!before) {
      if (signer !== ownSigner) lines.push(`${nameOf(owner)} added you to ${state.name}`);
    } else {
      for (const m of state.members) if (!memberOf(before, m.account)) lines.push(`${actor} added ${nameOf(m.account)}`);
      for (const m of before.members) {
        if (memberOf(state, m.account)) continue;
        lines.push(m.account === self ? `${actor} removed you` : `${actor} removed ${nameOf(m.account)}`);
      }
      if (state.name !== before.name) lines.push(`${actor} renamed the group to ${state.name}`);
      for (const m of state.members) {
        const was = memberOf(before, m.account);
        if (!was || was.role === m.role) continue;
        const who = m.account === self ? 'you' : nameOf(m.account);
        if (m.role === ROLES.owner) lines.push(`${m.account === self ? 'You are' : `${nameOf(m.account)} is`} now the owner`);
        else if (m.role === ROLES.admin) lines.push(`${actor} made ${who} an admin`);
        else lines.push(`${actor} made ${who} a member`);
      }
      const newlyPinned = state.pinned.filter(id => !before.pinned.includes(id));
      if (newlyPinned.length > 0) lines.push(`${actor} pinned a message`);
      else if (before.pinned.some(id => !state.pinned.includes(id))) lines.push(`${actor} unpinned a message`);
      if (state.slowModeSecs !== before.slowModeSecs)
        lines.push(state.slowModeSecs > 0 ? `${actor} turned on slow mode: one message every ${slowModeWords(state.slowModeSecs)}` : `${actor} turned off slow mode`);
      if (state.joinPolicy !== before.joinPolicy) lines.push(`${actor} changed who can join: ${JOIN_POLICY_WORDS[state.joinPolicy] ?? 'unknown'}`);
      if (state.historyShare !== before.historyShare)
        lines.push(state.historyShare > 0 ? `${actor} shares recent history with new members` : `${actor} stopped sharing history with new members`);
    }
    if (lines.length > 0) await note(row.id, `group2-state:${row.id}:${state.epoch}:${state.version}`, lines.join(' · '));
    log('GROUP2_STATE', {
      group: row.id,
      epoch: state.epoch,
      version: state.version,
      members: state.members.length,
      listed,
    });
    return next;
  };

  const receiveState = async (row: GroupRow, epoch: number, signer: HexString, plaintext: Uint8Array): Promise<string> => {
    const state = decodeGroupState(plaintext);
    if (state.groupId !== row.id || state.epoch !== epoch) return 'wrong-group-or-epoch';
    if (!row.state) {
      const welcome = row.pendingWelcome;
      if (!welcome) return 'no-welcome';
      const matches = welcome.epoch === epoch && bytesEqual(hash256(plaintext), welcome.stateHash);
      // The welcomer may already have posted a newer version: its own later state counts too.
      const newer = welcome.epoch === epoch && memberBySigner(state, signer)?.account === welcome.from && state.version >= welcome.stateVersion;
      if (!matches && !newer) return 'hash-mismatch';
      if ((memberOf(state, welcome.from)?.role ?? -1) < ROLES.admin) return 'welcomer-not-admin';
      await applyState(row, state, plaintext, signer);
      return 'applied';
    }
    const current = row.state;
    if (row.stateBytes && bytesEqual(plaintext, row.stateBytes)) return 'duplicate';
    if (
      !stateWins(
        { epoch: state.epoch, version: state.version, signer },
        {
          epoch: current.epoch,
          version: current.version,
          signer: row.stateSigner ?? signer,
        },
      )
    )
      return 'stale';
    const refusal = stateChangeRefusal(current, state, memberBySigner(current, signer));
    if (refusal) return refusal;
    await applyState(row, state, plaintext, signer);
    return 'applied';
  };

  // ── Carriers in ──────────────────────────────────────────────────────────

  const receiveMessages = async (row: GroupRow, signer: HexString, plaintext: Uint8Array): Promise<string> => {
    if (row.self !== 'member' || !row.state) return 'not-member';
    const carrier = decodeGroupMessages(plaintext);
    const member = memberOf(row.state, carrier.from);
    if (!member) return 'non-member';
    if (signer !== member.account && !member.posting.includes(signer)) return 'bad-signer';
    const decoded: IncomingGroupMessage[] = [];
    for (const bytes of carrier.messages) {
      try {
        const message = ChatMessageCodec.dec(bytes);
        const content = message.versioned.value;
        if (FORBIDDEN_IN_CARRIER.includes(content.tag)) continue;
        decoded.push({
          messageId: message.messageId,
          timestamp: Number(message.timestamp),
          content,
        });
      } catch {
        // One item we cannot read does not spoil the rest.
      }
    }
    const leaveOnly = decoded.length > 0 && decoded.every(m => m.content.tag === 'groupLeave');
    if (!canPost(member) && !leaveOnly) return 'no-post';
    const arrivalKey = `${row.id}:${member.account}`;
    const previous = lastArrival.get(arrivalKey);
    // Slow mode is the sender's job; a receiver hides a role-0 carrier that came too soon (0011 Limits).
    if (
      member.role === ROLES.member &&
      row.state.slowModeSecs > 0 &&
      !leaveOnly &&
      previous !== undefined &&
      now() - previous < row.state.slowModeSecs * 1000 - SLOW_MODE_GRACE_MS
    ) {
      return 'slow-mode';
    }
    lastArrival.set(arrivalKey, now());
    const seen = new Set(row.seenIds ?? []);
    const fresh: IncomingGroupMessage[] = [];
    let knownInCarrier = false;
    // Newest first on the wire; applied oldest first.
    for (const message of [...decoded].reverse()) {
      const id = `${member.account}:${message.messageId}`;
      if (seen.has(id)) {
        knownInCarrier = true;
        continue;
      }
      seen.add(id);
      fresh.push(message);
    }
    if (fresh.length === 0) return 'duplicate';
    const senders = new Set(row.senders ?? []);
    // 0009 gap rule by messageId: a known sender whose carrier holds nothing we
    // took before sent more than the carry kept.
    const gap = !knownInCarrier && senders.has(member.account) && !row.gapNoted;
    senders.add(member.account);
    const updated: GroupRow = {
      ...row,
      seenIds: [...seen].slice(-SEEN_IDS),
      senders: [...senders],
      gapNoted: row.gapNoted || gap,
    };
    await putRow(updated);
    if (gap) {
      const first = Math.min(...fresh.map(m => m.timestamp));
      await note(row.id, `group-gap:${row.id}`, 'Some messages may be missing', first - 1);
      void requestHistory(row.id).catch(error =>
        log('GROUP2_HISTORY_REQUEST_FAILED', {
          group: row.id,
          error: String(error),
        }),
      );
    }
    let latest = updated;
    for (const message of fresh) {
      if (message.content.tag === 'groupLeave') {
        await onLeave(latest, member, message);
        continue;
      }
      if (message.content.tag === 'deviceAdded' || message.content.tag === 'deviceRemoved') {
        latest = await onDevice(latest, member, message.content);
        continue;
      }
      await deps.applyMessage(row.id, member.account, message);
    }
    return 'accepted';
  };

  const onLeave = async (row: GroupRow, member: Member2, message: IncomingGroupMessage): Promise<void> => {
    const name = row.members.find(m => m.account === member.account)?.username ?? `${member.account.slice(0, 8)}…`;
    await note(row.id, `group-leave:${member.account}:${message.messageId}`, `${name} left`, message.timestamp);
    // 0011 Leave: the first admin with `remove members` that sees it removes the member.
    // The owner's leave also hands the group to the longest-standing admin (the heir rule).
    if (!can(memberOf(row.state, self), PERMISSIONS.remove)) return;
    if (member.role === ROLES.owner && (!row.state || !heirOf(row.state))) return;
    await rekeyLocked(row.id, member.account, { heir: member.role === ROLES.owner }).catch(error => log('GROUP2_REMOVE_FAILED', { group: row.id, error: String(error) }));
  };

  /**
   * 0011 Multi-device: a `deviceAdded` in member X's own carrier (so signed
   * by one of X's posting accounts) adds that account to X's posting set on
   * this receiver; `deviceRemoved` takes it out. An account another member
   * already signs with is never taken.
   */
  const onDevice = async (
    row: GroupRow,
    member: Member2,
    content: Extract<ChatContent, { tag: 'deviceAdded' | 'deviceRemoved' }>,
  ): Promise<GroupRow> => {
    if (!row.state) return row;
    const account = bytesToHex(content.value.statementAccountId);
    const added = { ...(row.postingAdded ?? {}) };
    const mine = new Set(added[member.account] ?? []);
    if (content.tag === 'deviceAdded') {
      const taken = row.state.members.some(m => m.account !== member.account && (m.account === account || m.posting.includes(account)));
      if (taken || account === member.account || memberOf(row.state, member.account)?.posting.includes(account)) return row;
      if (mine.size + member.posting.length >= GROUP2_BOUNDS.posting) return row;
      mine.add(account);
    } else mine.delete(account);
    added[member.account] = [...mine];
    const state: GroupState = {
      ...row.state,
      members: row.state.members.map(m =>
        m.account !== member.account
          ? m
          : { ...m, posting: content.tag === 'deviceAdded' ? [...new Set([...m.posting, account])] : m.posting.filter(p => p !== account) },
      ),
    };
    const next: GroupRow = { ...row, state, postingAdded: added };
    await putRow(next);
    log('GROUP2_DEVICE', { group: row.id, member: member.account, device: account, change: content.tag });
    return next;
  };

  // ── Rekey in ─────────────────────────────────────────────────────────────

  const receiveRekey = async (row: GroupRow, epoch: number, signer: HexString, rekey: Rekey): Promise<string> => {
    if (rekey.newEpoch <= epoch) return 'bad-epoch';
    // Out of our current epoch, or a second rekey into an epoch we already opened (a fork).
    if (epoch !== row.epoch && !keyOf(row, rekey.newEpoch)) return 'old-epoch';
    const admin = memberBySigner(row.state, signer);
    if (!admin || admin.role < ROLES.admin) return 'not-admin';
    const peerKey = admin.account === self ? deps.ownChatPublicKey : await deps.chatKeyOf(admin.account);
    const kab = peerKey ? pairwiseKey(peerKey) : null;
    const key = kab
      ? await openRekeyEntry(kab, {
          groupId: row.id,
          newEpoch: rekey.newEpoch,
          entries: rekey.entries,
        })
      : null;
    if (!key) {
      if (!memberOf(row.state, self) || keyOf(row, rekey.newEpoch)) return kab ? 'no-entry' : 'no-pairwise-key';
      const first = !row.locked;
      const ask = now() - (row.keyRequestedAt ?? 0) > KEY_REQUEST_EVERY_MS;
      await putRow({
        ...row,
        locked: true,
        ...(ask ? { keyRequestedAt: now() } : {}),
      });
      if (first)
        await note(
          row.id,
          `group2-locked:${row.id}:${rekey.newEpoch}`,
          'The group key changed without you. You may have been removed; an admin can send it again.',
        );
      // 0011 Missed rekey: still listed, so ask that admin for the key.
      if (ask && deps.reachable(admin.account)) {
        await deps
          .sendControl(admin.account, {
            tag: 'keyRequest',
            value: { groupId: row.id, haveEpoch: row.epoch ?? 0 },
          })
          .catch(error => log('GROUP2_KEY_REQUEST_FAILED', { error: String(error) }));
      }
      return kab ? 'no-entry' : 'no-pairwise-key';
    }
    const existing = keyOf(row, rekey.newEpoch);
    if (existing) {
      if (bytesEqual(existing.key, key)) return 'duplicate';
      // Fork: the lower signer wins; the other key stays readable for 24 h.
      const winnerIsNew = signer < existing.signer;
      const keys = (row.keys ?? []).filter(k => !(k.epoch === rekey.newEpoch));
      const fresh: GroupEpochKey = {
        epoch: rekey.newEpoch,
        key,
        openedAt: now(),
        erasesAt: null,
        signer,
      };
      keys.push(winnerIsNew ? fresh : existing, {
        ...(winnerIsNew ? existing : fresh),
        fork: true,
        erasesAt: now() + FORK_KEEP_MS,
      });
      await putRow({ ...row, keys });
      await reindex();
      log('GROUP2_REKEY_FORK', { group: row.id, epoch: rekey.newEpoch });
      return 'fork';
    }
    await putRow(withKey(row, rekey.newEpoch, key, signer));
    await reindex();
    log('GROUP2_REKEYED', { group: row.id, epoch: rekey.newEpoch });
    return 'rekeyed';
  };

  /** K(A, B): the raw X25519 agreement of the identity chat keys (reviewer ruling 4). */
  const pairwiseKey = (peerChatPublicKey: Uint8Array): Uint8Array => pairwiseSecret(deps.ownChatPrivateKey, peerChatPublicKey);

  /** Adds an epoch key; a newer epoch becomes current and starts the 14-day clock on the old one. */
  const withKey = (row: GroupRow, epoch: number, key: Uint8Array, signer: HexString): GroupRow => {
    const keys = (row.keys ?? []).filter(k => k.epoch !== epoch || k.fork);
    const newer = epoch > (row.epoch ?? 0);
    const aged = keys.map(k => (newer && k.epoch === row.epoch && !k.fork ? { ...k, erasesAt: now() + OLD_KEY_KEEP_MS } : k));
    aged.push({ epoch, key, openedAt: now(), erasesAt: null, signer });
    return {
      ...row,
      keys: aged,
      ...(newer ? { epoch, rotateAt: null, locked: false } : {}),
    };
  };

  // ── One statement in ─────────────────────────────────────────────────────

  const receive = (statement: GroupStatement): Promise<string> => serial(() => receiveNow(statement));

  const receiveNow = async (statement: GroupStatement): Promise<string> => {
    const topic = (statement.topics ?? []).map(lower).find(t => byTopic.has(t));
    if (!topic || !statement.data) return 'unknown-topic';
    const where = byTopic.get(topic)!;
    const signer = lower(statement.proof?.value.signer ?? '');
    if (signer === ownSigner) return 'own';
    const dedup = `${signer}|${statement.channel ?? ''}|${String(statement.expiry ?? '')}|${statement.data.length}`;
    if (seenStatements.has(dedup)) return 'seen';
    const row = await getRow(where.groupId);
    if (!row || !isV2(row)) return 'unknown-group';
    const ep = epochOf(row, where.epoch, where.fork);
    if (!ep) return 'no-key';
    let outcome: string;
    try {
      const data = decodeGroupData(statement.data);
      const expected = data.tag === 'messages' ? ep.channels.msgs : data.tag === 'state' ? ep.channels.state : ep.channels.rekey;
      if (lower(statement.channel ?? '') !== bytesToHex(expected)) return 'wrong-channel';
      if (data.tag !== 'state' && !row.state) {
        // The state names who may speak: hold the rest until it arrives.
        const held = pending.get(row.id) ?? [];
        if (held.length < PENDING_PER_GROUP) held.push(statement);
        pending.set(row.id, held);
        return 'held';
      }
      if (data.tag === 'rekey') outcome = await receiveRekey(row, where.epoch, signer, data.value);
      else {
        const variant = data.tag === 'state' ? VARIANT.state : VARIANT.messages;
        let plaintext: Uint8Array;
        try {
          plaintext = await open(ep.msgKey, {
            signer,
            epoch: where.epoch,
            variant,
            sealed: data.value,
          });
        } catch {
          return 'unopenable';
        }
        outcome = data.tag === 'state' ? await receiveState(row, where.epoch, signer, plaintext) : await receiveMessages(row, signer, plaintext);
      }
    } catch (error) {
      outcome = 'rejected';
      log('GROUP2_REJECTED', {
        group: row.id,
        error: String(error instanceof Error ? error.message : error),
      });
    }
    seenStatements.add(dedup);
    if (seenStatements.size > 5000) seenStatements.delete(seenStatements.values().next().value as string);
    log('GROUP2_STATEMENT', { group: row.id, epoch: where.epoch, outcome });
    if (outcome === 'applied' || outcome === 'rekeyed' || outcome === 'fork') {
      await reindex();
      const held = pending.get(row.id) ?? [];
      pending.delete(row.id);
      for (const statement of held) void receive(statement);
      const histories = heldHistory.get(row.id) ?? [];
      heldHistory.delete(row.id);
      for (const entry of histories) await onHistory(entry.from, entry.history);
    }
    return outcome;
  };

  // ── Sending ──────────────────────────────────────────────────────────────

  const flush = (groupId: string): Promise<void> =>
    serial(async () => {
      const box = outboxes.get(groupId);
      if (!box) return;
      box.timer = null;
      const items = box.items.splice(0);
      const waiters = box.waiters.splice(0);
      if (items.length === 0) return;
      try {
        const row = await getRow(groupId);
        if (!row || !isV2(row)) throw new Error('This group is not known on this device.');
        const leaveOnly = items.every(item => ChatMessageCodec.dec(item.bytes).versioned.value.tag === 'groupLeave');
        if (row.self !== 'member' || !row.state) throw new Error('You are no longer a member of this group.');
        if (row.locked) throw new Error('Waiting for the new group key from an admin.');
        const me = memberOf(row.state, self);
        if (!canPost(me) && !leaveOnly) throw new Error('You cannot post in this group.');
        const since = now() - (row.lastSentAt ?? 0);
        const wait = Math.max(
          since < SEND_INTERVAL_MS ? SEND_INTERVAL_MS - since : 0,
          me?.role === ROLES.member && row.state.slowModeSecs > 0 ? row.state.slowModeSecs * 1000 - since : 0,
        );
        if (wait > 0) {
          // At most one statement per second: whatever queues meanwhile goes with it.
          box.items.unshift(...items);
          box.waiters.unshift(...waiters);
          box.timer = setTimeout(() => void flush(groupId), wait);
          return;
        }
        const ep = currentEpoch(row);
        if (!ep) throw new Error('This group has no key on this device.');
        const t = now();
        const built = buildCarrier(
          self,
          items.map(item => item.bytes),
          row.carry ?? [],
          ep.epoch,
          t,
        );
        if (!built) throw new Error('This message is too large for a group (4 KB).');
        const sealed = await seal(ep.msgKey, {
          signer: ownSigner,
          epoch: ep.epoch,
          variant: VARIANT.messages,
          plaintext: built.plaintext,
          nonce: random(12),
        });
        await submitData(ep.topic, ep.channels.msgs, encodeGroupData({ tag: 'messages', value: sealed }));
        const carry = [
          ...(row.carry ?? []).filter(item => item.epoch === ep.epoch && t - item.sentAt < CARRY_WINDOW_MS),
          ...items.map(item => ({
            messageId: item.messageId,
            timestamp: item.timestamp,
            sentAt: t,
            epoch: ep.epoch,
            bytes: item.bytes,
          })),
        ];
        const seen = [...(row.seenIds ?? []), ...items.map(item => `${self}:${item.messageId}`)].slice(-SEEN_IDS);
        await putRow({ ...row, carry, seenIds: seen, lastSentAt: t });
        for (const item of items) {
          await storage.markSent(item.messageId);
        }
        log('GROUP2_SENT', {
          group: groupId,
          epoch: ep.epoch,
          messages: items.length,
          carried: built.carried,
          bytes: built.plaintext.length,
        });
        for (const waiter of waiters) waiter.resolve();
      } catch (error) {
        for (const waiter of waiters) waiter.reject(error);
      }
    });

  /** Queues one content for the group; resolves when its statement is in the store. */
  const send = (groupId: string, content: ChatContent, ids: { messageId: string; timestamp: number }): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const bytes = ChatMessageCodec.enc({
        messageId: ids.messageId,
        timestamp: BigInt(ids.timestamp),
        versioned: { tag: 'v1', value: content },
      });
      let box = outboxes.get(groupId);
      if (!box) {
        box = { items: [], waiters: [], timer: null };
        outboxes.set(groupId, box);
      }
      box.items.push({
        bytes,
        messageId: ids.messageId,
        timestamp: ids.timestamp,
      });
      box.waiters.push({ resolve, reject });
      // Same task: one statement for everything queued together.
      box.timer ??= setTimeout(() => void flush(groupId), 0);
    });

  // ── Admin actions ────────────────────────────────────────────────────────

  const memberEntry = async (account: HexString, role: number, permissions: number, joinedAt: number): Promise<Member2> => ({
    account,
    role,
    permissions,
    posting: (await deps.postingOf(account).catch(() => [])).filter(p => p !== account).slice(0, GROUP2_BOUNDS.posting),
    joinedAt,
  });

  const welcomeAll = async (row: GroupRow, accounts: readonly HexString[]): Promise<HexString[]> => {
    const unreached: HexString[] = [];
    const welcome = welcomeOf(row);
    for (const account of accounts) {
      if (account === self) continue;
      if (!deps.reachable(account)) {
        unreached.push(account);
        continue;
      }
      await deps.sendControl(account, welcome).catch(error => {
        log('GROUP2_WELCOME_FAILED', {
          group: row.id,
          to: account,
          error: String(error),
        });
        unreached.push(account);
      });
    }
    return unreached;
  };

  /**
   * Opens epoch 1 for `groupId` with `others` as members (role 0, `post`) and
   * us as owner: one state statement on `ChState_1`, then a `welcome` over the
   * DM session to each member we can reach. `base` is the v1 row when a v1 room
   * is upgraded in place (its rows stay). Returns the members not reached.
   */
  const open1 = async (groupId: string, name: string, others: readonly GroupMember[], base: GroupRow | null, createdAt: number): Promise<HexString[]> => {
    const key = random(32);
    const ep = deriveEpoch(key, groupId, 1);
    const members = [
      await memberEntry(self, ROLES.owner, ALL_PERMISSIONS, base?.members.find(m => m.account === self)?.joinedAt ?? createdAt),
      ...(await Promise.all(others.filter(m => m.account !== self).map(m => memberEntry(m.account, ROLES.member, PERMISSIONS.post, m.joinedAt)))),
    ];
    if (members.length > GROUP_MEMBER_CAP) throw new Error(`A group has at most ${GROUP_MEMBER_CAP} members.`);
    const state: GroupState = {
      groupId,
      epoch: 1,
      version: 1,
      name,
      avatar: undefined,
      defaultPermissions: PERMISSIONS.post,
      slowModeSecs: 0,
      // 0011 ruling 10: a new group takes joins by link with approval; an upgraded v1 room keeps "admins add".
      joinPolicy: base ? 0 : 1,
      historyShare: 0,
      members,
      invites: [],
      pinned: [],
      topics: undefined,
      createdAt,
    };
    const { plaintext, data } = await sealState(ep, state);
    await submitData(ep.topic, ep.channels.state, data);
    const roster: GroupMember[] = [
      {
        account: self,
        username: base?.members.find(m => m.account === self)?.username ?? (await deps.nameOf(self).catch(() => 'You')),
        joinedAt: members[0]!.joinedAt,
      },
      ...others.filter(m => m.account !== self),
    ];
    const row: GroupRow = {
      ...(base ?? {
        left: [],
        invites: [],
        nextSeq: 1,
        lastSeq: {},
        gapNoted: false,
      }),
      id: groupId,
      name,
      admin: self,
      members: roster,
      version: 1,
      createdAt,
      self: 'member',
      updatedAt: now(),
      v: 2,
      epoch: 1,
      state,
      stateBytes: plaintext,
      stateSigner: ownSigner,
      keys: [{ epoch: 1, key, openedAt: now(), erasesAt: null, signer: ownSigner }],
      carry: [],
      pendingWelcome: null,
      locked: false,
      seenIds: [],
      senders: [],
      lastSentAt: 0,
      rotateAt: null,
    };
    await putRow(row);
    await storage.ensureRoom(groupId, now());
    await note(groupId, `group2-open:${groupId}`, base ? 'You upgraded this group to a private group' : `You created ${name}`);
    await reindex();
    return welcomeAll(
      row,
      roster.map(m => m.account),
    );
  };

  /** The epoch change: K_{e+1}, an entry per remaining member, rekey on Topic_e, the new state on Topic_{e+1}. */
  const rekeyLocked = async (groupId: string, remove: HexString | null, options: { heir?: boolean } = {}): Promise<{ epoch: number; missing: HexString[] }> => {
    const row = await getRow(groupId);
    if (!row || !isV2(row) || !row.state) throw new Error('This group is not known on this device.');
    const me = memberOf(row.state, self);
    if (!can(me, PERMISSIONS.remove)) throw new Error('Only an admin who may remove members can do this.');
    if (remove) {
      const target = memberOf(row.state, remove);
      if (!target) throw new Error('That account is not a member.');
      // Only the owner's own leave takes the owner out, and the heir takes over (0011 Rules).
      if (target.role === ROLES.owner && !options.heir) throw new Error('Nobody removes the owner.');
      if (target.role === ROLES.admin && me?.role !== ROLES.owner) throw new Error('Only the owner removes an admin.');
    }
    const old = currentEpoch(row);
    if (!old) throw new Error('This group has no key on this device.');
    const newEpoch = old.epoch + 1;
    const newKey = random(32);
    const heir = options.heir ? heirOf(row.state) : null;
    if (options.heir && !heir) throw new Error('This group has no admin to become the owner.');
    const remaining = row.state.members
      .filter(m => m.account !== remove)
      .map(m => (m.account === heir?.account ? { ...m, role: ROLES.owner, permissions: ALL_PERMISSIONS } : m));
    const entries = [];
    const missing: HexString[] = [];
    for (const m of remaining) {
      const peerKey = m.account === self ? deps.ownChatPublicKey : await deps.chatKeyOf(m.account).catch(() => null);
      if (!peerKey) {
        missing.push(m.account);
        continue;
      }
      entries.push(
        await makeRekeyEntry(pairwiseKey(peerKey), {
          groupId,
          newEpoch,
          newKey,
          nonce: random(12),
        }),
      );
    }
    await submitData(old.topic, old.channels.rekey, encodeGroupData({ tag: 'rekey', value: { newEpoch, entries } }));
    const rekeyed = withKey(row, newEpoch, newKey, ownSigner);
    const next = deriveEpoch(newKey, groupId, newEpoch);
    const state: GroupState = {
      ...row.state,
      epoch: newEpoch,
      version: row.state.version + 1,
      members: remaining,
    };
    const { plaintext, data } = await sealState(next, state);
    await submitData(next.topic, next.channels.state, data);
    await applyState({ ...rekeyed, carry: [] }, state, plaintext, ownSigner);
    await reindex();
    log('GROUP2_EPOCH_OPENED', {
      group: groupId,
      epoch: newEpoch,
      removed: remove,
      entries: entries.length,
      missing: missing.length,
    });
    return { epoch: newEpoch, missing };
  };

  // ── Pairwise control in ─────────────────────────────────────────────────

  const onWelcome = async (from: HexString, w: Extract<GroupControl, { tag: 'welcome' }>['value']): Promise<string> => {
    const existing = await getRow(w.groupId);
    let row: GroupRow;
    if (existing && isV2(existing) && existing.state) {
      if ((memberOf(existing.state, from)?.role ?? -1) < ROLES.admin) return 'not-admin';
      if (keyOf(existing, w.epoch)) return 'duplicate';
      row = withKey({ ...existing, self: existing.self === 'left' ? 'left' : 'member' }, w.epoch, w.epochKey, from);
      row = { ...row, locked: false };
    } else if (existing && !isV2(existing)) {
      // A v1 room upgrades in place on its admin's welcome (0011 Compatibility).
      if (existing.admin !== from) return 'not-admin';
      row = {
        ...existing,
        v: 2,
        epoch: w.epoch,
        keys: [
          {
            epoch: w.epoch,
            key: w.epochKey,
            openedAt: now(),
            erasesAt: null,
            signer: from,
          },
        ],
        state: null,
        stateBytes: null,
        stateSigner: null,
        pendingWelcome: {
          from,
          epoch: w.epoch,
          stateVersion: w.stateVersion,
          stateHash: w.stateHash,
        },
        carry: [],
        seenIds: [],
        senders: [],
        locked: false,
      };
    } else {
      // Review M16 answer 5: a welcome from a contact adds the group at once;
      // from a stranger it waits as an invite. A group we asked to join is expected.
      const asked = (await deps.joinRequested?.(w.groupId)) ?? false;
      const invited = existing?.self !== 'member' && !asked && !((await deps.trusted?.(from)) ?? true);
      row = {
        ...(existing ?? {
          id: w.groupId,
          name: '',
          admin: from,
          members: [],
          version: 0,
          createdAt: now(),
          left: [],
          invites: [],
          nextSeq: 1,
          lastSeq: {},
          gapNoted: false,
          updatedAt: now(),
        }),
        self: invited ? 'invited' : 'member',
        invitedBy: invited ? { account: from, username: await deps.nameOf(from).catch(() => `${from.slice(0, 8)}…`), at: now() } : null,
        v: 2,
        epoch: w.epoch,
        keys: [
          {
            epoch: w.epoch,
            key: w.epochKey,
            openedAt: now(),
            erasesAt: null,
            signer: from,
          },
        ],
        state: null,
        stateBytes: null,
        stateSigner: null,
        pendingWelcome: {
          from,
          epoch: w.epoch,
          stateVersion: w.stateVersion,
          stateHash: w.stateHash,
        },
        carry: [],
        seenIds: [],
        senders: [],
        locked: false,
      };
    }
    await putRow(row);
    if (row.self === 'invited') {
      // Nothing is subscribed or sent until the person accepts; the state is read once, for the group's name.
      await storage.ensureRoom(row.id, now());
      await note(row.id, `group2-invited:${row.id}`, `${row.invitedBy?.username ?? 'Someone'} invited you to this group`);
      await peekName(row, w);
      log('GROUP2_INVITED', { group: w.groupId, from, epoch: w.epoch });
      return 'invited';
    }
    await reindex();
    // The state (and anything said so far) is on the topic now; read it at once.
    await sweep([bytesToHex(deriveEpoch(w.epochKey, w.groupId, w.epoch).topic)]);
    log('GROUP2_WELCOME', { group: w.groupId, from, epoch: w.epoch });
    return existing ? 'rekeyed' : 'welcomed';
  };

  /** An invite's group name, from the state its welcome names (read once; the topic is not watched). */
  const peekName = async (row: GroupRow, w: Extract<GroupControl, { tag: 'welcome' }>['value']): Promise<void> => {
    const ep = deriveEpoch(w.epochKey, w.groupId, w.epoch);
    const result = await deps.store.queryStatements({ matchAny: [ep.topic] });
    if (result.isErr()) return;
    for (const statement of result.value as GroupStatement[]) {
      if (!statement.data || lower(statement.channel ?? '') !== bytesToHex(ep.channels.state)) continue;
      try {
        const data = decodeGroupData(statement.data);
        if (data.tag !== 'state') continue;
        const plaintext = await open(ep.msgKey, { signer: lower(statement.proof?.value.signer ?? ''), epoch: w.epoch, variant: VARIANT.state, sealed: data.value });
        if (!bytesEqual(hash256(plaintext), w.stateHash)) continue;
        await putRow({ ...row, name: decodeGroupState(plaintext).name });
        return;
      } catch {
        // Not the welcome's state: try the next one.
      }
    }
  };

  const onKeyRequest = async (from: HexString, request: Extract<GroupControl, { tag: 'keyRequest' }>['value']): Promise<string> => {
    const row = await getRow(request.groupId);
    if (!row || !isV2(row) || !row.state || row.self !== 'member') return 'unknown-group';
    if ((memberOf(row.state, self)?.role ?? 0) < ROLES.admin) return 'not-admin';
    if (!memberOf(row.state, from)) return 'not-listed';
    await deps.sendControl(from, welcomeOf(row));
    return 'welcomed';
  };

  /** The remote message bytes of a stored row, when it is something a carrier can hold again. */
  const messageBytesOf = (row: MessageRow, carry: ReadonlyMap<string, Uint8Array>): Uint8Array | null => {
    const own = carry.get(row.messageId);
    if (own) return own;
    const content = row.content;
    const value: ChatContent | null =
      content.type === 'text'
        ? { tag: 'text', value: content.text }
        : content.type === 'reply'
          ? {
              tag: 'reply',
              value: {
                messageId: content.messageId,
                ownContent: { text: content.text, attachments: undefined },
              },
            }
          : null;
    return value
      ? ChatMessageCodec.enc({
          messageId: row.messageId,
          timestamp: BigInt(row.timestamp),
          versioned: { tag: 'v1', value },
        })
      : null;
  };

  /** Pages of at most 4 KB each (as an encoded message), newest first, at most `limit` messages. */
  const historyPages = async (row: GroupRow, asker: Member2, since: HistorySinceWire, limit: number): Promise<GroupControl[]> => {
    const carry = new Map((row.carry ?? []).map(item => [item.messageId, item.bytes]));
    let rows = (await storage.listRows(row.id)).filter(r => r.direction === 'incoming' || r.direction === 'outgoing');
    if (since.tag === 'messageId') {
      const at = rows.findIndex(r => r.messageId === since.value);
      rows = at >= 0 ? rows.slice(at + 1) : rows;
    } else rows = rows.filter(r => r.timestamp > since.value);
    // Reviewer ruling 2: with historyShare 0 nothing from before the asker joined.
    if (row.state?.historyShare === 0) rows = rows.filter(r => r.timestamp >= asker.joinedAt);
    const items = rows
      .reverse()
      .map(r => ({
        from: r.direction === 'outgoing' ? self : (r.senderAccountId ?? null),
        message: messageBytesOf(r, carry),
      }))
      .filter((item): item is { from: HexString; message: Uint8Array } => item.from !== null && item.message !== null)
      .slice(0, Math.min(limit, HISTORY_LIMIT));
    const size = (list: typeof items) =>
      ChatMessageCodec.enc({
        messageId: crypto.randomUUID(),
        timestamp: BigInt(now()),
        versioned: {
          tag: 'v1',
          value: {
            tag: 'groupControl',
            value: {
              tag: 'history',
              value: { groupId: row.id, items: list, last: true },
            },
          },
        },
      }).length + compact.enc(4096).length;
    const pages: (typeof items)[] = [];
    let page: typeof items = [];
    for (const item of items) {
      if (size([item]) > HISTORY_PAGE_BYTES) continue;
      if (page.length > 0 && size([...page, item]) > HISTORY_PAGE_BYTES) {
        pages.push(page);
        page = [];
      }
      page.push(item);
    }
    pages.push(page);
    return pages.map((list, i) => ({
      tag: 'history',
      value: { groupId: row.id, items: list, last: i === pages.length - 1 },
    }));
  };

  const onHistoryRequest = async (from: HexString, request: Extract<GroupControl, { tag: 'historyRequest' }>['value']): Promise<string> => {
    const row = await getRow(request.groupId);
    const asker = row && isV2(row) ? memberOf(row.state, from) : null;
    if (!row || !asker) return 'not-member';
    for (const page of await historyPages(row, asker, request.since, request.limit)) await deps.sendControl(from, page);
    return 'answered';
  };

  const onHistory = async (from: HexString, history: Extract<GroupControl, { tag: 'history' }>['value']): Promise<string> => {
    const row = await getRow(history.groupId);
    if (row && isV2(row) && !row.state && row.pendingWelcome && row.self === 'member') {
      // A newcomer: the admitter's history can overtake the state it is checked against.
      const held = heldHistory.get(row.id) ?? [];
      if (held.length < PENDING_PER_GROUP) held.push({ from, history });
      heldHistory.set(row.id, held);
      return 'held';
    }
    if (!row || !isV2(row) || !row.state || row.self !== 'member' || !memberOf(row.state, from)) return 'not-member';
    const seen = new Set(row.seenIds ?? []);
    let shared = 0;
    let oldest = Number.POSITIVE_INFINITY;
    for (const item of [...history.items].reverse()) {
      if (!memberOf(row.state, item.from)) continue;
      let message;
      try {
        message = ChatMessageCodec.dec(item.message);
      } catch {
        continue;
      }
      const content = message.versioned.value;
      if (FORBIDDEN_IN_CARRIER.includes(content.tag) || content.tag === 'groupLeave') continue;
      // The line counts what the sharer sent, also what the carriers (24 h) brought first.
      shared += 1;
      oldest = Math.min(oldest, Number(message.timestamp));
      const id = `${item.from}:${message.messageId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (item.from !== self)
        await deps.applyMessage(row.id, item.from, {
          messageId: message.messageId,
          timestamp: Number(message.timestamp),
          content,
        });
    }
    const latest = (await getRow(row.id)) ?? row;
    await putRow({ ...latest, seenIds: [...seen].slice(-SEEN_IDS) });
    if (shared > 0) {
      const name = row.members.find(m => m.account === from)?.username ?? `${from.slice(0, 8)}…`;
      // Just above the oldest shared message, so it heads what it brought (one line per sharer).
      await note(row.id, `group2-history:${row.id}:${from}:${oldest}`, `History shared by ${name}`, oldest - 1);
    }
    return history.last ? 'done' : 'page';
  };

  /** Asks one member for our missing messages (0011 "History on request"). Returns who was asked. */
  const requestHistory = async (groupId: string, to?: HexString, since?: HistorySinceWire): Promise<HexString | null> => {
    const row = await getRow(groupId);
    if (!row || !isV2(row) || !row.state) return null;
    const bots = new Set<HexString>();
    for (const m of row.state.members) if (await deps.isBot(m.account).catch(() => false)) bots.add(m.account);
    const provider =
      to ??
      historyProvider(row.state, self, {
        isBot: account => bots.has(account),
        reachable: deps.reachable,
        lastActive: account => lastArrival.get(`${groupId}:${account}`) ?? 0,
      });
    if (!provider) return null;
    const joinedAt = memberOf(row.state, self)?.joinedAt ?? 0;
    const newest = (await storage.listRows(groupId)).filter(r => r.direction !== 'system').at(-1);
    const from: HistorySinceWire = since ?? {
      tag: 'timestamp',
      value: Math.max(joinedAt, newest ? newest.timestamp - CARRY_WINDOW_MS : joinedAt),
    };
    await deps.sendControl(provider, {
      tag: 'historyRequest',
      value: { groupId, since: from, limit: HISTORY_LIMIT },
    });
    return provider;
  };

  // ── State changes by us (M16b) ───────────────────────────────────────────

  /**
   * One state statement on the current epoch: `change` gets the current
   * state and returns the next one (without the version bump). Refused here,
   * before anything is sent, when our role does not allow it: receivers would
   * refuse it too (`stateChangeRefusal`).
   */
  const changeStateLocked = async (groupId: string, change: (state: GroupState) => GroupState, roster?: GroupMember[]): Promise<GroupRow> => {
    const row = await getRow(groupId);
    if (!row || !isV2(row) || !row.state) throw new Error('This group is not known on this device.');
    if (row.self !== 'member') throw new Error('You are no longer a member of this group.');
    const ep = currentEpoch(row);
    if (!ep) throw new Error('This group has no key on this device.');
    const state: GroupState = { ...change(row.state), version: row.state.version + 1 };
    const refusal = stateChangeRefusal(row.state, state, memberOf(row.state, self));
    if (refusal) throw new Error(REFUSAL_TEXT[refusal] ?? 'You cannot make this change in this group.');
    const { plaintext, data } = await sealState(ep, state);
    await submitData(ep.topic, ep.channels.state, data);
    return applyState(roster ? { ...row, members: roster } : row, state, plaintext, ownSigner);
  };
  const changeState = (groupId: string, change: (state: GroupState) => GroupState): Promise<GroupRow> => serial(() => changeStateLocked(groupId, change));

  const setMember = (state: GroupState, account: HexString, patch: Partial<Pick<Member2, 'role' | 'permissions'>>): GroupState => {
    if (!memberOf(state, account)) throw new Error('That account is not a member.');
    return { ...state, members: state.members.map(m => (m.account === account ? { ...m, ...patch } : m)) };
  };

  /** Up to three admins a joiner may ask (0011 InviteLink): bot admins first (always online), then us, then the others. */
  const linkAdmins = async (state: GroupState): Promise<HexString[]> => {
    const admitters = state.members.filter(m => can(m, PERMISSIONS.add) || can(m, PERMISSIONS.approve));
    const bots = new Set<HexString>();
    for (const m of admitters) if (m.account !== self && (await deps.isBot(m.account).catch(() => false))) bots.add(m.account);
    const order = [...admitters.filter(m => bots.has(m.account)), ...admitters.filter(m => m.account === self), ...admitters.filter(m => m.account !== self && !bots.has(m.account))];
    return order.map(m => m.account).slice(0, 3);
  };

  /** Our invite link for the group: our live invite, else a new one (one state statement; policy 0 becomes 1). */
  const inviteLink = (groupId: string): Promise<string> =>
    serial(async () => {
      const row = await getRow(groupId);
      if (!row || !isV2(row) || !row.state) throw new Error('This group is not known on this device.');
      if (!can(memberOf(row.state, self), PERMISSIONS.add)) throw new Error('You cannot create invite links for this group.');
      const t = now();
      const live = (i: GroupState['invites'][number]) => i.createdBy === self && (i.expiresAt === 0 || i.expiresAt > t) && (i.maxUses === 0 || i.uses < i.maxUses);
      let state = row.state;
      let invite = state.invites.find(live);
      if (!invite || state.joinPolicy === 0) {
        if (!invite && state.invites.length >= GROUP2_BOUNDS.invites) throw new Error('This group has 16 invite links. Revoke them first.');
        const fresh = invite ?? { inviteId: random(16), secret: random(16), createdBy: self, expiresAt: 0, maxUses: 0, uses: 0 };
        // A link is useless while only admins add: the first link turns on "an admin approves".
        state = (await changeStateLocked(groupId, s => ({ ...s, joinPolicy: s.joinPolicy === 0 ? 1 : s.joinPolicy, invites: invite ? s.invites : [...s.invites, fresh] }))).state!;
        invite = fresh;
      }
      return inviteLinkText({ groupId, name: state.name, admins: await linkAdmins(state), inviteId: invite.inviteId, secret: invite.secret });
    });

  /** Sends the newcomer the group's recent messages over the DM (0011 "History for late joiners"), when `historyShare` > 0. */
  const shareHistory = async (row: GroupRow, account: HexString): Promise<number> => {
    const newcomer = memberOf(row.state, account);
    if (!row.state || !newcomer || row.state.historyShare === 0 || !deps.reachable(account)) return 0;
    const pages = await historyPages(row, newcomer, { tag: 'timestamp', value: 0 }, row.state.historyShare);
    let items = 0;
    for (const page of pages) {
      if (page.tag !== 'history' || page.value.items.length === 0) continue;
      await deps.sendControl(account, page);
      items += page.value.items.length;
    }
    log('GROUP2_HISTORY_SHARED', { group: row.id, to: account, items });
    return items;
  };

  /** Admits `account`: the state with the member (and the invite's use), then `welcome`, then recent history. */
  const admitLocked = async (groupId: string, account: HexString, inviteId: Uint8Array | null): Promise<void> => {
    const row = await getRow(groupId);
    if (!row?.state) throw new Error('This group is not known on this device.');
    if (row.state.members.length >= GROUP_MEMBER_CAP) throw new Error(`A group has at most ${GROUP_MEMBER_CAP} members.`);
    const username = await deps.nameOf(account).catch(() => `${account.slice(0, 8)}…`);
    const joinedAt = now();
    const entry = await memberEntry(account, ROLES.member, row.state.defaultPermissions, joinedAt);
    const inviteHex = inviteId ? bytesToHex(inviteId) : null;
    const applied = await changeStateLocked(
      groupId,
      s => ({
        ...s,
        members: [...s.members.filter(m => m.account !== account), entry],
        invites: s.invites.map(i => (bytesToHex(i.inviteId) === inviteHex ? { ...i, uses: i.uses + 1 } : i)),
      }),
      [...row.members.filter(m => m.account !== account), { account, username, joinedAt }],
    );
    const settled: GroupRow = { ...applied, joinRequests: (applied.joinRequests ?? []).filter(r => r.account !== account) };
    await putRow(settled);
    await deps.sendControl(account, welcomeOf(settled));
    await shareHistory(settled, account);
  };

  /** 0011 Joining, admin side: the proof names an invite in our state; then the join policy decides. */
  const onJoinRequest = async (from: HexString, request: Extract<GroupControl, { tag: 'joinRequest' }>['value']): Promise<string> => {
    const row = await getRow(request.groupId);
    if (!row || !isV2(row) || !row.state || row.self !== 'member') return 'unknown-group';
    const me = memberOf(row.state, self);
    if (!can(me, PERMISSIONS.add) && !can(me, PERMISSIONS.approve)) return 'not-admin';
    if (memberOf(row.state, from)) {
      // Already in: the welcome may have been lost.
      await deps.sendControl(from, welcomeOf(row));
      return 'already-member';
    }
    const decide = async (status: 0 | 1, reason: string): Promise<string> => {
      await deps.sendControl(from, { tag: 'joinDecision', value: { groupId: row.id, inviteId: request.inviteId, status } });
      log('GROUP2_JOIN_DECIDED', { group: row.id, from, status: status === 0 ? 'pending' : 'rejected', reason });
      return reason;
    };
    const invite = row.state.invites.find(i => bytesEqual(i.inviteId, request.inviteId));
    if (!invite) return decide(1, 'unknown-invite');
    if (!bytesEqual(request.proof, joinProof(invite.secret, from))) return decide(1, 'bad-proof');
    if (invite.expiresAt !== 0 && invite.expiresAt < now()) return decide(1, 'expired');
    if (invite.maxUses !== 0 && invite.uses >= invite.maxUses) return decide(1, 'used-up');
    if (row.state.members.length >= GROUP_MEMBER_CAP) return decide(1, 'full');
    if (row.state.joinPolicy === 0) return decide(1, 'admins-add-only');
    if (row.state.joinPolicy === 2) {
      await admitLocked(row.id, from, request.inviteId);
      log('GROUP2_ADMITTED', { group: row.id, member: from });
      return 'admitted';
    }
    // Policy 1: the request waits for an admin with `approve joins` (the queue is local to this admin in v2).
    const queue = row.joinRequests ?? [];
    if (!queue.some(r => r.account === from)) {
      const username = await deps.nameOf(from).catch(() => `${from.slice(0, 8)}…`);
      await putRow({ ...row, joinRequests: [...queue, { account: from, username, inviteId: request.inviteId, note: request.note.slice(0, 140), at: now() }] });
      await note(row.id, `group2-join:${row.id}:${from}:${now()}`, `${username} asked to join`);
    }
    return decide(0, 'pending');
  };

  /** A chat request whose opener carries `[grp:…]` for an invite of ours: the group, when the proof holds. */
  const joinOpenerGroup = async (peer: HexString, text: string | null): Promise<string | null> => {
    const opener = parseJoinOpener(text);
    if (!opener) return null;
    for (const row of await storage.listGroups()) {
      if (!isV2(row) || !row.state || row.self !== 'member') continue;
      const me = memberOf(row.state, self);
      if (!can(me, PERMISSIONS.add) && !can(me, PERMISSIONS.approve)) continue;
      const invite = row.state.invites.find(i => bytesEqual(i.inviteId, opener.inviteId));
      if (invite && bytesEqual(opener.proof, joinProof(invite.secret, lower(peer)))) return row.id;
    }
    return null;
  };

  // ── Timers ───────────────────────────────────────────────────────────────

  const tick = (): Promise<void> =>
    serial(async () => {
      const t = now();
      for (const row of await storage.listGroups()) {
        if (!isV2(row) || !row.keys) continue;
        const keys = row.keys.filter(k => k.erasesAt === null || k.erasesAt > t || (k.epoch === row.epoch && !k.fork));
        let next: GroupRow = keys.length === row.keys.length ? row : { ...row, keys };
        const current = keyOf(next, next.epoch ?? 0);
        const admin = row.self === 'member' && can(memberOf(row.state, self), PERMISSIONS.remove);
        if (admin && current && t - current.openedAt >= ROTATION_MS) {
          // 0011 Timer: 7 days, then a random wait of up to an hour, and none if a rekey came meanwhile.
          const rotateAt = next.rotateAt ?? t + Math.floor(Math.random() * ROTATION_JITTER_MS);
          next = { ...next, rotateAt };
          await putRow(next);
          if (t >= rotateAt)
            await rekeyLocked(row.id, null).catch(error =>
              log('GROUP2_ROTATE_FAILED', {
                group: row.id,
                error: String(error),
              }),
            );
          continue;
        }
        if (next !== row) await putRow(next);
      }
      await reindex();
    });

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    start: (): Promise<void> =>
      serial(async () => {
        stopped = false;
        subscribedKey = '';
        await reindex();
        await sweep();
        sweepTimer ??= setInterval(() => void serial(() => sweep()).catch(() => undefined), SWEEP_MS);
      }),
    stop: (): void => {
      stopped = true;
      unsubscribe();
      unsubscribe = () => undefined;
      subscribedKey = '';
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = null;
    },
    /** Every topic watched now (tests and the e2e read it). */
    topics: (): string[] => [...byTopic.keys()],
    receive,
    sweep: () => serial(() => sweep()),
    send,
    create: async (name: string, others: readonly GroupMember[]): Promise<{ groupId: string; unreached: HexString[] }> => {
      const groupId = crypto.randomUUID();
      const unreached = await serial(() => open1(groupId, name, others, null, now()));
      return { groupId, unreached };
    },
    /** Upgrades our own v1 room in place: epoch 1 from the v1 roster, `welcome`s to the members. */
    upgrade: (groupId: string): Promise<HexString[]> =>
      serial(async () => {
        const row = await getRow(groupId);
        if (!row || isV2(row)) throw new Error('Only a v1 group can be upgraded.');
        if (row.admin !== self || row.self !== 'member') throw new Error('Only the group admin can upgrade it.');
        return open1(groupId, row.name, row.members, row, row.createdAt);
      }),
    remove: (groupId: string, account: HexString) => serial(() => rekeyLocked(groupId, account)),
    rotate: (groupId: string) => serial(() => rekeyLocked(groupId, null)),
    /** Admin adds a member: the new state (one statement), then a `welcome` over the DM session. */
    add: (groupId: string, account: HexString, username: string): Promise<boolean> =>
      serial(async () => {
        const row = await getRow(groupId);
        if (!row || !isV2(row) || !row.state) throw new Error('This group is not known on this device.');
        if (!can(memberOf(row.state, self), PERMISSIONS.add)) throw new Error('You cannot add members to this group.');
        if (memberOf(row.state, account)) return true;
        if (row.state.members.length >= GROUP_MEMBER_CAP) throw new Error(`A group has at most ${GROUP_MEMBER_CAP} members.`);
        const ep = currentEpoch(row);
        if (!ep) throw new Error('This group has no key on this device.');
        const state: GroupState = {
          ...row.state,
          version: row.state.version + 1,
          members: [...row.state.members, await memberEntry(account, ROLES.member, row.state.defaultPermissions, now())],
        };
        const { plaintext, data } = await sealState(ep, state);
        await submitData(ep.topic, ep.channels.state, data);
        const applied = await applyState(
          {
            ...row,
            members: [...row.members, { account, username, joinedAt: now() }],
          },
          state,
          plaintext,
          ownSigner,
        );
        const reached = (await welcomeAll(applied, [account])).length === 0;
        if (reached) await shareHistory(applied, account);
        return reached;
      }),
    /** The `welcome` a member we just reached (an accepted invite) still needs. */
    welcomeTo: async (groupId: string, account: HexString): Promise<void> => {
      const row = await getRow(groupId);
      if (row && isV2(row) && row.self === 'member' && memberOf(row.state, account) && (memberOf(row.state, self)?.role ?? 0) >= ROLES.admin) {
        await deps.sendControl(account, welcomeOf(row));
        await shareHistory(row, account);
      }
    },
    /** 0011 Leave: a `groupLeave` in our carrier (one statement), then our keys are erased. */
    leave: async (groupId: string): Promise<void> => {
      const row = await getRow(groupId);
      if (!row || !isV2(row) || row.self !== 'member') return;
      await send(groupId, { tag: 'groupLeave', value: { groupId } }, { messageId: crypto.randomUUID(), timestamp: now() }).catch(error =>
        log('GROUP2_LEAVE_SEND_FAILED', { error: String(error) }),
      );
      await serial(async () => {
        const latest = await getRow(groupId);
        if (!latest) return;
        await putRow({ ...latest, self: 'left', keys: [], carry: [] });
        await note(groupId, `group-self-left:${groupId}`, 'You left the group');
        await reindex();
      });
    },
    onControl: (from: HexString, control: GroupControl): Promise<string> =>
      serial(async () => {
        switch (control.tag) {
          case 'welcome':
            return onWelcome(lower(from), control.value);
          case 'keyRequest':
            return onKeyRequest(lower(from), control.value);
          case 'historyRequest':
            return onHistoryRequest(lower(from), control.value);
          case 'history':
            return onHistory(lower(from), control.value);
          case 'joinRequest':
            return onJoinRequest(lower(from), control.value);
          // Our own join's answer: the manager keeps that (the `groupJoins` table).
          case 'joinDecision':
            return control.value.status === 0 ? 'join-pending' : 'join-rejected';
        }
      }),
    requestHistory: (groupId: string, to?: HexString, since?: HistorySinceWire) => requestHistory(groupId, to, since),
    tick,
    // ── M16b ──
    /** Our invite link (a new invite in the state when we have none). */
    inviteLink,
    /** Removes every invite from the state: old links stop working. */
    revokeInvites: (groupId: string) => changeState(groupId, s => ({ ...s, invites: [] })).then(() => undefined),
    joinOpenerGroup: (peer: HexString, text: string | null) => serial(() => joinOpenerGroup(lower(peer), text)),
    approveJoin: (groupId: string, account: HexString): Promise<void> =>
      serial(async () => {
        const row = await getRow(groupId);
        const request = row?.joinRequests?.find(r => r.account === account);
        if (!row || !request) throw new Error('This join request is no longer waiting.');
        if (!can(memberOf(row.state, self), PERMISSIONS.approve) && !can(memberOf(row.state, self), PERMISSIONS.add)) throw new Error('You cannot approve join requests in this group.');
        await admitLocked(groupId, account, request.inviteId);
      }),
    rejectJoin: (groupId: string, account: HexString): Promise<void> =>
      serial(async () => {
        const row = await getRow(groupId);
        const request = row?.joinRequests?.find(r => r.account === account);
        if (!row || !request) return;
        await putRow({ ...row, joinRequests: (row.joinRequests ?? []).filter(r => r.account !== account) });
        await deps.sendControl(account, { tag: 'joinDecision', value: { groupId, inviteId: request.inviteId, status: 1 } });
      }),
    /** Pins or unpins one message (0011 `pinned`, at most 10). */
    setPinned: (groupId: string, messageId: string, pinned: boolean): Promise<void> =>
      changeState(groupId, s => {
        const without = s.pinned.filter(id => id !== messageId);
        if (pinned && without.length >= GROUP2_BOUNDS.pinned) throw new Error('A group has at most 10 pinned messages. Unpin one first.');
        return { ...s, pinned: pinned ? [...without, messageId] : without };
      }).then(() => undefined),
    /** Name, slow mode, join policy, history for newcomers: one state statement for all of them. */
    setSettings: (groupId: string, settings: Partial<Pick<GroupState, 'name' | 'slowModeSecs' | 'joinPolicy' | 'historyShare'>>): Promise<void> =>
      changeState(groupId, s => ({ ...s, ...settings })).then(() => undefined),
    /** Member ↔ admin (0011: a role-0 member's change needs `manage admins`; only the owner changes an admin). */
    setRole: (groupId: string, account: HexString, role: 0 | 1): Promise<void> =>
      changeState(groupId, s => setMember(s, account, role === ROLES.admin ? { role, permissions: ADMIN_PERMISSIONS } : { role, permissions: s.defaultPermissions })).then(() => undefined),
    setPermissions: (groupId: string, account: HexString, permissions: number): Promise<void> =>
      changeState(groupId, s => setMember(s, account, { permissions: permissions & ALL_PERMISSIONS })).then(() => undefined),
    /** The owner hands the group to `account` and stays an admin with every flag. */
    transferOwnership: (groupId: string, account: HexString): Promise<void> =>
      changeState(groupId, s => {
        if (memberOf(s, self)?.role !== ROLES.owner) throw new Error('Only the owner can hand over the group.');
        return setMember(setMember(s, account, { role: ROLES.owner, permissions: ALL_PERMISSIONS }), self, { role: ROLES.admin, permissions: ALL_PERMISSIONS });
      }).then(() => undefined),
    /** A stranger's invite, accepted: the group is watched and its state read now. */
    acceptInvite: (groupId: string): Promise<void> =>
      serial(async () => {
        const row = await getRow(groupId);
        if (!row || !isV2(row) || row.self !== 'invited') return;
        await putRow({ ...row, self: 'member', invitedBy: null });
        await reindex();
        const key = row.epoch ? keyOf(row, row.epoch) : undefined;
        if (key) await sweep([bytesToHex(deriveEpoch(key.key, row.id, key.epoch).topic)]);
      }),
  };
};
