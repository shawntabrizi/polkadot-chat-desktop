import { ChatMessage as ChatMessageCodec } from '@novasamatech/host-chat/codec/message';
import { describe, expect, it, vi } from 'vitest';

import { fromWire, previewOf, toWire } from './content';
import type { ChatContent } from './identityEvents';

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
  });
});
