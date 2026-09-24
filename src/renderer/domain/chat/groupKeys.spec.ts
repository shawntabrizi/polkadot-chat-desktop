// Spec 0011 vectors (docs/spec/vectors-0011.md), byte for byte. pca pins the
// same bytes in bot-core/test/codec.test.mjs; a bot and this app talk on one
// group topic only if both codecs and both key schedules agree exactly, so a
// change that breaks one of these breaks every mixed group.

import { statementCodec } from '@novasamatech/sdk-statement';
import { verifySr25519Signature } from '@novasamatech/statement-store';
import { compact } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { type HexString, bytesToHex, hexToBytes } from '../../app/bytes';

import {
  type GroupState,
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
  VARIANT,
  createGroupExpiryAllocator,
  deriveEpoch,
  entryHint,
  hash256,
  joinProof,
  makeRekeyEntry,
  open,
  openRekeyEntry,
  pairwiseSecret,
  seal,
  sealAad,
  wrapKey,
} from './groupKeys';
import { ChatMessageCodec, type ChatMessageWire } from './identityEvents';

const fill = (byte: number, length: number): Uint8Array => new Uint8Array(length).fill(byte);
const hex = (bytes: Uint8Array): string => bytesToHex(bytes).slice(2);
const acct = (byte: number): HexString => bytesToHex(fill(byte, 32));

const GROUP = 'GRP-2';
const K1 = fill(0x11, 32);
const K2 = fill(0x66, 32);
const A = acct(0x01);
const B = acct(0x02);

/** An opaque message: compact length + the remote message (how a carrier and a DM request hold it). */
const opaque = (message: ChatMessageWire): string => {
  const remote = ChatMessageCodec.enc(message);
  return hex(compact.enc(remote.length)) + hex(remote);
};
const remoteOf = (hexText: string): ChatMessageWire => {
  const bytes = hexToBytes(hexText);
  const length = compact.dec(bytes);
  return ChatMessageCodec.dec(bytes.slice(compact.enc(length).length));
};

describe('vector (a): epoch 1 derivations', () => {
  it('derives the topic, message key and the three channels from K_1 alone', () => {
    const ep = deriveEpoch(K1, GROUP, 1);
    expect(hex(ep.topic)).toBe('1050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78');
    expect(hex(ep.msgKey)).toBe('8934a29c1ff0f0abca5fff48cf5eb15e9acfa1e4be0fbd8593f790fb23145267');
    expect(hex(ep.channels.msgs)).toBe('4ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450');
    expect(hex(ep.channels.state)).toBe('e1be9084dc06e458f7caece2db5d292dac751f558d9d94b346079a774401f9a6');
    expect(hex(ep.channels.rekey)).toBe('5b7884e5795aaf767f27d9325455c20c4f8f22bb1215547041eb97e7bd98ce68');
  });

  it('gives a different topic in every epoch, so the store cannot link epochs by topic', () => {
    expect(hex(deriveEpoch(K1, GROUP, 2).topic)).not.toBe(hex(deriveEpoch(K1, GROUP, 1).topic));
  });
});

const TEXT = { messageId: 'GM-1', timestamp: 1720000002000n, versioned: { tag: 'v1', value: { tag: 'text', value: 'hello all' } } } as ChatMessageWire;
const OPAQUE_B = '6410474d2d31d037fd779001000000002468656c6c6f20616c6c';
const DATA_B =
  '002222222222222222222222223101518aa1d987c3ea031a7f5dfbbd628c3b24df6ceb1d68d3f221124b081a8a13f4bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049ca426a27af4b8387496497accf455808c';

