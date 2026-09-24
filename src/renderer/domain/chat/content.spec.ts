import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { type TxIntent, decodeTxIntent, encodeTxIntent } from '../../../shared/txIntent';
import { bytesToHex, hexToBytes } from '../../app/bytes';

import { type BotInfo, type OutgoingContent, type TxReference, fromWire, isLiveFrame, keyboardOf, liveFrameText, previewOf, referenceLine, toWire } from './content';
import { BOT_INFO_BOUNDS, type ChatContent, ChatMessageCodec, GROUP_BOUNDS } from './identityEvents';

// Round-trip through the real codec: what we build must be what the apps decode.
const viaWire = (content: ChatContent): ChatContent =>
  ChatMessageCodec.dec(ChatMessageCodec.enc({ messageId: 'm', timestamp: 1n, versioned: { tag: 'v1', value: content } })).versioned.value;

describe('toWire', () => {
  it('encodes every outgoing variant as the apps expect', () => {
    expect(viaWire(toWire({ type: 'text', text: 'hi' }))).toEqual({ tag: 'text', value: 'hi' });
    expect(viaWire(toWire({ type: 'reply', messageId: 'a', text: 'yes' }))).toMatchObject({
      tag: 'reply',
      value: { messageId: 'a', ownContent: { text: 'yes' } },
    });
    expect(viaWire(toWire({ type: 'reaction', messageId: 'a', emoji: '🔥', add: true }))).toEqual({ tag: 'reacted', value: { messageId: 'a', emoji: '🔥' } });
    expect(viaWire(toWire({ type: 'reaction', messageId: 'a', emoji: '🔥', add: false }))).toEqual({ tag: 'reactionRemoved', value: { messageId: 'a', emoji: '🔥' } });
    expect(viaWire(toWire({ type: 'edit', messageId: 'a', text: 'new' }))).toMatchObject({ tag: 'edit', value: { messageId: 'a', newContent: { text: 'new' } } });
    expect(viaWire(toWire({ type: 'callDecline', offerMessageId: 'o' }))).toEqual({ tag: 'dataChannelClosed', value: { offerMessageId: 'o' } });
    expect(viaWire(toWire({ type: 'deleted', targetMessageId: 'a' }))).toEqual({ tag: 'deleted', value: { targetMessageId: 'a' } });
    expect(viaWire(toWire({ type: 'buttonPress', messageId: 'b', row: 1, index: 2, payload: new Uint8Array([7]) }))).toEqual({
      tag: 'buttonPress',
      value: { messageId: 'b', row: 1, index: 2, payload: new Uint8Array([7]) },
    });
  });
});

describe('kind 21: RFC-0003 deleted', () => {
  /*
   * Derived from base-spec.md "Remote Message Model", "Basic types" and
   * "Sending Requests and Responding":
   *   Message = { messageId: UUID, timestamp: u64, versioned: VersionedMessageContent }
   *   UUIDs are SCALE strings: compact(len) then UTF-8. compact(5) = 5 << 2 = 0x14.
   *   u64 is 8 bytes little endian: 1720000000000 = 0x0190_77fd_3000
   *     = 00 30 fd 77 90 01 00 00.
   *   VersionedMessageContent.V1 is enum index 0.
   *   MessageContent.deleted is index 21 = 0x15: RFC-0003 names 20, which
   *     mds.md already gives to deviceChatAccepted; its Unresolved Question 6
   *     takes the next free index (docs/decisions.md).
   *   DeletedContent = { messageId: UUID } = one SCALE string.
   *   In a Request, each message is an EncodedMessage: SCALE bytes, so
   *     compact(22) = 22 << 2 = 0x58 in front.
   *
   *   58                             compact(22): the message is 22 bytes
   *   14 44 45 4c 2d 31              messageId "DEL-1"
   *   00 30 fd 77 90 01 00 00        timestamp 1720000000000
   *   00                             V1
   *   15                             kind 21 (deleted)
   *   14 4d 53 47 2d 33              target "MSG-3"
   *
   * The same bytes are pinned on the pca side (polkadot-chat-agents branch
   * desktop/rfc-0003), so the two implementations agree byte for byte.
   */
  const PCA_VECTOR = '0x581444454c2d310030fd77900100000015144d53472d33';
  const message = {
    messageId: 'DEL-1',
    timestamp: 1720000000000n,
    versioned: { tag: 'v1' as const, value: { tag: 'deleted' as const, value: { targetMessageId: 'MSG-3' } } },
  };
  const opaque = Bytes();

  it('encodes byte for byte as the spec layout says, and as pca pins it', () => {
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(message)))).toBe(PCA_VECTOR);
  });

  it('decodes the pca vector back to the same message', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(PCA_VECTOR));
    expect(decoded).toEqual(message);
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'deleted', targetMessageId: 'MSG-3' });
  });

  // The accept handshake at index 20 must keep going through the SDK codec.
  it('leaves deviceChatAccepted (index 20) to the SDK codec, both ways', () => {
    const device = { statementAccountId: new Uint8Array(32).fill(7), encryptionPublicKey: new Uint8Array(32).fill(9) };
    const accepted = { messageId: 'acc', timestamp: 5n, versioned: { tag: 'v1' as const, value: { tag: 'deviceChatAccepted' as const, value: { requestId: 'req-1', device } } } };
    const bytes = SdkChatMessage.enc(accepted);
    expect(ChatMessageCodec.dec(bytes)).toEqual(accepted);
    expect(ChatMessageCodec.enc(accepted)).toEqual(bytes);
  });

  it('rejects a kind 21 with bytes after the target, so the entry counts as unsupported', () => {
    const bytes = opaque.dec(PCA_VECTOR);
    expect(() => ChatMessageCodec.dec(new Uint8Array([...bytes, 0]))).toThrow();
  });

  // An SDK-only client (an older app) cannot read kind 21: it fails to
  // decode, which the independent-decode rule turns into one unsupported
  // entry, not a broken batch.
  it('does not decode with the plain SDK codec', () => {
    expect(() => SdkChatMessage.dec(opaque.dec(PCA_VECTOR))).toThrow();
  });
});

