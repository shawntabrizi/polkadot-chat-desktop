import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { bytesToHex } from '../../app/bytes';

import { fromWire, isLiveFrame, keyboardOf, liveFrameText, previewOf, toWire } from './content';
import { BOT_INFO_BOUNDS, type ChatContent, ChatMessageCodec } from './identityEvents';

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
    expect(fromWire(ChatMessageCodec.dec(opaque.dec(VECTOR)).versioned.value)).toEqual({ kind: 'botInfo', info });
  });

  it('keeps a kind byte this build does not know (a later revision may add kinds)', () => {
    expect(fromWire(viaWire(toWire({ type: 'botInfo', info: { ...info, kind: 7 } })))).toEqual({ kind: 'botInfo', info: { ...info, kind: 7 } });
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