describe('vector (b): a messages carrier from A', () => {
  it('encodes the opaque message, the plaintext, the AAD and the sealed GroupData', async () => {
    expect(opaque(TEXT)).toBe(OPAQUE_B);
    const plaintext = encodeGroupMessages(A, [ChatMessageCodec.enc(TEXT)]);
    expect(plaintext.length).toBe(60);
    expect(hex(plaintext)).toBe(`${'01'.repeat(32)}0004${OPAQUE_B}`);
    // vectors-0011.md (b) prints this AAD with one `01` too many (41 bytes);
    // b"grp" : A : u32 1 : 00 is 40 bytes, and the sealed bytes below (which
    // pca pins) only come out with 40 (docs/questions.md "## M16").
    expect(hex(sealAad(A, 1, VARIANT.messages))).toBe(`677270${'01'.repeat(32)}0100000000`);
    const sealed = await seal(deriveEpoch(K1, GROUP, 1).msgKey, { signer: A, epoch: 1, variant: VARIANT.messages, plaintext, nonce: fill(0x22, 12) });
    expect(hex(encodeGroupData({ tag: 'messages', value: sealed }))).toBe(DATA_B);
  });

  it('opens and decodes the vector back to the text', async () => {
    const data = decodeGroupData(hexToBytes(DATA_B));
    if (data.tag !== 'messages') throw new Error('not a carrier');
    const plaintext = await open(deriveEpoch(K1, GROUP, 1).msgKey, { signer: A, epoch: 1, variant: VARIANT.messages, sealed: data.value });
    const carrier = decodeGroupMessages(plaintext);
    expect(carrier.from).toBe(A);
    expect(ChatMessageCodec.dec(carrier.messages[0]!).versioned.value).toEqual({ tag: 'text', value: 'hello all' });
  });

  it('refuses the carrier under another signer: the AAD binds it to A', async () => {
    const data = decodeGroupData(hexToBytes(DATA_B));
    if (data.tag !== 'messages') throw new Error('not a carrier');
    await expect(open(deriveEpoch(K1, GROUP, 1).msgKey, { signer: B, epoch: 1, variant: VARIANT.messages, sealed: data.value })).rejects.toThrow();
  });

  it('refuses a topic that is Some in v2', () => {
    const bytes = hexToBytes(`${'01'.repeat(32)}01010000000400`);
    expect(() => decodeGroupMessages(bytes)).toThrow(/None/);
  });
});

const STATE_HEX =
  '144752502d32010000000100000028546573742067726f757000010000000000016408010101010101010101010101010101010101010101010101010101010101010102ff00000030fd7790010000020202020202020202020202020202020202020202020202020202020202020200010000e833fd779001000004333333333333333333333333333333334444444444444444444444444444444401010101010101010101010101010101010101010101010101010101010101010000000000000000000000000000000000000030fd7790010000';
const STATE: GroupState = {
  groupId: GROUP,
  epoch: 1,
  version: 1,
  name: 'Test group',
  avatar: undefined,
  defaultPermissions: 0x0001,
  slowModeSecs: 0,
  joinPolicy: 1,
  historyShare: 100,
  // B first on purpose: the encoder sorts by account.
  members: [
    { account: B, role: 0, permissions: 0x0001, posting: [], joinedAt: 1720000001000 },
    { account: A, role: 2, permissions: 0x00ff, posting: [], joinedAt: 1720000000000 },
  ],
  invites: [{ inviteId: fill(0x33, 16), secret: fill(0x44, 16), createdBy: A, expiresAt: 0, maxUses: 0, uses: 0 }],
  pinned: [],
  topics: undefined,
  createdAt: 1720000000000,
};
const SEALED_STATE_HEX =
  '012323232323232323232323239903123e6e97e44666b0255a664e8591e892283d70e77f62004ad60790d61c648caa5c5a7b5bffb73587cc5090001c58fb1e5525272ed171093f2a02a5a5b16bfd7f04067005123e351149441cdc0cb5e5ad47873dd0f63a43e6af6f6713b8a985073af067857637472b08de6b2d0fe240d1170ebcf12ed226d59f13bd374c5f2a6404a468304517b19ad17ed442e145aae68934f09c6cb514d61654f41c62b8753f341d3ae3e5a6c79e38863465961da9479baf2993e8bf5c57b9c5b78144b3a980b3c28d848e7609d635619824de6f2f3485505d9159959701c8deaadc4039bc3d496fa4c22a21';

