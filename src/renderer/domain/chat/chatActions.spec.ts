/**
 * M12e Forward: a copy of the content as a new plain text. Why: the wire does
 * not change (spec 0006 keyboards and spec 0007 tx intents are not forwarded,
 * so a forwarded chat can never sign or press anything on behalf of the
 * original sender); a keyboard still reads as its menu-as-text fallback.
 */

import { describe, expect, it } from 'vitest';

import type { MessageRow } from '../../app/database';

import { forwardText } from './chatActions';

const row = (content: MessageRow['content'], direction: MessageRow['direction'] = 'incoming'): MessageRow => ({
  messageId: 'm',
  peerAccountId: '0xaa',
  timestamp: 1,
  direction,
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
});

describe('forwardText', () => {
  it('forwards text, a reply and rich text as their text', () => {
    expect(forwardText(row({ type: 'text', text: 'hi' }))).toBe('hi');
    expect(forwardText(row({ type: 'reply', messageId: 'x', text: 'answer' }))).toBe('answer');
    expect(forwardText(row({ type: 'richText', text: 'photo caption', attachments: [] }))).toBe('photo caption');
  });

  it('turns a keyboard, tx button included, into its text and numbered labels', () => {
    const keyboard = row({
      type: 'buttons',
      text: 'Pick one',
      rows: [[{ label: 'Top up', action: { kind: 'tx', intent: Uint8Array.of(1) } }, { label: 'Docs', action: { kind: 'url', url: 'https://polkadot.com' } }]],
      oneShot: false,
      pressed: null,
    });
    expect(forwardText(keyboard)).toBe('Pick one\n\n1. Top up\n2. Docs');
  });

  it('forwards nothing without text: tombstones, references, system rows', () => {
    expect(forwardText(row({ type: 'deleted' }))).toBeNull();
    expect(forwardText(row({ type: 'richText', text: null, attachments: [] }))).toBeNull();
    expect(forwardText(row({ type: 'contactAdded' }, 'system'))).toBeNull();
    expect(forwardText(row({ type: 'text', text: '   ' }))).toBeNull();
  });
});
