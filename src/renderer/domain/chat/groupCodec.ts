/**
 * Spec 0011 private groups v2: the SCALE codec of what goes on a group topic
 * (`GroupData` and what it seals), and of the invite link. Bytes are pinned by
 * docs/spec/vectors-0011.md; pca's `bot-core/lib/group-codec.mjs` reproduces
 * the same bytes. The pairwise control kind 249 lives in `identityEvents.ts`
 * with the other content kinds.
 *
 * Accounts decode to lowercase `0x` hex and u64 times to numbers, so a decoded
 * state goes into Dexie and compares with `===` as it is.
 */

import { Bytes, type Codec, Enum, Option, Struct, Vector, enhanceCodec, str, u16, u32, u64, u8 } from 'scale-ts';

import { type HexString, bytesToHex, hexToBytes } from '../../app/bytes';

/** Decoder bounds (vectors-0011.md "Decoder bounds"); v2 admits at most `GROUP_MEMBER_CAP` members. */
export const GROUP2_BOUNDS = {
  members: 1024,
  posting: 8,
  invites: 16,
  pinned: 10,
  nameBytes: 240,
  noteBytes: 560,
  plaintext: 4096,
  stateBytes: 64 * 1024,
  entries: 1024,
  historyShare: 100,
} as const;
/** The reviewer's v2 cap (0011 Limits): the format allows 1024. */
export const GROUP_MEMBER_CAP = 256;

/** Permission bits (0011 "Group state"). */
export const PERMISSIONS = {
  post: 0x0001,
  add: 0x0002,
  pin: 0x0004,
  info: 0x0008,
  remove: 0x0010,
  approve: 0x0020,
  admins: 0x0040,
  delete: 0x0080,
} as const;
export const ALL_PERMISSIONS = 0x00ff;
export const ROLES = { member: 0, admin: 1, owner: 2 } as const;

export type Member2 = { account: HexString; role: number; permissions: number; posting: HexString[]; joinedAt: number };
export type Invite2 = { inviteId: Uint8Array; secret: Uint8Array; createdBy: HexString; expiresAt: number; maxUses: number; uses: number };
export type GroupState = {
  groupId: string;
  epoch: number;
  version: number;
  name: string;
  avatar: Uint8Array | undefined;
  defaultPermissions: number;
  slowModeSecs: number;
  joinPolicy: number;
  historyShare: number;
  members: Member2[];
  invites: Invite2[];
  pinned: string[];
  topics: Uint8Array | undefined;
  createdAt: number;
};
export type Sealed = { nonce: Uint8Array; ciphertext: Uint8Array };
export type RekeyEntry = { hint: Uint8Array; nonce: Uint8Array; box: Uint8Array };
export type Rekey = { newEpoch: number; entries: RekeyEntry[] };
export type GroupData = { tag: 'messages'; value: Sealed } | { tag: 'state'; value: Sealed } | { tag: 'rekey'; value: Rekey };
/** `messages` are remote messages (the bytes of one `Message`, without the opaque length prefix). */
export type GroupMessages = { from: HexString; topic: number | undefined; messages: Uint8Array[] };
export type InviteLink = { groupId: string; name: string; admins: HexString[]; inviteId: Uint8Array; secret: Uint8Array };

/** 32 raw bytes on the wire, lowercase `0x` hex here. */
export const AccountCodec: Codec<HexString> = enhanceCodec(Bytes(32), (hex: HexString) => hexToBytes(hex), bytes => bytesToHex(bytes));
/** A u64 of unix milliseconds: every value in 0011 fits a JS number. */
export const TimeCodec: Codec<number> = enhanceCodec(u64, (n: number) => BigInt(n), n => Number(n));

const SealedCodec = Struct({ nonce: Bytes(12), ciphertext: Bytes() });
const RekeyEntryCodec = Struct({ hint: Bytes(8), nonce: Bytes(12), box: Bytes(48) });
const RekeyCodec = Struct({ newEpoch: u32, entries: Vector(RekeyEntryCodec) });
const GroupDataCodec = Enum({ messages: SealedCodec, state: SealedCodec, rekey: RekeyCodec });
const GroupMessagesCodec = Struct({ from: AccountCodec, topic: Option(u32), messages: Vector(Bytes()) });
const MemberCodec = Struct({ account: AccountCodec, role: u8, permissions: u16, posting: Vector(AccountCodec), joinedAt: TimeCodec });
const InviteCodec = Struct({ inviteId: Bytes(16), secret: Bytes(16), createdBy: AccountCodec, expiresAt: TimeCodec, maxUses: u32, uses: u32 });
const GroupStateCodec = Struct({
  groupId: str,
  epoch: u32,
  version: u32,
  name: str,
  avatar: Option(Bytes(32)),
  defaultPermissions: u16,
  slowModeSecs: u32,
  joinPolicy: u8,
  historyShare: u8,
  members: Vector(MemberCodec),
  invites: Vector(InviteCodec),
  pinned: Vector(str),
  topics: Option(Bytes()),
  createdAt: TimeCodec,
});
const InviteLinkCodec = Struct({ groupId: str, name: str, admins: Vector(AccountCodec), inviteId: Bytes(16), secret: Bytes(16) });

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Decodes exactly: bytes after the value make it undecodable (as pca's `r.end`). */
const strict = <T>(codec: Codec<T>, bytes: Uint8Array, what: string): T => {
  const value = codec.dec(bytes);
  if (codec.enc(value).length !== bytes.length) throw new Error(`${what}: trailing bytes`);
  return value;
};

const byAccount = (a: { account: HexString }, b: { account: HexString }): number => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0);