describe('vector (c): GroupState version 1', () => {
  it('encodes 214 bytes, members sorted by account, and the unkeyed stateHash', () => {
    const bytes = encodeGroupState(STATE);
    expect(bytes.length).toBe(214);
    expect(hex(bytes)).toBe(STATE_HEX);
    expect(hex(hash256(bytes))).toBe('71cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35');
  });

  it('decodes the vector to the same state', () => {
    const state = decodeGroupState(hexToBytes(STATE_HEX));
    expect(state.members.map(m => m.account)).toEqual([A, B]);
    expect(state.invites[0]?.createdBy).toBe(A);
    expect(encodeGroupState(state)).toEqual(hexToBytes(STATE_HEX));
  });

  it('seals the state under the state variant and signer A', async () => {
    expect(hex(sealAad(A, 1, VARIANT.state))).toBe('67727001010101010101010101010101010101010101010101010101010101010101010100000001');
    const sealed = await seal(deriveEpoch(K1, GROUP, 1).msgKey, { signer: A, epoch: 1, variant: VARIANT.state, plaintext: hexToBytes(STATE_HEX), nonce: fill(0x23, 12) });
    expect(hex(encodeGroupData({ tag: 'state', value: sealed }))).toBe(SEALED_STATE_HEX);
  });

  it('refuses a state with two owners or with topics', () => {
    const twoOwners = encodeGroupState({ ...STATE, members: STATE.members.map(m => ({ ...m, role: 2 })) });
    expect(() => decodeGroupState(twoOwners)).toThrow(/owner/);
    const withTopics = hexToBytes(STATE_HEX.replace(/000030fd7790010000$/, '01000030fd7790010000'));
    expect(() => decodeGroupState(withTopics)).toThrow();
  });
});

const control = (messageId: string, timestamp: bigint, value: ChatMessageWire['versioned']['value']): ChatMessageWire => ({ messageId, timestamp, versioned: { tag: 'v1', value } });

describe('vectors (d), (e), (h): kind 249 groupControl', () => {
  const cases: [string, ChatMessageWire, string][] = [
    [
      'welcome (d)',
      control('GW-1', 1720000003000n, {
        tag: 'groupControl',
        value: { tag: 'welcome', value: { groupId: GROUP, epoch: 1, epochKey: K1, stateVersion: 1, stateHash: hexToBytes('0x71cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35') } },
      }),
      '79011047572d31b83bfd779001000000f900144752502d320100000011111111111111111111111111111111111111111111111111111111111111110100000071cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35',
    ],
    [
      'joinRequest (e)',
      control('GJ-1', 1720000004000n, {
        tag: 'groupControl',
        value: { tag: 'joinRequest', value: { groupId: GROUP, inviteId: fill(0x33, 16), proof: joinProof(fill(0x44, 16), B), note: 'hi' } },
      }),
      '250110474a2d31a03ffd779001000000f901144752502d3233333333333333333333333333333333eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f086869',
    ],
    [
      'history (h)',
      control('GH-1', 1720000005000n, {
        tag: 'groupControl',
        value: { tag: 'history', value: { groupId: GROUP, items: [{ from: A, message: ChatMessageCodec.enc(TEXT) }], last: true } },
      }),
      '49011047482d318843fd779001000000f903144752502d320401010101010101010101010101010101010101010101010101010101010101016410474d2d31d037fd779001000000002468656c6c6f20616c6c01',
    ],
    [
      'joinDecision (h)',
      control('GD-1', 1720000006000n, { tag: 'groupControl', value: { tag: 'joinDecision', value: { groupId: GROUP, inviteId: fill(0x33, 16), status: 0 } } }),
      '9c1047442d317047fd779001000000f902144752502d323333333333333333333333333333333300',
    ],
    [
      'keyRequest (h)',
      control('GK-1', 1720000007000n, { tag: 'groupControl', value: { tag: 'keyRequest', value: { groupId: GROUP, haveEpoch: 1 } } }),
      '6810474b2d31584bfd779001000000f904144752502d3201000000',
    ],
    [
      'historyRequest since a messageId (h)',
      control('GQ-1', 1720000008000n, {
        tag: 'groupControl',
        value: { tag: 'historyRequest', value: { groupId: GROUP, since: { tag: 'messageId', value: 'GM-1' }, limit: 100 } },
      }),
      '741047512d31404ffd779001000000f905144752502d320010474d2d3164',
    ],
    [
      'historyRequest since a timestamp (h)',
      control('GQ-2', 1720000008000n, {
        tag: 'groupControl',
        value: { tag: 'historyRequest', value: { groupId: GROUP, since: { tag: 'timestamp', value: 1720000000000 }, limit: 50 } },
      }),
      '801047512d32404ffd779001000000f905144752502d32010030fd779001000032',
    ],
  ];

  it.each(cases)('%s encodes and decodes byte for byte', (_name, message, vector) => {
    expect(opaque(message)).toBe(vector);
    expect(remoteOf(vector)).toEqual(message);
  });

  it('pins the join proof of vector (e)', () => {
    expect(hex(joinProof(fill(0x44, 16), B))).toBe('eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f');
  });

  it('reads a historyRequest limit of 0 as undecodable, never as a request', () => {
    const bad = '741047512d31404ffd779001000000f905144752502d320010474d2d3100';
    expect(remoteOf(bad).versioned.value).toEqual({ tag: 'undecodable', value: { kind: 249 } });
  });
});

