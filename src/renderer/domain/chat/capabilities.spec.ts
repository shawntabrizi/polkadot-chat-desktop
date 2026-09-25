import { beforeEach, describe, expect, it } from 'vitest';

import type { HexString } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';

import {
  BASELINE,
  NO_FILE_RAIL,
  NO_GROUPS,
  OWN_CAPABILITIES,
  PCA_TRANSITION,
  capabilitiesDue,
  capabilitiesUnsent,
  dropDeviceCapabilities,
  effectiveOf,
  fileRailOf,
  formFor,
  answeredOwnSet,
  groupSupportOf,
  hasKind,
  intersect,
  kindsBitmap,
  loadAnsweredOwnSet,
  loadAnsweredPeers,
  loadEffective,
  loadGroupSupport,
  markCapabilitiesSent,
  menuAsText,
  storeCapabilities,
} from './capabilities';
import type { AttachmentItem, OutgoingContent } from './content';

const PEER = '0x1111111111111111111111111111111111111111111111111111111111111111' as HexString;
const phone = { statementAccountId: new Uint8Array(32).fill(0xa1), encryptionPublicKey: new Uint8Array(32).fill(0xa2) };
const desktop = { statementAccountId: new Uint8Array(32).fill(0xb1), encryptionPublicKey: new Uint8Array(32).fill(0xb2) };
const hexOf = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;

const item: AttachmentItem = {
  mime: 'image/png',
  name: null,
  size: 10,
  media: { kind: 'image', width: 4, height: 3 },
  blurhash: null,
  thumbnail: null,
  key: new Uint8Array(32),
  nonce: new Uint8Array(12),
  chunkSize: 2_000_000,
  chunks: [new Uint8Array(32)],
  store: { genesis: '0x00', mirror: null },
  expiresAt: 1,
};

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('the sets', () => {
  it('baseline is the base spec and mds kinds: `b7ff17` then zeros, HOP legacy only (0013 "The baseline set")', () => {
    expect(hexOf(BASELINE.kinds)).toBe(`0xb7ff17${'00'.repeat(29)}`);
    expect(BASELINE.fileVariants).toEqual([0]);
    expect(BASELINE.hopDialects).toEqual([0]);
    expect(BASELINE.features).toBe(0);
  });

  it('our set lists both variants and dialects, the extension kinds, 252 itself, and no calls or payments we cannot act on', () => {
    for (const kind of [0, 7, 15, 21, 240, 241, 242, 245, 249, 250, 252]) expect(hasKind(OWN_CAPABILITIES, kind)).toBe(true);
    for (const kind of [2, 8, 9, 10, 11, 16]) expect(hasKind(OWN_CAPABILITIES, kind)).toBe(false);
    expect(OWN_CAPABILITIES.fileVariants).toEqual([0, 1]);
    expect(OWN_CAPABILITIES.hopDialects).toEqual([0, 1]);
    expect(OWN_CAPABILITIES.features).toBe(3);
  });

  it('a bot on the transition set gets files over HOP: kind 250 is never sent any more, even to a peer that lists it', () => {
    expect(hasKind(PCA_TRANSITION, 250)).toBe(true);
    expect(PCA_TRANSITION.fileVariants).toEqual([0]);
    expect(fileRailOf(PCA_TRANSITION)).toBe('hop');
  });

  it('a file over 25 MiB to a variant-1 peer falls back to HOP (32 MiB), then is refused', () => {
    expect(fileRailOf(OWN_CAPABILITIES, 25 * 1024 * 1024)).toBe('bulletin');
    expect(fileRailOf(OWN_CAPABILITIES, 25 * 1024 * 1024 + 1)).toBe('hop');
    expect(fileRailOf(OWN_CAPABILITIES, 32 * 1024 * 1024 + 1)).toBeNull();
  });

  it('with no device known, the set stored under the identity account stands in (as pca keys it)', async () => {
    const identity = new Uint8Array(32).fill(0x11);
    await storeCapabilities(PEER, identity, OWN_CAPABILITIES, 1);
    expect(fileRailOf(await loadEffective(PEER, [], false, identity))).toBe('bulletin');
    // Once a device is known, the device counts: silent, it is baseline.
    expect(fileRailOf(await loadEffective(PEER, [phone], false, identity))).toBe('hop');
  });
});

