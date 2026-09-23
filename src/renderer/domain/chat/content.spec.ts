import { ChatMessage as SdkChatMessage } from '@novasamatech/host-chat/codec/message';
import { Bytes } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { bytesToHex } from '../../app/bytes';

import { fromWire, isLiveFrame, liveFrameText, previewOf, toWire } from './content';
import { type ChatContent, ChatMessageCodec } from './identityEvents';

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

  it('drops the hourglass for display', () => {
    expect(liveFrameText('⏳ working · 3s\n▸ step')).toBe('working · 3s\n▸ step');
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
  });
});