export const encodeGroupData = (data: GroupData): Uint8Array => {
  if (data.tag === 'rekey') {
    if (data.value.entries.length > GROUP2_BOUNDS.entries) throw new Error('too many rekey entries');
    // Sorted by hint (0011): the order says nothing about the roster.
    const entries = [...data.value.entries].sort((a, b) => bytesToHex(a.hint).localeCompare(bytesToHex(b.hint)));
    return GroupDataCodec.enc({ tag: 'rekey', value: { ...data.value, entries } });
  }
  return GroupDataCodec.enc(data);
};

export const decodeGroupData = (bytes: Uint8Array): GroupData => {
  const data = strict(GroupDataCodec, bytes, 'GroupData');
  if (data.tag === 'rekey' && data.value.entries.length > GROUP2_BOUNDS.entries) throw new Error('too many rekey entries');
  return data;
};

export const encodeGroupMessages = (from: HexString, messages: readonly Uint8Array[]): Uint8Array =>
  GroupMessagesCodec.enc({ from, topic: undefined, messages: [...messages] });

export const decodeGroupMessages = (bytes: Uint8Array): GroupMessages => {
  if (bytes.length > GROUP2_BOUNDS.plaintext) throw new Error(`GroupMessages exceeds ${GROUP2_BOUNDS.plaintext} bytes`);
  const value = strict(GroupMessagesCodec, bytes, 'GroupMessages');
  if (value.topic !== undefined) throw new Error('GroupMessages.topic must be None in v2');
  return value;
};

/** Members sorted by account bytes, so two admins that make one change produce one `stateHash`. */
export const encodeGroupState = (state: GroupState): Uint8Array => {
  const members = [...state.members].sort(byAccount);
  if (members.length < 1 || members.length > GROUP2_BOUNDS.members) throw new Error('a state needs 1 to 1024 members');
  if (members.some(member => member.posting.length > GROUP2_BOUNDS.posting)) throw new Error('too many posting accounts');
  if (state.invites.length > GROUP2_BOUNDS.invites) throw new Error('too many invites');
  if (state.pinned.length > GROUP2_BOUNDS.pinned) throw new Error('too many pins');
  if (state.historyShare > GROUP2_BOUNDS.historyShare) throw new Error('historyShare exceeds 100');
  if (utf8Length(state.name) > GROUP2_BOUNDS.nameBytes) throw new Error('the group name is too long');
  const bytes = GroupStateCodec.enc({ ...state, members, topics: undefined });
  if (bytes.length > GROUP2_BOUNDS.stateBytes) throw new Error('state exceeds 64 KiB');
  return bytes;
};

export const decodeGroupState = (bytes: Uint8Array): GroupState => {
  if (bytes.length > GROUP2_BOUNDS.stateBytes) throw new Error('state exceeds 64 KiB');
  const state = strict(GroupStateCodec, bytes, 'GroupState');
  if (state.members.length < 1 || state.members.length > GROUP2_BOUNDS.members) throw new Error('a state needs 1 to 1024 members');
  if (state.members.some(member => member.posting.length > GROUP2_BOUNDS.posting)) throw new Error('too many posting accounts');
  if (state.invites.length > GROUP2_BOUNDS.invites) throw new Error('too many invites');
  if (state.pinned.length > GROUP2_BOUNDS.pinned) throw new Error('too many pins');
  if (utf8Length(state.name) > GROUP2_BOUNDS.nameBytes) throw new Error('the group name is too long');
  if (state.topics !== undefined) throw new Error('GroupState.topics must be None in v2');
  if (state.historyShare > GROUP2_BOUNDS.historyShare) throw new Error('historyShare exceeds 100');
  if (state.joinPolicy > 2) throw new Error(`unknown joinPolicy ${state.joinPolicy}`);
  if (state.members.some(member => member.role > ROLES.owner)) throw new Error('unknown role');
  if (state.members.filter(member => member.role === ROLES.owner).length !== 1) throw new Error('a state needs exactly one owner');
  return state;
};

export const encodeInviteLink = (link: InviteLink): Uint8Array => {
  if (link.admins.length < 1 || link.admins.length > 3) throw new Error('an invite link names 1 to 3 admins');
  return InviteLinkCodec.enc(link);
};

export const decodeInviteLink = (bytes: Uint8Array): InviteLink => {
  const link = strict(InviteLinkCodec, bytes, 'InviteLink');
  if (link.admins.length < 1 || link.admins.length > 3) throw new Error('an invite link names 1 to 3 admins');
  return link;
};

/** base64url without padding (the link fragment). */
export const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), c => c.charCodeAt(0));
};