describe('effective(P): the intersection over the peer devices', () => {
  it('a device without a set counts as baseline: one phone makes the whole peer baseline', () => {
    const sets = new Map([[hexOf(desktop.statementAccountId), OWN_CAPABILITIES]]);
    const both = effectiveOf([phone, desktop], sets, BASELINE);
    expect(both.fileVariants).toEqual([0]);
    expect(hasKind(both, 241)).toBe(false);
    expect(fileRailOf(both)).toBe('hop');
    // The phone removed: the desktop's set alone.
    expect(fileRailOf(effectiveOf([desktop], sets, BASELINE))).toBe('bulletin');
  });

  it('per field: kinds and features AND, variants and dialects both lists', () => {
    const a = { version: 1, kinds: kindsBitmap([0, 240, 241]), fileVariants: [0, 1], hopDialects: [0, 1], features: 3 };
    const b = { version: 2, kinds: kindsBitmap([0, 241, 250]), fileVariants: [1], hopDialects: [1], features: 2 };
    const both = intersect(a, b);
    expect([0, 240, 241, 250].map(kind => hasKind(both, kind))).toEqual([true, false, true, false]);
    expect(both).toMatchObject({ version: 1, fileVariants: [1], hopDialects: [1], features: 2 });
  });

  it('no known device: the fallback alone', () => {
    expect(effectiveOf([], new Map(), BASELINE)).toBe(BASELINE);
  });
});

describe('storage', () => {
  it('keys a set by the sending device; a later message time replaces it, an older one is ignored', async () => {
    const older = { ...BASELINE, fileVariants: [0] };
    const newer = OWN_CAPABILITIES;
    expect(await storeCapabilities(PEER, desktop.statementAccountId, newer, 200)).toBe(true);
    expect(await storeCapabilities(PEER, desktop.statementAccountId, older, 100)).toBe(false);
    expect(fileRailOf(await loadEffective(PEER, [desktop], false))).toBe('bulletin');
    expect(await storeCapabilities(PEER, desktop.statementAccountId, older, 300)).toBe(true);
    expect(fileRailOf(await loadEffective(PEER, [desktop], false))).toBe('hop');
  });

  it('deviceRemoved drops that device only', async () => {
    await storeCapabilities(PEER, desktop.statementAccountId, OWN_CAPABILITIES, 1);
    await storeCapabilities(PEER, phone.statementAccountId, OWN_CAPABILITIES, 1);
    await dropDeviceCapabilities(PEER, phone.statementAccountId);
    expect((await db.peerCapabilities.toArray()).map(row => row.device)).toEqual([hexOf(desktop.statementAccountId)]);
    // The phone is still in the roster but silent again: baseline.
    expect(fileRailOf(await loadEffective(PEER, [phone, desktop], false))).toBe('hop');
  });

  it('a known bot with no set of its own gets the pca transition set, a person the baseline', async () => {
    expect(await loadEffective(PEER, [phone], true)).toEqual(PCA_TRANSITION);
    expect(fileRailOf(await loadEffective(PEER, [phone], false))).toBe('hop');
  });

  it('our set is due once per chat, again after a change of the set or a new peer device', async () => {
    expect(await capabilitiesDue(PEER)).toBe(true);
    await markCapabilitiesSent(PEER);
    expect(await capabilitiesDue(PEER)).toBe(false);
    expect(await capabilitiesDue(PEER, { ...OWN_CAPABILITIES, features: 1 })).toBe(true);
    await capabilitiesUnsent(PEER);
    expect(await capabilitiesDue(PEER)).toBe(true);
  });
});