describe('kinds 242/243: spec 0006 buttons and buttonPress', () => {
  /*
   * The two vectors of docs/spec/vectors-0006.md, produced by the pca codec
   * (bot-core/vendor/app-chat-codec.mjs, branch desktop/rfc-0003) and pinned
   * there too. Both codecs must read each other's bytes: a desktop that
   * decodes a bot's keyboard differently shows the wrong buttons, and a press
   * the bot cannot decode is a press that never happened.
   */
  const VECTOR_A =
    '0x45011442544e2d310030fd779001000000f2205069636b206f6e650808104563686f001c6563686f20686918436f6c6f7572010801020410446f6373025068747470733a2f2f706f6c6b61646f742e636f6d00';
  const VECTOR_B = '0x6c145052532d31e833fd779001000000f31442544e2d310001080102';
  const opaque = Bytes();
  const buttons = {
    messageId: 'BTN-1',
    timestamp: 1720000000000n,
    versioned: {
      tag: 'v1' as const,
      value: {
        tag: 'buttons' as const,
        value: {
          text: 'Pick one',
          rows: [
            [
              { label: 'Echo', action: { tag: 'command' as const, value: 'echo hi' } },
              { label: 'Colour', action: { tag: 'callback' as const, value: new Uint8Array([1, 2]) } },
            ],
            [{ label: 'Docs', action: { tag: 'url' as const, value: 'https://polkadot.com' } }],
          ],
          oneShot: false,
        },
      },
    },
  };
  const press = {
    messageId: 'PRS-1',
    timestamp: 1720000001000n,
    versioned: {
      tag: 'v1' as const,
      value: { tag: 'buttonPress' as const, value: { messageId: 'BTN-1', row: 0, index: 1, payload: new Uint8Array([1, 2]) } },
    },
  };

  it('decodes pca vector A (buttons) to the pinned values', () => {
    expect(ChatMessageCodec.dec(opaque.dec(VECTOR_A))).toEqual(buttons);
  });

  it('encodes vector A byte for byte', () => {
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(buttons)))).toBe(VECTOR_A);
  });

  it('decodes pca vector B (buttonPress) to the pinned values', () => {
    expect(ChatMessageCodec.dec(opaque.dec(VECTOR_B))).toEqual(press);
  });

  it('encodes vector B byte for byte', () => {
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(press)))).toBe(VECTOR_B);
  });

  // Coordinator ruling (M8): an Action has no length prefix, so an unknown
  // action tag (above 3) makes the whole keyboard unreadable. The user still
  // sees that the bot sent something: the normal unsupported bubble.
  it('shows a keyboard with an unknown action tag as the unsupported bubble, not as a button', () => {
    const tag4 = VECTOR_A.replace('104563686f00', '104563686f04');
    expect(tag4).not.toBe(VECTOR_A);
    const decoded = ChatMessageCodec.dec(opaque.dec(tag4));
    expect(decoded.messageId).toBe('BTN-1');
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'buttons' } });
    // Trailing bytes are malformed the same way.
    const trailing = ChatMessageCodec.dec(new Uint8Array([...opaque.dec(VECTOR_A), 0]));
    expect(fromWire(trailing.versioned.value)).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'buttons' } });
  });

  // A press this build cannot read is dropped: it must never become a bubble.
  it('drops a malformed buttonPress without a row', () => {
    const decoded = ChatMessageCodec.dec(new Uint8Array([...opaque.dec(VECTOR_B), 0]));
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'ignore' });
  });

  // The phone apps (SDK codec) cannot read these kinds: why the compatibility rule gates sending.
  it('does not decode with the plain SDK codec', () => {
    expect(() => SdkChatMessage.dec(opaque.dec(VECTOR_A))).toThrow();
    expect(() => SdkChatMessage.dec(opaque.dec(VECTOR_B))).toThrow();
  });

  it('decodes a reserved tx action (tag 3) as opaque bytes', () => {
    const tx = { ...buttons, versioned: { tag: 'v1' as const, value: { tag: 'buttons' as const, value: { text: 't', rows: [[{ label: 'Stake', action: { tag: 'tx' as const, value: new Uint8Array([9]) } }]], oneShot: true } } } };
    expect(ChatMessageCodec.dec(ChatMessageCodec.enc(tx))).toEqual(tx);
  });

  it('turns vector A into a keyboard row that renders, and vector B into a press effect (never a bubble)', () => {
    const effect = fromWire(ChatMessageCodec.dec(opaque.dec(VECTOR_A)).versioned.value);
    expect(effect).toEqual({
      kind: 'message',
      content: {
        type: 'buttons',
        text: 'Pick one',
        rows: [
          [
            { label: 'Echo', action: { kind: 'command', command: 'echo hi' } },
            { label: 'Colour', action: { kind: 'callback', payload: new Uint8Array([1, 2]) } },
          ],
          [{ label: 'Docs', action: { kind: 'url', url: 'https://polkadot.com' } }],
        ],
        oneShot: false,
        pressed: null,
      },
    });
    expect(fromWire(ChatMessageCodec.dec(opaque.dec(VECTOR_B)).versioned.value)).toEqual({ kind: 'buttonPress', messageId: 'BTN-1', row: 0, index: 1 });
  });

  it('the chat list shows the keyboard message by its text', () => {
    expect(previewOf({ type: 'buttons', text: 'Pick one', rows: [], oneShot: false, pressed: null })).toBe('Pick one');
  });
});

describe('kinds 240/241: spec 0005 typing and seen', () => {
  /*
   * Derived by hand from docs/spec/0005-typing-and-seen.md with the envelope
   * conventions of vectors-0006.md (compact length, messageId, u64 LE
   * timestamp, version 0, kind byte, content):
   *
   *   64                          compact(25): the message is 25 bytes
   *   14 54 59 50 2d 31           messageId "TYP-1"
   *   00 30 fd 77 90 01 00 00     timestamp 1720000000000
   *   00 f0                       V1, kind 240 typing
   *   70 47 fd 77 90 01 00 00     until 1720000006000 (u64 LE)
   *   01                          kind 1 = working
   *
   *   78                          compact(30)
   *   14 53 45 4e 2d 31           messageId "SEN-1"
   *   d0 37 fd 77 90 01 00 00     timestamp 1720000002000
   *   00 f1                       V1, kind 241 seen
   *   14 4d 53 47 2d 33           upTo "MSG-3"
   *   d0 37 fd 77 90 01 00 00     at 1720000002000
   *
   * Both are the pca vectors of docs/spec/vectors-0005.md (pca codec,
   * branch desktop/rfc-0003, pinned in bot-core/test/codec.test.mjs). My
   * hand derivation of A matched pca's bytes before the file arrived; B is
   * pinned with pca's values. A bot's `working` the desktop reads wrong is a
   * dead-looking bot; a `seen` pca cannot read is a tick that never turns.
   */
  const TYPING_VECTOR = '0x64145459502d310030fd779001000000f07047fd779001000001';
  const SEEN_VECTOR = '0x781453454e2d31d037fd779001000000f1144d53472d33d037fd7790010000';
  const opaque = Bytes();
  const typing = {
    messageId: 'TYP-1',
    timestamp: 1720000000000n,
    versioned: { tag: 'v1' as const, value: { tag: 'typing' as const, value: { until: 1720000006000n, kind: 1 } } },
  };
  const seen = {
    messageId: 'SEN-1',
    timestamp: 1720000002000n,
    versioned: { tag: 'v1' as const, value: { tag: 'seen' as const, value: { upTo: 'MSG-3', at: 1720000002000n } } },
  };

  it('encodes both byte for byte as the spec layout says', () => {
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(typing)))).toBe(TYPING_VECTOR);
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(seen)))).toBe(SEEN_VECTOR);
  });

  it('decodes both vectors to the values and the effects the manager acts on', () => {
    const t = ChatMessageCodec.dec(opaque.dec(TYPING_VECTOR));
    expect(t).toEqual(typing);
    expect(fromWire(t.versioned.value)).toEqual({ kind: 'typing', typing: 'working', until: 1720000006000 });
    const s = ChatMessageCodec.dec(opaque.dec(SEEN_VECTOR));
    expect(s).toEqual(seen);
    expect(fromWire(s.versioned.value)).toEqual({ kind: 'seen', upTo: 'MSG-3', at: 1720000002000 });
  });

  it('maps the three typing kinds both ways, and ignores a kind it does not know', () => {
    for (const [kind, byte] of [['composing', 0], ['working', 1], ['stopped', 2]] as const) {
      expect(viaWire(toWire({ type: 'typing', kind, until: 5 }))).toEqual({ tag: 'typing', value: { until: 5n, kind: byte } });
      expect(fromWire({ tag: 'typing', value: { until: 5n, kind: byte } })).toEqual({ kind: 'typing', typing: kind, until: 5 });
    }
    expect(fromWire({ tag: 'typing', value: { until: 5n, kind: 3 } })).toEqual({ kind: 'ignore' });
    expect(viaWire(toWire({ type: 'seen', upTo: 'x', at: 9 }))).toEqual({ tag: 'seen', value: { upTo: 'x', at: 9n } });
  });

  // A malformed signal must never become a bubble: it is `undecodable`,
  // which is nothing (a malformed keyboard is the only undecodable bubble).
  it('reads a malformed typing or seen as nothing, never a bubble', () => {
    for (const vector of [TYPING_VECTOR, SEEN_VECTOR]) {
      const bytes = opaque.dec(vector);
      const decoded = ChatMessageCodec.dec(bytes.slice(0, bytes.length - 1));
      expect(decoded.versioned.value.tag).toBe('undecodable');
      expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'ignore' });
    }
  });
});

