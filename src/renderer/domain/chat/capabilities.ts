/**
 * Spec 0013 capabilities: what each device of a peer can read, and the form
 * of each outgoing content that every one of them can read.
 *
 * - This device's own set rides the next message to a peer after a chat
 *   starts, after a set change, and after the peer's `deviceAdded` (never a
 *   submission of its own).
 * - A peer's sets are stored per sending device (the statement account that
 *   signed and addressed the statement; peerSession.ts names it). A device
 *   that never sent one is a baseline client (base spec content only).
 * - Owner ruling on baseline clients (2026-09-24): every extension kind goes
 *   to a device only after that device listed it. Bots count as advertised
 *   through their `botInfo`: until pca sends its own set, a peer whose
 *   `botInfo` we hold gets `PCA_TRANSITION` for its silent devices.
 */

import { type HexString, bytesToHex } from '../../app/bytes';
import { type PeerCapabilitiesRow, type PeerDevice, appDatabase, db } from '../../app/database';

import type { ButtonWire } from './identityEvents';
import type { OutgoingContent } from './content';

export type Capabilities = {
  /** Layout version; 1. */
  version: number;
  /** 32-byte bitmap: kind k is bit k%8 of byte k/8. */
  kinds: Uint8Array;
  /** `RichText` `FileVariant` indices the device fetches: 0 HOP, 1 Bulletin (0014). */
  fileVariants: number[];
  /** HOP dialects the device decrypts: 0 legacy (the phones), 1 aesGcm. */
  hopDialects: number[];
  /** Bit 0 private groups v2, bit 1 `tx` buttons. */
  features: number;
};

export const VARIANT_HOP = 0;
export const VARIANT_BULLETIN = 1;
export const DIALECT_LEGACY = 0;
export const DIALECT_AES_GCM = 1;
export const FEATURE_GROUPS_V2 = 1;
export const FEATURE_TX = 2;

/** Kind numbers this module gates (base spec, RFC-0003, specs 0005–0013). */
const KIND = {
  text: 0,
  reacted: 4,
  reactionRemoved: 5,
  reply: 7,
  dataChannelClosed: 11,
  edit: 12,
  richText: 15,
  deleted: 21,
  typing: 240,
  seen: 241,
  buttons: 242,
  buttonPress: 243,
  botInfo: 244,
  transactionReference: 245,
  groupInfo: 246,
  groupMessage: 247,
  groupLeave: 248,
  groupControl: 249,
  attachment: 250,
  capabilities: 252,
} as const;

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const kindsBitmap = (kinds: Iterable<number>): Uint8Array => {
  const bitmap = new Uint8Array(32);
  for (const kind of kinds) if (kind >= 0 && kind < 256) bitmap[kind >> 3] = (bitmap[kind >> 3] as number) | (1 << (kind & 7));
  return bitmap;
};

export const hasKind = (caps: Pick<Capabilities, 'kinds'>, kind: number): boolean => (((caps.kinds[kind >> 3] ?? 0) >> (kind & 7)) & 1) === 1;

/** 0013 "The baseline set": base spec v0.16 kinds and `DeviceChatAccepted`. */
const BASE_KINDS = [0, 1, 2, 4, 5, ...range(7, 18), 20];

export const BASELINE: Capabilities = { version: 1, kinds: kindsBitmap(BASE_KINDS), fileVariants: [VARIANT_HOP], hopDialects: [DIALECT_LEGACY], features: 0 };

/**
 * This build's set. Base kinds it reads and shows (no calls 8–11: it only
 * declines them; no payments 2 and 16: they show as unsupported; no legacy
 * accept 14: it is dropped), RFC-0003 `deleted`, specs 0005–0012 (240–250)
 * and 0013 itself. Both file variants, both HOP dialects, both features.
 */
export const OWN_CAPABILITIES: Capabilities = {
  version: 1,
  kinds: kindsBitmap([0, 1, 4, 5, 7, 12, 13, 15, 17, 18, 20, KIND.deleted, ...range(240, 250), KIND.capabilities]),
  fileVariants: [VARIANT_HOP, VARIANT_BULLETIN],
  hopDialects: [DIALECT_LEGACY, DIALECT_AES_GCM],
  features: FEATURE_GROUPS_V2 | FEATURE_TX,
};

/**
 * TRANSITION RULE (until pca sends its own set, M20 pca half): a peer whose
 * `botInfo` we hold advertised through it (owner ruling) the kinds pca reads
 * today, from `bot-core/vendor/app-chat-codec.mjs` on 2026-09-24: the base
 * kinds, `deleted` 21, typing and seen 240/241, buttons 242/243, botInfo 244,
 * transaction references 245, groups 246–249 and the kind-250 attachment.
 * Files go to it over HOP (kind 250 is no longer sent; pca M20 reads the
 * phones' versioned root).
 * Features: groups v2 (pca's v2 bots) and `tx` buttons (M14). A set the bot
 * sends itself replaces this for that device.
 */