describe('the form of each content (0013 fallback table)', () => {
  const sent = (caps: typeof BASELINE, content: OutgoingContent) => {
    const form = formFor(caps, content);
    return 'send' in form ? form.send : form;
  };

  it('base kinds go to a baseline device as they are', () => {
    for (const content of [
      { type: 'text', text: 'hi' },
      { type: 'reply', messageId: 'a', text: 'yes' },
      { type: 'reaction', messageId: 'a', emoji: '🔥', add: true },
      { type: 'edit', messageId: 'a', text: 'new' },
      { type: 'callDecline', offerMessageId: 'o' },
    ] as OutgoingContent[])
      expect(sent(BASELINE, content)).toEqual(content);
  });

  it('typing, seen, deleted, botInfo, buttonPress and transactionReference are not sent to a baseline device', () => {
    for (const content of [
      { type: 'typing', kind: 'composing', until: 1 },
      { type: 'seen', upTo: 'a', at: 1 },
      { type: 'deleted', targetMessageId: 'a' },
      { type: 'botInfo', info: { kind: 0, name: 'b', description: '', greeting: '', commands: [], version: 1 } },
      { type: 'buttonPress', messageId: 'a', row: 0, index: 0, payload: new Uint8Array() },
      { type: 'transactionReference', reference: { chainId: 'c', hash: '0x01', status: 'inBlock', block: 1, note: '', intentMessageId: null } },
    ] as OutgoingContent[])
      expect('drop' in formFor(BASELINE, content)).toBe(true);
  });

  it('buttons become the menu as numbered text; tx buttons are left out without feature bit 1', () => {
    const rows = [[{ label: 'Yes', action: { tag: 'command' as const, value: '/yes' } }, { label: 'No', action: { tag: 'command' as const, value: '/no' } }]];
    expect(sent(BASELINE, { type: 'buttons', text: 'Sure?', rows, oneShot: true })).toEqual({ type: 'text', text: 'Sure?\n\n1. Yes · 2. No — reply with a number or the label' });
    expect(menuAsText('', rows)).toBe('1. Yes · 2. No — reply with a number or the label');
    const noTx = { ...OWN_CAPABILITIES, features: 1 };
    const withTx = [[rows[0]![0]!, { label: 'Pay', action: { tag: 'tx' as const, value: new Uint8Array([1]) } }]];
    expect(sent(noTx, { type: 'buttons', text: 't', rows: withTx, oneShot: false })).toEqual({ type: 'buttons', text: 't', rows: [[rows[0]![0]]], oneShot: false });
    expect(sent(OWN_CAPABILITIES, { type: 'buttons', text: 't', rows: withTx, oneShot: false })).toMatchObject({ type: 'buttons', rows: withTx });
  });

  it('group kinds are refused for a device that lacks them; a leave is simply not sent', () => {
    const control = { type: 'groupControl', control: { tag: 'keyRequest', value: { groupId: 'g', haveEpoch: 1 } } } as OutgoingContent;
    expect(formFor(BASELINE, control)).toEqual({ refuse: NO_GROUPS });
    expect(formFor({ ...OWN_CAPABILITIES, features: 2 }, control)).toEqual({ refuse: NO_GROUPS });
    expect(formFor(BASELINE, { type: 'groupLeave', groupId: 'g' })).toEqual({ drop: 'groupLeave' });
    expect('send' in formFor(OWN_CAPABILITIES, control)).toBe(true);
  });

  it('Bulletin chunks go only as the 0014 variant: never kind 250, refused where only HOP fits', () => {
    const content: OutgoingContent = { type: 'attachment', items: [item], caption: 'c' };
    expect(sent(OWN_CAPABILITIES, content)).toEqual({ type: 'bulletinFile', items: [item], caption: 'c' });
    expect(formFor(PCA_TRANSITION, content)).toEqual({ refuse: NO_FILE_RAIL });
    // Bulletin chunks cannot become a HOP file after the upload: the caller picks HOP before (fileRailOf).
    expect(formFor(BASELINE, content)).toEqual({ refuse: NO_FILE_RAIL });
  });

  it('a HOP file needs the legacy dialect; a peer with no common dialect is refused with the 0013 text', () => {
    const hop: OutgoingContent = { type: 'hopFile', text: null, attachment: { kind: 'general', mimeType: 'a/b', fileSize: 1 } };
    expect('send' in formFor(BASELINE, hop)).toBe(true);
    const aesOnly = { ...BASELINE, hopDialects: [1] };
    expect(formFor(aesOnly, hop)).toEqual({ refuse: NO_FILE_RAIL });
    expect(fileRailOf(aesOnly)).toBeNull();
    expect(NO_FILE_RAIL).toBe("This contact's app cannot receive files from this app.");
  });
});