describe('kind 244: spec 0008 botInfo', () => {
  /*
   * The vector of docs/spec/vectors-0008.md, produced by the pca codec
   * (bot-core/vendor/app-chat-codec.mjs `encodeOpaqueBotInfoMessage`, branch
   * desktop/rfc-0003) and pinned there too. A description the desktop reads
   * differently is a bot with the wrong badge, name or command menu.
   */
  const VECTOR =
    '0x010214424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b730100';
  const opaque = Bytes();
  const info = {
    kind: 1,
    name: 'Guide',
    description: 'Polkadot support guide',
    greeting: 'Hi! Ask me about Polkadot.',
    commands: [
      { name: 'staking', description: 'Staking basics' },
      { name: 'governance', description: 'How OpenGov works' },
    ],
    version: 1,
  };
  const message = {
    messageId: 'BOT-1',
    timestamp: 1720000000000n,
    versioned: { tag: 'v1' as const, value: { tag: 'botInfo' as const, value: info } },
  };

  it('decodes the pca vector byte for byte to the pinned values', () => {
    expect(ChatMessageCodec.dec(opaque.dec(VECTOR))).toEqual(message);
  });

  it('encodes the pinned values to the same bytes', () => {
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(message)))).toBe(VECTOR);
    expect(viaWire(toWire({ type: 'botInfo', info }))).toEqual({ tag: 'botInfo', value: info });
  });

  it('is an effect the manager stores, never a bubble', () => {
    // A v1 document: stored with no balance hint.
    expect(fromWire(ChatMessageCodec.dec(opaque.dec(VECTOR)).versioned.value)).toEqual({ kind: 'botInfo', info: { ...info, balance: null } });
  });

  it('keeps a kind byte this build does not know (a later revision may add kinds)', () => {
    expect(fromWire(viaWire(toWire({ type: 'botInfo', info: { ...info, kind: 7 } })))).toEqual({ kind: 'botInfo', info: { ...info, kind: 7, balance: null } });
  });

  // pca's decoder bounds (vectors-0008.md): over a bound the whole document is
  // unreadable, so both codecs agree on which descriptions exist.
  it('reads a document over a bound, or a truncated one, as nothing', () => {
    const over = [
      { ...info, name: 'n'.repeat(BOT_INFO_BOUNDS.name + 1) },
      { ...info, description: 'd'.repeat(BOT_INFO_BOUNDS.description + 1) },
      { ...info, commands: Array.from({ length: BOT_INFO_BOUNDS.commands + 1 }, (_, i) => ({ name: `c${i}`, description: '' })) },
      { ...info, commands: [{ name: 'c'.repeat(BOT_INFO_BOUNDS.commandName + 1), description: '' }] },
    ];
    for (const value of over) {
      const decoded = ChatMessageCodec.dec(ChatMessageCodec.enc({ ...message, versioned: { tag: 'v1', value: { tag: 'botInfo', value } } }));
      expect(decoded.versioned.value.tag).toBe('undecodable');
      expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'ignore' });
    }
    // At the bound it still reads.
    const atBound = { ...info, name: 'n'.repeat(BOT_INFO_BOUNDS.name) };
    expect(ChatMessageCodec.dec(ChatMessageCodec.enc({ ...message, versioned: { tag: 'v1', value: { tag: 'botInfo', value: atBound } } })).versioned.value.tag).toBe('botInfo');
    const bytes = opaque.dec(VECTOR);
    expect(fromWire(ChatMessageCodec.dec(bytes.slice(0, bytes.length - 1)).versioned.value)).toEqual({ kind: 'ignore' });
  });

  it('does not decode with the plain SDK codec', () => {
    expect(() => SdkChatMessage.dec(opaque.dec(VECTOR))).toThrow();
  });
});

describe('kind 244 v2: spec 0008 balance hint (M11b)', () => {
  // The Meter of docs/spec/contracts/meter.md, as pcdmeter declares it: a
  // client that reads the wrong contract or selector shows someone else's
  // number under the bot's name.
  const METER_HINT = {
    chainId: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
    contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
    selector: '0x70a08231',
    decimals: 18,
    unit: 'PAS',
    perReply: '100000000000000000',
    label: 'with Meter',
  };
  const info = { kind: 1, name: 'Meter', description: 'Pay per reply', greeting: '', commands: [], version: 2, balance: METER_HINT };
  const message = (value: ChatContent) => ({ messageId: 'BOT-2', timestamp: 1720000000000n, versioned: { tag: 'v1' as const, value } });

  /*
   * docs/spec/vectors-0008b.md, produced by the pca codec (BOT_INFO_BALANCE_VECTOR
   * in bot-core/test/codec.test.mjs): the BOT-1 document of vectors-0008 plus
   * the Meter hint.
   */
  const VECTOR_B =
    '0x010414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d65746572';
  const BOT_1 = {
    kind: 1,
    name: 'Guide',
    description: 'Polkadot support guide',
    greeting: 'Hi! Ask me about Polkadot.',
    commands: [
      { name: 'staking', description: 'Staking basics' },
      { name: 'governance', description: 'How OpenGov works' },
    ],
    version: 1,
    balance: METER_HINT,
  };

  it('decodes the pca vector (vectors-0008b) to the pinned values and encodes them to the same bytes', () => {
    const opaque = Bytes();
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_B));
    expect(decoded.messageId).toBe('BOT-1');
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'botInfo', info: BOT_1 });
    const encoded = ChatMessageCodec.enc({ messageId: 'BOT-1', timestamp: 1720000000000n, versioned: { tag: 'v1', value: toWire({ type: 'botInfo', info: BOT_1 }) } });
    expect(bytesToHex(opaque.enc(encoded))).toBe(VECTOR_B);
  });

  it('reads any byte after `version` other than 0x00 or 0x01 as nothing (vectors-0008b rule)', () => {
    const v1 = ChatMessageCodec.enc(message(toWire({ type: 'botInfo', info: { ...info, balance: null } })));
    expect(ChatMessageCodec.dec(new Uint8Array([...v1, 2])).versioned.value.tag).toBe('undecodable');
  });

  it('round-trips a hint: stored as hex and a decimal string, sent as bytes', () => {
    expect(fromWire(viaWire(toWire({ type: 'botInfo', info })))).toEqual({ kind: 'botInfo', info });
  });

  it('writes Some + the hint after `version`, and nothing there without one (v1 bytes stay v1)', () => {
    const withHint = ChatMessageCodec.enc(message(toWire({ type: 'botInfo', info })));
    const without = ChatMessageCodec.enc(message(toWire({ type: 'botInfo', info: { ...info, balance: null } })));
    expect(withHint.length).toBeGreaterThan(without.length);
    expect(withHint.slice(0, without.length)).toEqual(without);
    expect(withHint[without.length]).toBe(1);
  });

  it('reads an explicit None byte after `version` as no hint', () => {
    const v1 = ChatMessageCodec.enc(message(toWire({ type: 'botInfo', info: { ...info, balance: null } })));
    const withNone = new Uint8Array([...v1, 0]);
    expect(fromWire(ChatMessageCodec.dec(withNone).versioned.value)).toEqual({ kind: 'botInfo', info: { ...info, balance: null } });
  });

  // pca's bounds: a contract is 20 bytes and a selector 4; anything else is a
  // document this client must not act on, so the whole botInfo is unreadable.
  it('reads a hint with a wrong-size contract or selector, or an over-long label, as nothing', () => {
    const bad = [
      { ...METER_HINT, contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf' },
      { ...METER_HINT, selector: '0x70a0823100' },
      { ...METER_HINT, label: 'l'.repeat(BOT_INFO_BOUNDS.balanceLabel + 1) },
    ];
    for (const balance of bad) {
      const decoded = ChatMessageCodec.dec(ChatMessageCodec.enc(message(toWire({ type: 'botInfo', info: { ...info, balance } }))));
      expect(decoded.versioned.value.tag).toBe('undecodable');
    }
  });

  it('keeps a hint without a price (no "~N replies")', () => {
    const stake = { ...info, balance: { ...METER_HINT, perReply: null, label: 'your stake' } };
    expect(fromWire(viaWire(toWire({ type: 'botInfo', info: stake })))).toEqual({ kind: 'botInfo', info: stake });
  });
});