export const PCA_TRANSITION: Capabilities = {
  version: 1,
  kinds: kindsBitmap([...BASE_KINDS, KIND.deleted, ...range(240, 250)]),
  fileVariants: [VARIANT_HOP],
  hopDialects: [DIALECT_LEGACY],
  features: FEATURE_GROUPS_V2 | FEATURE_TX,
};

/** Per field: the kinds and features both have, the variants and dialects both list. */
export const intersect = (a: Capabilities, b: Capabilities): Capabilities => ({
  version: Math.min(a.version, b.version),
  kinds: a.kinds.map((byte, i) => byte & (b.kinds[i] ?? 0)),
  fileVariants: a.fileVariants.filter(v => b.fileVariants.includes(v)),
  hopDialects: a.hopDialects.filter(d => b.hopDialects.includes(d)),
  features: a.features & b.features,
});

/**
 * 0013 "Choosing a form": the intersection over the peer's devices, a device
 * without a stored set counting as `fallback` (the baseline, or the pca
 * transition set for a bot). No device known: `fallback` alone.
 */
export const effectiveOf = (devices: readonly Pick<PeerDevice, 'statementAccountId'>[], sets: ReadonlyMap<string, Capabilities>, fallback: Capabilities): Capabilities =>
  devices.length === 0
    ? fallback
    : devices.map(device => sets.get(bytesToHex(device.statementAccountId).toLowerCase()) ?? fallback).reduce(intersect);

/** A stable name for a set: its encoded fields (what changes when the set changes). */
export const capabilitiesHash = (caps: Capabilities): string =>
  `${caps.version}:${bytesToHex(caps.kinds)}:${caps.fileVariants.join(',')}:${caps.hopDialects.join(',')}:${caps.features}`;

// ── The form of each outgoing content ───────────────────────────────────────

export const NO_FILE_RAIL = "This contact's app cannot receive files from this app.";
export const NO_GROUPS = "This contact's app cannot take part in groups yet.";

export type Form = { send: OutgoingContent } | { drop: string } | { refuse: string };

/** Spec 0012: a Bulletin message carries at most 25 MiB; a HOP file at most 32 MiB (this app's and pca's cap). */
export const BULLETIN_MAX_BYTES = 25 * 1024 * 1024;
export const HOP_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Which rail an attachment of `bytes` in all to this peer takes (0014
 * "Sending", as pca and this app agreed for M20): the Bulletin variant when
 * every device lists it and it fits 25 MiB; else HOP in the legacy dialect up
 * to 32 MiB; else none (0013 row 3). Kind 250 is never sent any more (read only).
 */
export type FileRail = 'bulletin' | 'hop';
export const fileRailOf = (caps: Capabilities, bytes = 0): FileRail | null => {
  if (caps.fileVariants.includes(VARIANT_BULLETIN) && hasKind(caps, KIND.richText) && bytes <= BULLETIN_MAX_BYTES) return 'bulletin';
  if (caps.fileVariants.includes(VARIANT_HOP) && caps.hopDialects.includes(DIALECT_LEGACY) && hasKind(caps, KIND.richText) && bytes <= HOP_MAX_BYTES) return 'hop';
  return null;
};

/** 0013 fallback for `buttons`: "1. Yes · 2. No — reply with a number or the label". */
export const menuAsText = (text: string, rows: readonly ButtonWire[][]): string => {
  const labels = rows.flat().map(button => button.label);
  if (labels.length === 0) return text;
  const menu = `${labels.map((label, i) => `${i + 1}. ${label}`).join(' · ')} — reply with a number or the label`;
  return text.trim() === '' ? menu : `${text}\n\n${menu}`;
};

const needs = (caps: Capabilities, kind: number, content: OutgoingContent, why: string): Form => (hasKind(caps, kind) ? { send: content } : { drop: why });

/**
 * The form of `content` for a peer whose devices all read `caps`: the content
 * as is, its fallback (0013 table), nothing (`drop`, the caller skips it
 * silently), or `refuse` with the words to show.
 */