describe('vector (f): the rekey entry for B with a stand-in K(A, B)', () => {
  it('derives WrapKey, the hint and the box', async () => {
    const kab = fill(0x55, 32);
    const wrap = wrapKey(kab, GROUP, 2);
    expect(hex(wrap)).toBe('a235cd89db89439c9653c8c57b87270814dee0f85bd96269118c6f8eb1507422');
    expect(hex(entryHint(wrap))).toBe('e88435e61ddfce6b');
    const entry = await makeRekeyEntry(kab, { groupId: GROUP, newEpoch: 2, newKey: K2, nonce: fill(0x77, 12) });
    expect(hex(entry.box)).toBe('15a235403c6ceca6c1243940b92fc447b3f19cddef5f65f531d7808e482be8a0e7293d5f70648b5dab4a0c43a1bf80c6');
  });
});

describe('vector (g): invite link', () => {
  it('encodes the link and its base64url form', () => {
    const link = { groupId: GROUP, name: 'Test group', admins: [A], inviteId: fill(0x33, 16), secret: fill(0x44, 16) };
    const bytes = encodeInviteLink(link);
    expect(hex(bytes)).toBe(
      '144752502d3228546573742067726f75700401010101010101010101010101010101010101010101010101010101010101013333333333333333333333333333333344444444444444444444444444444444',
    );
    expect(toBase64Url(bytes)).toBe('FEdSUC0yKFRlc3QgZ3JvdXAEAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEzMzMzMzMzMzMzMzMzMzMzRERERERERERERERERERERA');
    expect(decodeInviteLink(fromBase64Url(toBase64Url(bytes)))).toEqual(link);
  });
});

describe('vector (i): a real K(A, B) and a 3-entry Rekey', () => {
  const privA = fill(0x0a, 32);
  const privB = fill(0x0b, 32);
  const privC = fill(0x0c, 32);
  const pub = (hexText: string) => hexToBytes(`0x${hexText}`);
  const PUB_A = pub('f77ff4b10788bfdca62ca0bb160d427cf5762d85f2b5cad6807ec9c3febbde09');
  const PUB_B = pub('73b2d8b76aa9b53660032bc8f5d8bee3a3ae4e3b3a7fd49ade81f7347a34aa68');
  const PUB_C = pub('97c3b10b4d6c133a78ea5dcc1cf6421d3f81ae37b1f628ce14ca6fce7730f333');
  const REKEY_HEX =
    '02020000000cb15f17a0bfb8af0b777777777777777777777777dbd8cd740c9be5aab7e6491eb762d54cbafd76ba4e16172d4e39314bc80732091243fc23c759246c06ee2d11dc7ad59dc4308e7ad84cbaf7797979797979797979797979ef6aa68e222cbad29059038d624cb81b494e7174997965653bb378e63dcc1645d5adf5f8b63e8d1e3d412ba949d6ce22efe9e3c7fbfce4f5787878787878787878787878ee0eee9d9efd1676595fdb40359409c67530e199c596ae7edcfad16406b2c74731552a15be72a6aa22e5affed6d32862';

  it('K(A, B) is the raw X25519 agreement, the same from both sides', () => {
    expect(hex(pairwiseSecret(privA, PUB_B))).toBe('c09d8a17f54f06a53f844eacbc6273017581b9bc53b5f31f3d338cc3ffd7b86b');
    expect(hex(pairwiseSecret(privB, PUB_A))).toBe('c09d8a17f54f06a53f844eacbc6273017581b9bc53b5f31f3d338cc3ffd7b86b');
    expect(hex(pairwiseSecret(privA, PUB_A))).toBe('064b7cec534810674268cef049e065e9bd363d131a4a09a42be2059a9fb8ab61');
    expect(hex(pairwiseSecret(privA, PUB_C))).toBe('cf41b439fa7668d5fe9909b55584224eb2d94140dd93fb300232a881cebd2317');
    expect(hex(wrapKey(pairwiseSecret(privA, PUB_B), GROUP, 2))).toBe('a8e7aed9504f25bc13fd30a10a13885b037080c5e78821ecbeabe87a00364045');
  });

  it('encodes the rekey sorted by hint (210 bytes)', async () => {
    const entries = await Promise.all([
      makeRekeyEntry(pairwiseSecret(privA, PUB_A), { groupId: GROUP, newEpoch: 2, newKey: K2, nonce: fill(0x77, 12) }),
      makeRekeyEntry(pairwiseSecret(privA, PUB_B), { groupId: GROUP, newEpoch: 2, newKey: K2, nonce: fill(0x78, 12) }),
      makeRekeyEntry(pairwiseSecret(privA, PUB_C), { groupId: GROUP, newEpoch: 2, newKey: K2, nonce: fill(0x79, 12) }),
    ]);
    const bytes = encodeGroupData({ tag: 'rekey', value: { newEpoch: 2, entries } });
    expect(bytes.length).toBe(210);
    expect(hex(bytes)).toBe(REKEY_HEX);
  });

  it('opens for B and C; a removed fourth key finds no entry and cannot read epoch 2', async () => {
    const data = decodeGroupData(hexToBytes(REKEY_HEX));
    if (data.tag !== 'rekey') throw new Error('not a rekey');
    const params = { groupId: GROUP, newEpoch: 2, entries: data.value.entries };
    expect(await openRekeyEntry(pairwiseSecret(privB, PUB_A), params)).toEqual(K2);
    expect(await openRekeyEntry(pairwiseSecret(privC, PUB_A), params)).toEqual(K2);
    expect(await openRekeyEntry(pairwiseSecret(fill(0x0d, 32), PUB_A), params)).toBeNull();
  });
});