describe('kind 244 v3: spec 0008 pending on the balance hint (M12f)', () => {
  // The bot charges in batches, so the chain lags its view by what it has
  // metered. Without `pending` the header said 1 PAS while /balance said 0.7.
  const METER_HINT = {
    chainId: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
    contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
    selector: '0x70a08231',
    decimals: 18,
    unit: 'PAS',
    perReply: '100000000000000000',
    label: 'with Meter',
  };
  const BOT_1 = {
    kind: 1,
    name: 'Guide',
    description: 'Polkadot support guide',
    greeting: 'Hi! Ask me about Polkadot.',
    commands: [
      { name: 'staking', description: 'Staking basics' },
      { name: 'governance', description: 'How OpenGov works' },
    ],
    version: 1,
  };
  const opaque = Bytes();

  /*
   * docs/spec/vectors-0008c.md, produced by the pca codec (BOT_INFO_PENDING_VECTOR
   * in bot-core/test/codec.test.mjs), commit 7ec24fd of this repo.
   * (a): the v2 hint bytes alone; (b): the same with pending 0.3 PAS in the
   * contract's 1e18 scale; (c): the BOT-1 document carrying hint (b).
   */
  const HINT_A =
    '09013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d65746572';
  const HINT_B = `${HINT_A}0100009e1869d029040000000000000000`;
  const VECTOR_C =
    '0x450414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d657465720100009e1869d029040000000000000000';
  const PENDING = '300000000000000000';
  const encode = (info: BotInfo) =>
    bytesToHex(opaque.enc(ChatMessageCodec.enc({ messageId: 'BOT-1', timestamp: 1720000000000n, versioned: { tag: 'v1', value: toWire({ type: 'botInfo', info }) } })));

  it('decodes vector (c) to the pinned values and encodes them to the same bytes', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_C));
    const info = { ...BOT_1, balance: { ...METER_HINT, pending: PENDING } };
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'botInfo', info });
    expect(encode(info)).toBe(VECTOR_C);
    // The hint bytes are vector (b): vector (a) plus the 17 bytes of `pending`.
    expect(VECTOR_C.endsWith(HINT_B)).toBe(true);
  });

  // An older bot (and pcdflip) sends no pending: its v2 bytes (vectors-0008b,
  // whose hint is vector a) must still read, as a hint with no pending, and a
  // hint without pending must encode to the same v2 bytes.
  it('still decodes a v2 botInfo without pending (vector a), and writes nothing after `label` without one', () => {
    const v2 = `0x0104${VECTOR_C.slice(6, -HINT_B.length)}${HINT_A}`;
    const info = { ...BOT_1, balance: METER_HINT };
    const decoded = fromWire(ChatMessageCodec.dec(opaque.dec(v2)).versioned.value);
    expect(decoded).toEqual({ kind: 'botInfo', info });
    expect(decoded.kind === 'botInfo' ? decoded.info.balance && 'pending' in decoded.info.balance : true).toBe(false);
    expect(encode(info)).toBe(v2);
  });

  it('writes Some(0) for a pending of 0 (the bot sends it after a charge) and reads it back as 0, not as missing', () => {
    const info = { ...BOT_1, balance: { ...METER_HINT, pending: '0' } };
    expect(encode(info).endsWith(`${HINT_A}01${'00'.repeat(16)}`)).toBe(true);
    expect(fromWire(viaWire(toWire({ type: 'botInfo', info })))).toEqual({ kind: 'botInfo', info });
  });

  it('reads an explicit None after `label` as no pending, and any other tag as nothing', () => {
    const v2 = ChatMessageCodec.enc({ messageId: 'BOT-1', timestamp: 1720000000000n, versioned: { tag: 'v1', value: toWire({ type: 'botInfo', info: { ...BOT_1, balance: METER_HINT } }) } });
    expect(fromWire(ChatMessageCodec.dec(new Uint8Array([...v2, 0])).versioned.value)).toEqual({ kind: 'botInfo', info: { ...BOT_1, balance: METER_HINT } });
    expect(ChatMessageCodec.dec(new Uint8Array([...v2, 2])).versioned.value.tag).toBe('undecodable');
  });
});

describe('keyboardOf (what a received keyboard may contain)', () => {
  const label = (n: number) => `b${n}`;
  const command = (n: number) => ({ label: label(n), action: { tag: 'command' as const, value: `/c${n}` } });

  it('keeps at most 8 rows of 4 buttons, so a bot cannot flood the room with controls', () => {
    const rows = Array.from({ length: 10 }, (_, r) => Array.from({ length: 6 }, (_, i) => command(r * 10 + i)));
    const keyboard = keyboardOf(rows);
    expect(keyboard).toHaveLength(8);
    expect(keyboard.every(row => row.length === 4)).toBe(true);
    // Positions are the sender's, so a press names the button the bot means.
    expect(keyboard[2]?.[3]?.label).toBe('b23');
  });

  it('cuts a label at 40 characters without splitting an emoji', () => {
    const long = `${'a'.repeat(38)}🔥🔥🔥`;
    const label = keyboardOf([[{ label: long, action: { tag: 'command', value: 'x' } }]])[0]?.[0]?.label ?? '';
    expect([...label]).toHaveLength(40);
    expect(label.endsWith('🔥…')).toBe(true);
  });

  // M8 review ruling: over-limit keyboards are rejected, not cut. A cut
  // keyboard shows a bot the person never saw (a missing "Cancel", a clipped
  // amount); pca rejects the same bytes, so both clients show the same thing.
  it('rejects a received keyboard over the limits as unsupported, and keeps one at the limits', () => {
    const received = (rows: ReturnType<typeof command>[][]) => fromWire({ tag: 'buttons', value: { text: 'pick', rows, oneShot: false } });
    const grid = (r: number, c: number) => Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => command(i * 10 + j)));
    const rejected = { kind: 'message', content: { type: 'unsupported', tag: 'buttons' } };
    expect(received(grid(9, 1))).toEqual(rejected);
    expect(received(grid(1, 5))).toEqual(rejected);
    expect(received([[{ label: 'a'.repeat(41), action: { tag: 'command', value: 'x' } }]])).toEqual(rejected);
    const atLimit = received([...grid(7, 4), [{ label: `${'a'.repeat(38)}🔥🔥`, action: { tag: 'command', value: 'x' } }]]);
    expect(atLimit).toMatchObject({ kind: 'message', content: { type: 'buttons' } });
    const rows = atLimit.kind === 'message' && atLimit.content.type === 'buttons' ? atLimit.content.rows : [];
    expect(rows).toHaveLength(8);
    expect(rows[7]?.[0]?.label).toBe(`${'a'.repeat(38)}🔥🔥`);
  });

  it('disables what this client must not run: tx, links that are not https/polkadotapp, oversized callbacks', () => {
    const keyboard = keyboardOf([
      [
        { label: 'tx', action: { tag: 'tx', value: new Uint8Array([1]) } },
        { label: 'http', action: { tag: 'url', value: 'http://example.com' } },
        { label: 'js', action: { tag: 'url', value: 'javascript:alert(1)' } },
        { label: 'big', action: { tag: 'callback', value: new Uint8Array(257) } },
      ],
      [
        { label: 'app', action: { tag: 'url', value: 'polkadotapp://chat/x' } },
        { label: 'max', action: { tag: 'callback', value: new Uint8Array(256) } },
      ],
    ]);
    expect(keyboard[0]?.map(button => button.action.kind)).toEqual(['unsupported', 'unsupported', 'unsupported', 'unsupported']);
    expect(keyboard[1]?.map(button => button.action.kind)).toEqual(['url', 'callback']);
  });
});