describe('who may be put in a private group (owner ask 2026-09-24)', () => {
  // The picker and the manager's guard read this: a "ready" peer whose device cannot read
  // kind 249 would be sent a welcome it shows as "Unsupported message", and never get the key.
  const row = (device: typeof desktop, caps: typeof OWN_CAPABILITIES) => ({ device: hexOf(device.statementAccountId), caps });
  const noGroups = { ...OWN_CAPABILITIES, features: OWN_CAPABILITIES.features & ~1 };

  it('ready only when every known device advertised feature bit 0', () => {
    expect(groupSupportOf([desktop], [row(desktop, OWN_CAPABILITIES)], false)).toBe('ready');
  });

  it('a device that advertised a set without the bit: a client without group support', () => {
    expect(groupSupportOf([desktop], [row(desktop, noGroups)], false)).toBe('unsupported');
  });

  it('a phone that never advertised, next to a capable desktop, keeps the person out (0013: silent = baseline)', () => {
    expect(groupSupportOf([desktop, phone], [row(desktop, OWN_CAPABILITIES)], false)).toBe('unsupported');
  });

  it('nothing stored for the contact: not known yet (message them first), never ready', () => {
    expect(groupSupportOf([desktop, phone], [], false)).toBe('unknown');
    expect(groupSupportOf([], [], false, desktop.statementAccountId)).toBe('unknown');
  });

  it('a bot with its botInfo and no set counts as the pca transition set (M20), which has groups', () => {
    expect(groupSupportOf([desktop], [], true)).toBe('ready');
    expect(groupSupportOf([desktop], [row(desktop, noGroups)], true)).toBe('unsupported');
  });

  it('agrees with the send gate: ready exactly when a welcome (kind 249) would be sent', () => {
    const welcome = { type: 'groupControl', control: { tag: 'keyRequest', value: { groupId: 'g', epoch: 1 } } } as unknown as OutgoingContent;
    for (const [devices, rows] of [
      [[desktop], [row(desktop, OWN_CAPABILITIES)]],
      [[desktop], [row(desktop, noGroups)]],
      [[desktop, phone], [row(desktop, OWN_CAPABILITIES)]],
    ] as const) {
      const effective = effectiveOf(devices, new Map(rows.map(r => [r.device, r.caps])), BASELINE);
      expect(groupSupportOf(devices, rows, false) === 'ready').toBe('send' in formFor(effective, welcome));
    }
  });
});

describe('a silent contact after our set: baseline, not unknown (2026-09-24)', () => {
  // The phone apps never send a set. Once a device had ours and answered without one, waiting
  // longer tells us nothing new: "message them first" would send the owner in a circle.
  const row = (device: typeof desktop, caps: typeof OWN_CAPABILITIES) => ({ device: hexOf(device.statementAccountId), caps });
  const incoming = (timestamp: number, direction: 'incoming' | 'outgoing' = 'incoming') =>
    db.messages.put({ messageId: `m${timestamp}${direction}`, peerAccountId: PEER, timestamp, direction, status: 'sent', content: { type: 'text', text: 'hi' }, reactions: [], editedAt: null } as never);

  it('answered only by a message after our set went out', () => {
    expect(answeredOwnSet(null, 500)).toBe(false);
    expect(answeredOwnSet(1_000, null)).toBe(false);
    expect(answeredOwnSet(1_000, 900)).toBe(false);
    expect(answeredOwnSet(1_000, 1_001)).toBe(true);
  });

  it('never exchanged a message after our set: not known yet', () => {
    expect(groupSupportOf([phone], [], false, undefined, false)).toBe('unknown');
  });

  it('answered our set without one of its own: a client without group support', () => {
    expect(groupSupportOf([phone], [], false, undefined, true)).toBe('unsupported');
    expect(groupSupportOf([], [], false, phone.statementAccountId, true)).toBe('unsupported');
  });

  it('a contact that later advertises groups is ready, answered or not', () => {
    expect(groupSupportOf([desktop], [row(desktop, OWN_CAPABILITIES)], false, undefined, true)).toBe('ready');
  });

  it('from the stored rows: an older message or our own does not count, a later answer does, then a set wins', async () => {
    await incoming(900);
    await markCapabilitiesSent(PEER, OWN_CAPABILITIES, 1_000);
    await incoming(1_500, 'outgoing');
    expect(await loadAnsweredOwnSet(PEER)).toBe(false);
    expect(await loadGroupSupport(PEER, [phone], false)).toBe('unknown');

    await incoming(2_000);
    expect(await loadAnsweredOwnSet(PEER)).toBe(true);
    expect([...(await loadAnsweredPeers())]).toEqual([PEER]);
    expect(await loadGroupSupport(PEER, [phone], false)).toBe('unsupported');

    await storeCapabilities(PEER, phone.statementAccountId, OWN_CAPABILITIES, 2_500);
    expect(await loadGroupSupport(PEER, [phone], false)).toBe('ready');
  });

  it('a new chat or a new device clears the sent mark: not known yet again until they answer', async () => {
    await markCapabilitiesSent(PEER, OWN_CAPABILITIES, 1_000);
    await incoming(2_000);
    await capabilitiesUnsent(PEER);
    expect(await loadGroupSupport(PEER, [phone], false)).toBe('unknown');
  });
});