describe('vector (j): a full GroupStatement with an Sr25519 proof', () => {
  const SIGNER = '0xa83e8af1ed0f17a66fbf999cde3e95b2afb987e1eed2f762716d86d731263550' as HexString;
  const DATA_J =
    '002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec';
  const MATERIAL =
    '020079990180b0c36a034ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450041050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78086d01002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec';
  const SIGNATURE = 'c07d1cb890fbcd8d7fb09fc6ed22a57edc8ffa23106563b7aaea5fa9edc6054ad92a2371676dba0395529fd05e04ac2bacdc3c059e38d241f265bc9ae324ff85';

  it('seals with the statement signer in the AAD', async () => {
    const ep = deriveEpoch(K1, GROUP, 1);
    const plaintext = encodeGroupMessages(SIGNER, [ChatMessageCodec.enc(TEXT)]);
    const sealed = await seal(ep.msgKey, { signer: SIGNER, epoch: 1, variant: VARIANT.messages, plaintext, nonce: fill(0x22, 12) });
    expect(hex(encodeGroupData({ tag: 'messages', value: sealed }))).toBe(DATA_J);
  });

  it('the group expiry and the SDK statement codec give the signature material, and the vector signature verifies', () => {
    const now = 1_790_000_000;
    const expiry = createGroupExpiryAllocator(() => now * 1000).next();
    expect(expiry).toBe(0x6ac3b08001997900n);
    const ep = deriveEpoch(K1, GROUP, 1);
    const encoded: Uint8Array = statementCodec.enc({ expiry, channel: bytesToHex(ep.channels.msgs), topics: [bytesToHex(ep.topic)], data: hexToBytes(`0x${DATA_J}`) });
    const material = encoded.slice(compact.enc(compact.dec(encoded)).length);
    expect(hex(material)).toBe(MATERIAL);
    expect(verifySr25519Signature(material, hexToBytes(`0x${SIGNATURE}`), hexToBytes(SIGNER))).toBe(true);
  });

  it('never adopts a DM-level floor: a full account must not make a group statement evict DMs', () => {
    const next = createGroupExpiryAllocator(() => 1_790_000_000_000);
    const first = next.next();
    next.raiseFloor(0xffff_ffff_0000_0000n);
    expect(next.next()).toBe(first + 1n);
    next.raiseFloor(first + 10n);
    expect(next.next()).toBe(first + 11n);
  });

  it('the expiry rises on every submission, so a replacement always wins', () => {
    const next = createGroupExpiryAllocator(() => 1_790_000_000_000);
    const first = next.next();
    expect(next.next()).toBe(first + 1n);
  });
});