describe('isLiveFrame', () => {
  it('is true only for a text that starts with the pca hourglass and a space', () => {
    expect(isLiveFrame({ type: 'text', text: '⏳ working · 3s' })).toBe(true);
    expect(isLiveFrame({ type: 'text', text: '⏳ working · 1m 02s · step 4\n▸ Reading notes.md' })).toBe(true);
    // The terminal receipt and the answer are normal bubbles.
    expect(isLiveFrame({ type: 'text', text: '✓ Answered in 12s · 3 steps' })).toBe(false);
    expect(isLiveFrame({ type: 'text', text: 'Here is the answer' })).toBe(false);
    expect(isLiveFrame({ type: 'text', text: '⏳working' })).toBe(false);
    expect(isLiveFrame({ type: 'text', text: 'wait ⏳ ' })).toBe(false);
    expect(isLiveFrame({ type: 'reply', messageId: 'a', text: '⏳ working' })).toBe(false);
    expect(isLiveFrame({ type: 'deleted' })).toBe(false);
  });

  it("treats pca's first placeholder (thinking face and a space) as a live frame too", () => {
    // Without this the placeholder flashes as a normal bubble before the first ⏳ frame.
    expect(isLiveFrame({ type: 'text', text: '🤔 One moment — thinking…' })).toBe(true);
    expect(isLiveFrame({ type: 'text', text: '🤔hmm' })).toBe(false);
    expect(isLiveFrame({ type: 'text', text: 'I am not sure 🤔 ' })).toBe(false);
  });

  it('drops the hourglass for display', () => {
    expect(liveFrameText('⏳ working · 3s\n▸ step')).toBe('working · 3s\n▸ step');
    expect(liveFrameText('🤔 One moment — thinking…')).toBe('One moment — thinking…');
  });
});

describe('fromWire', () => {
  it('maps text, richText with attachment placeholders, and replies to message rows', () => {
    expect(fromWire(viaWire({ tag: 'text', value: 'hello' }))).toEqual({ kind: 'message', content: { type: 'text', text: 'hello' } });
    expect(
      fromWire(
        viaWire({
          tag: 'richText',
          value: {
            text: 'photo',
            attachments: [
              {
                tag: 'p2pMixnet',
                value: {
                  identifier: new Uint8Array([1]),
                  claimTicket: new Uint8Array([2]),
                  nodeEndpoint: { tag: 'wssUrl', value: { url: 'wss://hop' } },
                  meta: { tag: 'image', value: { general: { mimeType: 'image/png', fileSize: 10 }, width: 1, height: 1, thumbnail: undefined } },
                },
              },
            ],
          },
        }),
      ),
    ).toEqual({ kind: 'message', content: { type: 'richText', text: 'photo', attachments: [{ kind: 'image', mimeType: 'image/png', fileSize: 10 }] } });
    expect(fromWire(viaWire({ tag: 'reply', value: { messageId: 'a', ownContent: { text: 'yes', attachments: undefined } } }))).toEqual({
      kind: 'message',
      content: { type: 'reply', messageId: 'a', text: 'yes' },
    });
  });

  it('turns reactions, edits and call offers into effects, not rows', () => {
    expect(fromWire({ tag: 'reacted', value: { messageId: 'a', emoji: '👍' } })).toEqual({ kind: 'reaction', messageId: 'a', emoji: '👍', add: true });
    expect(fromWire({ tag: 'reactionRemoved', value: { messageId: 'a', emoji: '👍' } })).toEqual({ kind: 'reaction', messageId: 'a', emoji: '👍', add: false });
    expect(fromWire({ tag: 'edit', value: { messageId: 'a', newContent: { text: 'x', attachments: undefined } } })).toEqual({ kind: 'edit', messageId: 'a', text: 'x' });
    expect(fromWire({ tag: 'dataChannelOffer', value: { sdp: new Uint8Array(), purpose: 'AUDIO_CALL' } })).toEqual({ kind: 'callOffer' });
  });

  it('shows system and unsupported content instead of hiding it', () => {
    expect(fromWire({ tag: 'contactAdded', value: undefined })).toEqual({ kind: 'message', content: { type: 'contactAdded' } });
    expect(fromWire({ tag: 'leftChat', value: undefined })).toEqual({ kind: 'message', content: { type: 'leftChat' } });
    expect(fromWire({ tag: 'coinagePayment', value: { totalValue: 1n, coinKeys: [] } })).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'coinagePayment' } });
  });

  it('routes roster variants and ignores signalling, tokens and accepts', () => {
    const id = new Uint8Array(32).fill(1);
    expect(fromWire({ tag: 'deviceAdded', value: { statementAccountId: id, encryptionPublicKey: id } })).toMatchObject({ kind: 'deviceAdded' });
    expect(fromWire({ tag: 'deviceRemoved', value: { statementAccountId: id } })).toMatchObject({ kind: 'deviceRemoved' });
    expect(fromWire({ tag: 'dataChannelAnswer', value: { offerMessageId: 'o', sdp: new Uint8Array() } })).toEqual({ kind: 'ignore' });
    expect(fromWire({ tag: 'token', value: { token: '0x00', platform: 'iOS' } })).toEqual({ kind: 'ignore' });
    expect(fromWire({ tag: 'deviceChatAccepted', value: { requestId: 'r', device: { statementAccountId: id, encryptionPublicKey: id } } })).toEqual({ kind: 'ignore' });
  });

  it('drops an unknown tag with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(fromWire({ tag: 'somethingNew', value: 1 } as unknown as ChatContent)).toEqual({ kind: 'ignore' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown content tag'), 'somethingNew');
    warn.mockRestore();
  });
});

describe('previewOf', () => {
  it('gives one line per content type', () => {
    expect(previewOf({ type: 'text', text: 'a' })).toBe('a');
    expect(previewOf({ type: 'richText', text: null, attachments: [{ kind: 'image', mimeType: 'x', fileSize: 1 }] })).toBe('[1 attachment(s)]');
    expect(previewOf({ type: 'contactAdded' })).toBe('Chat accepted');
    expect(previewOf({ type: 'unsupported', tag: 'send' })).toBe('Unsupported message (send)');
    expect(previewOf({ type: 'deleted' })).toBe('Message deleted');
    expect(previewOf({ type: 'botGreeting', text: 'Hi!' })).toBe('Hi!');
  });
});

