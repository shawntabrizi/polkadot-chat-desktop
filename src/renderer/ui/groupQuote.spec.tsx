/**
 * Why (docs/questions.md M14): the quote of a reply in a group named the
 * group ("Garden DAO") instead of the member who wrote the original. A reply
 * must show who is quoted, in a group as in a DM, with no wire change.
 */

import { describe, expect, it, vi } from 'vitest';

import type { MessageRow } from '../app/database';

await vi.hoisted(async () => (await import('./testDom')).installTestDom());
const { quoteOf } = await import('./MessageFlow');

const row = (messageId: string, direction: MessageRow['direction'], text: string, senderAccountId?: `0x${string}`): MessageRow => ({
  messageId,
  peerAccountId: 'group:g1',
  groupId: 'g1',
  ...(senderAccountId ? { senderAccountId } : {}),
  timestamp: 1,
  direction,
  status: direction === 'outgoing' ? 'sent' : 'received',
  content: { type: 'text', text },
  reactions: [],
  editedAt: null,
});

const names: Record<string, string> = { '0xa1': 'alice.01', '0xb2': 'bob.02' };
const senderOf = (r: MessageRow) => (r.senderAccountId ? (names[r.senderAccountId] ?? null) : null);

describe('quoted original of a reply', () => {
  it('in a group, names the member who wrote the original, not the group', () => {
    expect(quoteOf(row('m1', 'incoming', 'The vote is open', '0xa1'), 'Garden DAO', senderOf)).toEqual({ sender: 'alice.01', text: 'The vote is open' });
    expect(quoteOf(row('m2', 'incoming', 'Yes', '0xb2'), 'Garden DAO', senderOf).sender).toBe('bob.02');
  });

  it('an own original is "You", in a group and in a DM', () => {
    expect(quoteOf(row('m3', 'outgoing', 'mine'), 'Garden DAO', senderOf).sender).toBe('You');
    expect(quoteOf(row('m3', 'outgoing', 'mine'), 'mateodev.31').sender).toBe('You');
  });

  it('in a DM (no senderOf), the peer; an unknown original says so', () => {
    expect(quoteOf(row('m4', 'incoming', 'hi'), 'mateodev.31')).toEqual({ sender: 'mateodev.31', text: 'hi' });
    expect(quoteOf(undefined, 'Garden DAO', senderOf)).toEqual({ sender: 'Garden DAO', text: 'Message not available' });
  });
});