export const formFor = (caps: Capabilities, content: OutgoingContent): Form => {
  switch (content.type) {
    case 'text':
      return { send: content };
    case 'reply':
      return hasKind(caps, KIND.reply) ? { send: content } : { send: { type: 'text', text: content.text } };
    case 'reaction':
      return needs(caps, content.add ? KIND.reacted : KIND.reactionRemoved, content, 'reactions');
    case 'edit':
      return needs(caps, KIND.edit, content, 'edits');
    case 'callDecline':
      return needs(caps, KIND.dataChannelClosed, content, 'call signals');
    case 'deleted':
      return needs(caps, KIND.deleted, content, 'deleted');
    case 'typing':
      return needs(caps, KIND.typing, content, 'typing');
    case 'seen':
      return needs(caps, KIND.seen, content, 'seen');
    case 'botInfo':
      return needs(caps, KIND.botInfo, content, 'botInfo');
    case 'buttonPress':
      return needs(caps, KIND.buttonPress, content, 'buttonPress');
    case 'transactionReference':
      // The base `send` fallback needs the block hash and the amount, which a reference does not hold: nothing goes.
      return needs(caps, KIND.transactionReference, content, 'transactionReference');
    case 'buttons': {
      if (!hasKind(caps, KIND.buttons)) return { send: { type: 'text', text: menuAsText(content.text, content.rows) } };
      if (caps.features & FEATURE_TX) return { send: content };
      // 0013: without feature bit 1 a `tx` button is left out.
      const rows = content.rows.map(row => row.filter(button => button.action.tag !== 'tx')).filter(row => row.length > 0);
      return { send: { ...content, rows } };
    }
    case 'groupInfo':
    case 'groupMessage':
      return hasKind(caps, content.type === 'groupInfo' ? KIND.groupInfo : KIND.groupMessage) ? { send: content } : { refuse: NO_GROUPS };
    case 'groupLeave':
      return needs(caps, KIND.groupLeave, content, 'groupLeave');
    case 'groupControl':
      return hasKind(caps, KIND.groupControl) && caps.features & FEATURE_GROUPS_V2 ? { send: content } : { refuse: NO_GROUPS };
    case 'attachment':
    case 'bulletinFile':
      // Bulletin chunks go only as the 0014 variant; kind 250 is read only since M20.
      return fileRailOf(caps) === 'bulletin' ? { send: { type: 'bulletinFile', items: content.items, caption: content.caption } } : { refuse: NO_FILE_RAIL };
    case 'hopFile':
      return caps.fileVariants.includes(VARIANT_HOP) && caps.hopDialects.includes(DIALECT_LEGACY) && hasKind(caps, KIND.richText) ? { send: content } : { refuse: NO_FILE_RAIL };
    case 'capabilities':
      return { send: content };
  }
};

// ── Storage ─────────────────────────────────────────────────────────────────

const deviceKey = (device: Uint8Array): string => bytesToHex(device).toLowerCase();

/**
 * A set from `device` of `peer`, sent at `timestamp` (its message time): a
 * later one replaces an earlier one; an older one is ignored. Returns whether
 * it was stored.
 */
export const storeCapabilities = (peer: HexString, device: Uint8Array, caps: Capabilities, timestamp: number): Promise<boolean> =>
  appDatabase.transaction('rw', db.peerCapabilities, async () => {
    const key: [HexString, string] = [peer, deviceKey(device)];
    const existing = await db.peerCapabilities.get(key);
    if (existing && existing.timestamp >= timestamp) return false;
    const row: PeerCapabilitiesRow = { peer, device: key[1], caps, timestamp };
    await db.peerCapabilities.put(row);
    return true;
  });

/** The peer removed a device (mds `deviceRemoved`): its set goes with it. */
export const dropDeviceCapabilities = async (peer: HexString, device: Uint8Array): Promise<void> => {
  await db.peerCapabilities.delete([peer, deviceKey(device)]);
};

/**
 * `effective(peer)` from the stored rows; `bot`: the peer's `botInfo` is
 * known (the transition rule). With no device known, the set stored under the
 * peer's identity account (`identity`) stands in, as pca does.
 */
export const loadEffective = async (peer: HexString, devices: readonly PeerDevice[], bot: boolean, identity?: Uint8Array): Promise<Capabilities> => {
  const rows = await db.peerCapabilities.where('peer').equals(peer).toArray();
  const roster = devices.length === 0 && identity ? [{ statementAccountId: identity }] : devices;
  return effectiveOf(roster, new Map(rows.map(row => [row.device, row.caps])), bot ? PCA_TRANSITION : BASELINE);
};

/** Whether our set must ride the next message to `peer`: never sent this chat, or sent before a set change. */
export const capabilitiesDue = async (peer: HexString, own: Capabilities = OWN_CAPABILITIES): Promise<boolean> =>
  (await db.capabilitiesSent.get(peer))?.hash !== capabilitiesHash(own);

export const markCapabilitiesSent = async (peer: HexString, own: Capabilities = OWN_CAPABILITIES, at = Date.now()): Promise<void> => {
  await db.capabilitiesSent.put({ peer, hash: capabilitiesHash(own), sentAt: at });
};

/** A chat starts (accept, either side) or the peer added a device: our set goes again with the next message. */
export const capabilitiesUnsent = async (peer: HexString): Promise<void> => {
  await db.capabilitiesSent.delete(peer);
};