describe('kind 245 and the tx action: spec 0007', () => {
  /*
   * The two vectors of docs/spec/vectors-0007.md, produced by the pca codec
   * (bot-core/vendor/app-chat-codec.mjs) on 2026-09-23. Both sides must read
   * each other's bytes, or a bot's Top up button and our references are lost.
   */
  const VECTOR_A =
    '0x35031054582d310030fd779001000000f248546f7020757020746f20636f6e74696e7565040430546f7020757020312050415303610201090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303004010150111111111111111111111111111111111111111110deadbeef00e40b5402000000000000000000000000000018546f702075702841646473203120504153010431010c50415301601afe779001000000';
  const INTENT_A =
    '0x01090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303004010150111111111111111111111111111111111111111110deadbeef00e40b5402000000000000000000000000000018546f702075702841646473203120504153010431010c50415301601afe7790010000';
  const VECTOR_B =
    '0x4502145245462d311057fd779001000000f5090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303080222222222222222222222222222222222222222222222222222222222222222201017b0000003c546f702d7570206f66203120504153011054582d31';
  const opaque = Bytes();
  const ZERO_CHAIN = `0x${'0'.repeat(64)}`;
  const intentA: TxIntent = {
    version: 1,
    chainId: ZERO_CHAIN,
    calls: [
      {
        kind: 1,
        to: new Uint8Array(20).fill(0x11),
        data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        value: 10_000_000_000n,
        gasRefTime: undefined,
        gasProofSize: undefined,
        storageDepositLimit: undefined,
      },
    ],
    display: { title: 'Top up', description: 'Adds 1 PAS', amount: '1', asset: 'PAS' },
    dryRunRequired: true,
    expiresAt: 1_720_000_060_000n,
  };
  const reference = {
    messageId: 'REF-1',
    timestamp: 1_720_000_010_000n,
    versioned: {
      tag: 'v1' as const,
      value: {
        tag: 'transactionReference' as const,
        value: { chainId: ZERO_CHAIN, hash: new Uint8Array(32).fill(0x22), status: 1, block: 123, note: 'Top-up of 1 PAS', intentMessageId: 'TX-1' },
      },
    },
  };

  it('decodes the TxIntent of vector A byte for byte, and encodes it back to the same bytes', () => {
    expect(decodeTxIntent(hexToBytes(INTENT_A))).toEqual(intentA);
    expect(bytesToHex(encodeTxIntent(intentA))).toBe(INTENT_A);
  });

  it('decodes vector A into a runnable tx button that keeps the intent bytes', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_A));
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(decoded)))).toBe(VECTOR_A);
    const effect = fromWire(decoded.versioned.value);
    expect(effect).toMatchObject({ kind: 'message', content: { type: 'buttons', text: 'Top up to continue' } });
    const button = effect.kind === 'message' && effect.content.type === 'buttons' ? effect.content.rows[0]?.[0] : undefined;
    expect(button?.label).toBe('Top up 1 PAS');
    expect(button?.action.kind).toBe('tx');
    expect(button?.action.kind === 'tx' ? bytesToHex(button.action.intent) : null).toBe(INTENT_A);
  });

  it('decodes vector B byte for byte, and encodes it back to the same bytes', () => {
    expect(ChatMessageCodec.dec(opaque.dec(VECTOR_B))).toEqual(reference);
    expect(bytesToHex(opaque.enc(ChatMessageCodec.enc(reference)))).toBe(VECTOR_B);
  });

  it('turns vector B into a reference effect with a hex hash, and our own reference into the same bytes', () => {
    const effect = fromWire(ChatMessageCodec.dec(opaque.dec(VECTOR_B)).versioned.value);
    const expected: TxReference = { chainId: ZERO_CHAIN, hash: `0x${'22'.repeat(32)}`, status: 'inBlock', block: 123, note: 'Top-up of 1 PAS', intentMessageId: 'TX-1' };
    expect(effect).toEqual({ kind: 'transactionReference', reference: expected });
    expect(viaWire(toWire({ type: 'transactionReference', reference: { ...expected, error: 'local only' } }))).toEqual(reference.versioned.value);
  });

  it('shows a reference it cannot read (unknown status, trailing bytes, hash too long) as the unsupported bubble', () => {
    const unsupported = { kind: 'message', content: { type: 'unsupported', tag: 'transactionReference' } };
    const bytes = opaque.dec(VECTOR_B);
    const withStatus = (status: number) => {
      const copy = new Uint8Array(bytes);
      // The status byte follows the 32-byte hash: header 16, chainId 68, hash 33.
      copy[16 + 68 + 33] = status;
      return copy;
    };
    expect(fromWire(ChatMessageCodec.dec(withStatus(2)).versioned.value)).toMatchObject({ kind: 'transactionReference', reference: { status: 'finalized' } });
    expect(fromWire(ChatMessageCodec.dec(withStatus(4)).versioned.value)).toEqual(unsupported);
    expect(fromWire(ChatMessageCodec.dec(new Uint8Array([...bytes, 0])).versioned.value)).toEqual(unsupported);
    const long = { ...reference, versioned: { tag: 'v1' as const, value: { ...reference.versioned.value, value: { ...reference.versioned.value.value, hash: new Uint8Array(65) } } } };
    expect(fromWire(ChatMessageCodec.dec(ChatMessageCodec.enc(long)).versioned.value)).toEqual(unsupported);
  });

  it('keeps a tx button whose intent does not decode disabled', () => {
    const keyboard = keyboardOf([[{ label: 'Pay', action: { tag: 'tx', value: new Uint8Array([...hexToBytes(INTENT_A), 0]) } }]]);
    expect(keyboard[0]?.[0]?.action).toEqual({ kind: 'unsupported' });
  });

  it('the chat list line says what the transaction is and where it stands', () => {
    const base: TxReference = { chainId: ZERO_CHAIN, hash: '0x22', status: 'submitted', block: null, note: 'Top-up of 1 PAS', intentMessageId: null };
    expect(previewOf({ type: 'transactionReference', reference: base })).toBe('Top-up of 1 PAS · submitted');
    expect(previewOf({ type: 'transactionReference', reference: { ...base, status: 'inBlock', block: 123 } })).toBe('Top-up of 1 PAS · in block #123');
    expect(previewOf({ type: 'transactionReference', reference: { ...base, status: 'finalized', block: 123 } })).toBe('Top-up of 1 PAS · finalized in block #123');
    expect(previewOf({ type: 'transactionReference', reference: { ...base, status: 'failed', error: 'not enough funds' } })).toBe('Top-up of 1 PAS · failed: not enough funds');
    expect(referenceLine({ ...base, note: '' })).toBe('Transaction · submitted');
  });
});

describe('kinds 246/247/248: spec 0009 groups', () => {
  const alice = `0x${'aa'.repeat(32)}` as const;
  const bob = `0x${'bb'.repeat(32)}` as const;
  const info = {
    groupId: '6f1f5c1e-2b7a-4c55-9f0e-0f5d6c7b8a90',
    name: 'Crew',
    admin: alice,
    members: [
      { account: alice, username: 'alice.01', joinedAt: 1_700_000_000_000 },
      { account: bob, username: 'bob.02', joinedAt: 1_700_000_000_500 },
    ],
    version: 3,
    createdAt: 1_700_000_000_000,
  };
  const encode = (content: ChatContent): Uint8Array => ChatMessageCodec.enc({ messageId: 'env', timestamp: 7n, versioned: { tag: 'v1', value: content } });

  it('round-trips groupInfo and groupLeave through the codec and back to the stored form', () => {
    expect(fromWire(viaWire(toWire({ type: 'groupInfo', info })))).toEqual({ kind: 'groupInfo', info });
    expect(fromWire(viaWire(toWire({ type: 'groupLeave', groupId: info.groupId })))).toEqual({ kind: 'groupLeave', groupId: info.groupId });
  });

  it('writes the kind byte after the header: 246, 247, 248', () => {
    // Header: messageId "env" (compact 3 + 3 bytes), timestamp u64, version 0; then the kind.
    const kindAt = 1 + 3 + 8 + 1;
    expect(encode(toWire({ type: 'groupInfo', info }))[kindAt]).toBe(246);
    expect(encode(toWire({ type: 'groupMessage', groupId: 'g', infoVersion: 1, seq: 1, content: { type: 'text', text: 'x' } }))[kindAt]).toBe(247);
    expect(encode(toWire({ type: 'groupLeave', groupId: 'g' }))[kindAt]).toBe(248);
  });

  it('wraps a base kind and an extension kind: the inner bytes are the 1:1 content bytes after the header', () => {
    const inners: OutgoingContent[] = [
      { type: 'text', text: 'hello all' },
      { type: 'reply', messageId: 'm1', text: 'yes' },
      { type: 'buttons', text: 'Pick', rows: [[{ label: 'Go', action: { tag: 'command', value: '/go' } }]], oneShot: false },
      { type: 'deleted', targetMessageId: 'm1' },
      { type: 'typing', kind: 'working', until: 5 },
    ];
    for (const inner of inners) {
      const wrapped = toWire({ type: 'groupMessage', groupId: 'g-1', infoVersion: 2, seq: 9, content: inner });
      const effect = fromWire(viaWire(wrapped));
      expect(effect).toMatchObject({ kind: 'groupMessage', groupId: 'g-1', infoVersion: 2, seq: 9 });
      if (effect.kind === 'groupMessage') expect(effect.effect).toEqual(fromWire(viaWire(toWire(inner))));
      // Byte layout: the 1:1 message's content (after messageId "env", timestamp and version) ends the group message.
      const plain = encode(toWire(inner)).slice(1 + 3 + 8 + 1);
      const whole = encode(wrapped);
      expect(bytesToHex(whole.slice(whole.length - plain.length))).toBe(bytesToHex(plain));
    }
  });

  it('refuses to nest a group kind, both ways', () => {
    expect(() => encode(toWire({ type: 'groupMessage', groupId: 'g', infoVersion: 1, seq: 1, content: { type: 'groupLeave', groupId: 'g' } }))).toThrow();
    // Hand-built: a groupMessage whose inner kind is 248.
    const leave = encode(toWire({ type: 'groupLeave', groupId: 'g' })).slice(1 + 3 + 8 + 1);
    const text = encode(toWire({ type: 'groupMessage', groupId: 'g', infoVersion: 1, seq: 1, content: { type: 'text', text: 'x' } }));
    const innerAt = text.length - encode(toWire({ type: 'text', text: 'x' })).slice(1 + 3 + 8 + 1).length;
    const nested = new Uint8Array([...text.slice(0, innerAt), ...leave]);
    expect(ChatMessageCodec.dec(nested).versioned.value).toEqual({ tag: 'undecodable', value: { kind: 247 } });
    expect(fromWire(ChatMessageCodec.dec(nested).versioned.value)).toEqual({ kind: 'ignore' });
  });

  it('a roster over the bounds (17 members, a long name) is undecodable and ignored', () => {
    const many = Array.from({ length: GROUP_BOUNDS.members + 1 }, (_, i) => ({ account: `0x${i.toString(16).padStart(2, '0').repeat(32)}` as const, username: `m${i}`, joinedAt: 1 }));
    const over = encode({ tag: 'groupInfo', value: { groupId: 'g', name: 'x', admin: hexToBytes(alice), members: many.map(m => ({ account: hexToBytes(m.account), username: m.username, joinedAt: 1n })), version: 1, createdAt: 1n } });
    expect(ChatMessageCodec.dec(over).versioned.value).toEqual({ tag: 'undecodable', value: { kind: 246 } });
    const long = encode({ tag: 'groupInfo', value: { groupId: 'g', name: 'é'.repeat(121), admin: hexToBytes(alice), members: [{ account: hexToBytes(alice), username: 'a', joinedAt: 1n }], version: 1, createdAt: 1n } });
    expect(fromWire(ChatMessageCodec.dec(long).versioned.value)).toEqual({ kind: 'ignore' });
  });

  /*
   * docs/spec/vectors-0009.md, produced by the pca codec (GROUP_INFO_VECTOR,
   * GROUP_MESSAGE_VECTOR, GROUP_LEAVE_VECTOR in bot-core/test/codec.test.mjs).
   * Each is the opaque form: a compact length, then the remote message.
   */
  const one = `0x${'01'.repeat(32)}` as const;
  const two = `0x${'02'.repeat(32)}` as const;
  const VECTOR_INFO =
    '0xb902144752502d310030fd779001000000f6144752502d3128546573742067726f7570010101010101010101010101010101010101010101010101010101010101010108010101010101010101010101010101010101010101010101010101010101010120616c6963652e30310030fd7790010000020202020202020202020202020202020202020202020202020202020202020218626f622e3032e833fd7790010000010000000030fd7790010000';
  const VECTOR_MESSAGE = '0xb41447524d2d31d037fd779001000000f7144752502d31010000000100000000000000002468656c6c6f20616c6c';
  const VECTOR_LEAVE = '0x581447524c2d31b83bfd779001000000f8144752502d31';
  const GRP_1 = {
    groupId: 'GRP-1',
    name: 'Test group',
    admin: one,
    members: [
      { account: one, username: 'alice.01', joinedAt: 1720000000000 },
      { account: two, username: 'bob.02', joinedAt: 1720000001000 },
    ],
    version: 1,
    createdAt: 1720000000000,
  };
  const opaque = Bytes();
  const opaqueOf = (messageId: string, timestamp: bigint, content: ChatContent) =>
    bytesToHex(opaque.enc(ChatMessageCodec.enc({ messageId, timestamp, versioned: { tag: 'v1', value: content } })));

  it('decodes vector (a) groupInfo GRP-1 to the pinned values and encodes them to the same 176 bytes', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_INFO));
    expect(decoded.messageId).toBe('GRP-1');
    expect(decoded.timestamp).toBe(1720000000000n);
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'groupInfo', info: GRP_1 });
    expect(opaqueOf('GRP-1', 1720000000000n, toWire({ type: 'groupInfo', info: GRP_1 }))).toBe(VECTOR_INFO);
    expect(hexToBytes(VECTOR_INFO).length).toBe(176);
  });

  it('decodes vector (b) groupMessage GRM-1 (text "hello all" inline) and encodes it to the same 46 bytes', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_MESSAGE));
    expect(decoded.messageId).toBe('GRM-1');
    expect(decoded.timestamp).toBe(1720000002000n);
    expect(fromWire(decoded.versioned.value)).toEqual({
      kind: 'groupMessage',
      groupId: 'GRP-1',
      infoVersion: 1,
      seq: 1,
      effect: { kind: 'message', content: { type: 'text', text: 'hello all' } },
    });
    const wire = toWire({ type: 'groupMessage', groupId: 'GRP-1', infoVersion: 1, seq: 1, content: { type: 'text', text: 'hello all' } });
    expect(opaqueOf('GRM-1', 1720000002000n, wire)).toBe(VECTOR_MESSAGE);
    expect(hexToBytes(VECTOR_MESSAGE).length).toBe(46);
  });

  it('decodes vector (c) groupLeave GRL-1 and encodes it to the same 23 bytes', () => {
    const decoded = ChatMessageCodec.dec(opaque.dec(VECTOR_LEAVE));
    expect(decoded.messageId).toBe('GRL-1');
    expect(decoded.timestamp).toBe(1720000003000n);
    expect(fromWire(decoded.versioned.value)).toEqual({ kind: 'groupLeave', groupId: 'GRP-1' });
    expect(opaqueOf('GRL-1', 1720000003000n, toWire({ type: 'groupLeave', groupId: 'GRP-1' }))).toBe(VECTOR_LEAVE);
    expect(hexToBytes(VECTOR_LEAVE).length).toBe(23);
  });

  it('a groupMessage with no content byte is undecodable (vectors-0009 rule)', () => {
    const empty = opaque.dec(VECTOR_MESSAGE).slice(0, -('hello all'.length + 2));
    expect(ChatMessageCodec.dec(empty).versioned.value).toEqual({ tag: 'undecodable', value: { kind: 247 } });
  });

  it('clips a long name to 60 characters on the way out', () => {
    const effect = fromWire(viaWire(toWire({ type: 'groupInfo', info: { ...info, name: 'n'.repeat(80) } })));
    expect(effect.kind === 'groupInfo' ? [...effect.info.name].length : 0).toBe(60);
  });
});

describe('kind 250: spec 0012 attachment (vectors-0012.md)', () => {
  // The bytes are copied from docs/spec/vectors-0012.md, computed by hand and
  // pinned on the pca side too: both codecs must read and write them exactly,
  // or a desktop photo is unreadable for a bot (and the reverse).
  const opaque = Bytes();
  const GENESIS = '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59';
  const VECTOR_A =
    '0x0503144154542d310030fd779001000000fa0428696d6167652f6a706567000f000000000000000180020000e001000001304c454856366e574232796b3800111111111111111111111111111111111111111111111111111111111111111122222222222222222222222280841e0004d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a00e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5900003816c090010000011c4f757220636174';
  const VECTOR_B =
    '0x5104144154542d320030fd779001000000fa0458617564696f2f6f67673b20636f646563733d6f707573000d00000000000000036810000010004080ff000011111111111111111111111111111111111111111111111111111111111111112222222222222222222222220800000008f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb47e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a800e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5901e868747470733a2f2f6465766e65742d697066732e6170692e706f6c6b61646f74636f6d6d756e6974792e666f756e646174696f6e2f697066732f003816c09001000000';
  const key = new Uint8Array(32).fill(0x11);
  const nonce = new Uint8Array(12).fill(0x22);
  const imageItem = {
    mime: 'image/jpeg',
    name: null,
    size: 15,
    media: { kind: 'image' as const, width: 640, height: 480 },
    blurhash: 'LEHV6nWB2yk8',
    thumbnail: null,
    key,
    nonce,
    chunkSize: 2_000_000,
    chunks: [hexToBytes('0xd47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a')],
    store: { genesis: GENESIS as `0x${string}`, mirror: null },
    expiresAt: 1721209600000,
  };
  const voiceItem = {
    mime: 'audio/ogg; codecs=opus',
    name: null,
    size: 13,
    media: { kind: 'voice' as const, durationMs: 4200, waveform: [0, 64, 128, 255] },
    blurhash: null,
    thumbnail: null,
    key,
    nonce,
    chunkSize: 8,
    chunks: [
      hexToBytes('0xf2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb4'),
      hexToBytes('0x7e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a8'),
    ],
    store: { genesis: GENESIS as `0x${string}`, mirror: 'https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/' },
    expiresAt: 1721209600000,
  };
  const encode = (messageId: string, content: OutgoingContent) =>
    bytesToHex(opaque.enc(ChatMessageCodec.enc({ messageId, timestamp: 1720000000000n, versioned: { tag: 'v1', value: toWire(content) } })));

  it('writes vector A (an image, C1) byte for byte', () => {
    expect(encode('ATT-1', { type: 'attachment', items: [imageItem], caption: 'Our cat' })).toBe(VECTOR_A);
  });

  it('writes vector B (a voice note, C2, with a mirror) byte for byte', () => {
    expect(encode('ATT-2', { type: 'attachment', items: [voiceItem], caption: null })).toBe(VECTOR_B);
  });

  it('reads vectors A and B into the stored content, and writes the read content back to the same bytes', () => {
    const a = ChatMessageCodec.dec(opaque.dec(VECTOR_A));
    expect(a.messageId).toBe('ATT-1');
    const effectA = fromWire(a.versioned.value);
    expect(effectA).toEqual({ kind: 'message', content: { type: 'attachment', items: [imageItem], caption: 'Our cat' } });
    const b = ChatMessageCodec.dec(opaque.dec(VECTOR_B));
    const effectB = fromWire(b.versioned.value);
    expect(effectB).toEqual({ kind: 'message', content: { type: 'attachment', items: [voiceItem], caption: null } });
    if (effectA.kind !== 'message' || effectA.content.type !== 'attachment') throw new Error('not an attachment');
    expect(encode('ATT-1', { type: 'attachment', items: effectA.content.items, caption: effectA.content.caption })).toBe(VECTOR_A);
  });

  it('is not readable by a client without the kind: the SDK decoder refuses it (phone apps show their unsupported bubble)', () => {
    expect(() => SdkChatMessage.dec(opaque.dec(VECTOR_A))).toThrow();
  });

  it('shows the unsupported bubble for an attachment this build cannot read (a later media tag)', () => {
    // Vector A with the media tag 1 (image) at its offset turned into 4 (not defined yet).
    const bytes = opaque.dec(VECTOR_A);
    // messageId (1 + 5), timestamp 8, version 1, kind 1, items 1, mime (1 + 10), name 1, size 8.
    const mediaAt = 6 + 8 + 1 + 1 + 1 + 11 + 1 + 8;
    expect(bytes[mediaAt]).toBe(1);
    const later = bytes.slice();
    later[mediaAt] = 4;
    expect(fromWire(ChatMessageCodec.dec(later).versioned.value)).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'attachment' } });
  });

  it('refuses an attachment whose chunk count does not match its size (a receiver would fetch the wrong number of chunks)', () => {
    const wrong = { ...imageItem, size: 2_000_001 };
    const bytes = ChatMessageCodec.enc({ messageId: 'x', timestamp: 1n, versioned: { tag: 'v1', value: toWire({ type: 'attachment', items: [wrong], caption: null }) } });
    expect(fromWire(ChatMessageCodec.dec(bytes).versioned.value)).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'attachment' } });
  });

  it('refuses a thumbnail over 2048 bytes and more than 4 items (the 4 KB message budget)', () => {
    const fat = { ...imageItem, thumbnail: new Uint8Array(2049) };
    const five = Array.from({ length: 5 }, () => imageItem);
    for (const items of [[fat], five]) {
      const bytes = ChatMessageCodec.enc({ messageId: 'x', timestamp: 1n, versioned: { tag: 'v1', value: toWire({ type: 'attachment', items, caption: null }) } });
      expect(fromWire(ChatMessageCodec.dec(bytes).versioned.value)).toEqual({ kind: 'message', content: { type: 'unsupported', tag: 'attachment' } });
    }
  });

  it('previews as the caption, else "Photo", a voice duration or the file name', () => {
    expect(previewOf({ type: 'attachment', items: [imageItem], caption: 'Our cat' })).toBe('Our cat');
    expect(previewOf({ type: 'attachment', items: [imageItem], caption: null })).toBe('Photo');
    expect(previewOf({ type: 'attachment', items: [voiceItem], caption: null })).toBe('Voice message (0:04)');
    expect(previewOf({ type: 'attachment', items: [{ ...imageItem, media: { kind: 'file' }, name: 'a.pdf' }], caption: null })).toBe('File: a.pdf');
  });
});
