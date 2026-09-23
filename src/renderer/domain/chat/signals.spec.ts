/**
 * Spec 0005 signal rules, on a fake clock. Why they matter: a typing hint
 * that outlives its `until` or survives the real message makes a peer look
 * busy when it is not; a sender that ignores the 4 s / 2 s limits doubles the
 * statements a chatty session submits (spec "Drawbacks").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PeerId } from '../../app/database';

import type { TypingKind } from './content';
import {
  SEEN_INTERVAL_MS,
  TYPING_INTERVAL_MS,
  TYPING_TTL_MS,
  acceptsTyping,
  createPendingSeen,
  createSeenSender,
  createTypingSender,
  createTypingStore,
} from './signals';

const A = '0xaa' as PeerId;
const B = '0xbb' as PeerId;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('received typing', () => {
  it('accepts an until only ahead of now and at most 15 s ahead (clock skew guard)', () => {
    expect(acceptsTyping(1_000, 1_000)).toBe(false);
    expect(acceptsTyping(999, 1_000)).toBe(false);
    expect(acceptsTyping(16_000, 1_000)).toBe(true);
    expect(acceptsTyping(16_001, 1_000)).toBe(false);
  });

  it('shows a typing hint until its until, then clears it', () => {
    const store = createTypingStore();
    const now = Date.now();
    store.receive(A, 'working', now + 6_000, now);
    expect(store.snapshot().get(A)).toEqual({ kind: 'working', until: now + 6_000 });
    vi.advanceTimersByTime(5_999);
    expect(store.snapshot().has(A)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.snapshot().has(A)).toBe(false);
  });

  it('ignores a stale typing (until in the past) and one too far ahead', () => {
    const store = createTypingStore();
    const now = Date.now();
    store.receive(A, 'composing', now - 1, now);
    store.receive(B, 'composing', now + 20_000, now);
    expect(store.snapshot().size).toBe(0);
  });

  it('clears on stopped and on a real message; a typing older than that message stays ignored', () => {
    const store = createTypingStore();
    const now = Date.now();
    store.receive(A, 'composing', now + 6_000, now);
    store.receive(A, 'stopped', now, now + 1);
    expect(store.snapshot().has(A)).toBe(false);

    store.receive(A, 'working', now + 6_000, now + 2);
    store.messageFrom(A, now + 10);
    expect(store.snapshot().has(A)).toBe(false);
    // Batched with (before) the answer: must not bring the indicator back.
    store.receive(A, 'working', now + 6_000, now + 5);
    expect(store.snapshot().has(A)).toBe(false);
    // A later turn shows again.
    store.receive(A, 'working', now + 6_000, now + 11);
    expect(store.snapshot().get(A)?.kind).toBe('working');
  });

  it('keeps one peer apart from another and notifies subscribers with a new snapshot', () => {
    const store = createTypingStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.snapshot();
    store.receive(A, 'composing', Date.now() + 6_000, Date.now());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot().has(B)).toBe(false);
  });
});

describe('sent typing', () => {
  const setup = () => {
    const sent: { peer: PeerId; kind: TypingKind; until: number; at: number }[] = [];
    const sender = createTypingSender((peer, kind, until) => sent.push({ peer, kind, until, at: Date.now() }));
    return { sent, sender };
  };

  it('sends composing (until now + 6 s) when the field goes from empty to text', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'h');
    expect(sent).toEqual([{ peer: A, kind: 'composing', until: Date.now() + TYPING_TTL_MS, at: Date.now() }]);
  });

  it('refreshes at most once per 4 s while the text keeps changing', () => {
    const { sent, sender } = setup();
    for (let i = 1; i <= 10; i++) {
      sender.edited(A, 'x'.repeat(i));
      vi.advanceTimersByTime(1_000);
    }
    // 10 s of typing: sends at 0, 4 and 8 s.
    expect(sent.map(s => s.at - 1_000_000)).toEqual([0, TYPING_INTERVAL_MS, 2 * TYPING_INTERVAL_MS]);
    expect(sent.every(s => s.kind === 'composing')).toBe(true);
  });

  it('sends stopped when the user empties the field, delayed until the 4 s window allows it', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'hi');
    vi.advanceTimersByTime(1_000);
    sender.edited(A, '');
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(TYPING_INTERVAL_MS - 1_000);
    expect(sent.map(s => s.kind)).toEqual(['composing', 'stopped']);
  });

  it('sends nothing on a real message: the message clears the hint on the peer side', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'hi');
    sender.sent(A);
    vi.advanceTimersByTime(10_000);
    expect(sent.map(s => s.kind)).toEqual(['composing']);
    // The next message starts a new hint.
    sender.edited(A, 'next');
    expect(sent.map(s => s.kind)).toEqual(['composing', 'composing']);
  });

  it('cancels a pending stopped when the user types again', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'hi');
    sender.edited(A, '');
    sender.edited(A, 'hi again');
    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    expect(sent.map(s => s.kind)).toEqual(['composing']);
  });

  it('rate-limits per peer, not globally', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'a');
    sender.edited(B, 'b');
    expect(sent.map(s => s.peer)).toEqual([A, B]);
  });
});

describe('sent seen', () => {
  it('sends at most one seen per 2 s per peer, carrying the newest displayed message', () => {
    const sent: [PeerId, string][] = [];
    const sender = createSeenSender((peer, upTo) => sent.push([peer, upTo]));
    sender.displayed(A, 'm1');
    sender.displayed(A, 'm2');
    sender.displayed(A, 'm3');
    expect(sent).toEqual([[A, 'm1']]);
    vi.advanceTimersByTime(SEEN_INTERVAL_MS);
    expect(sent).toEqual([
      [A, 'm1'],
      [A, 'm3'],
    ]);
  });

  it('does not send the same upTo twice', () => {
    const sent: string[] = [];
    const sender = createSeenSender((_peer, upTo) => sent.push(upTo));
    sender.displayed(A, 'm1');
    vi.advanceTimersByTime(SEEN_INTERVAL_MS);
    sender.displayed(A, 'm1');
    expect(sent).toEqual(['m1']);
  });
});

describe('pending seen (unknown upTo)', () => {
  it('keeps a seen until its message is known, once, and bounds each peer', () => {
    const pending = createPendingSeen(2);
    pending.add(A, 'x', 10);
    pending.add(A, 'x', 20);
    expect(pending.take(B, 'x')).toBeNull();
    expect(pending.take(A, 'x')).toBe(10);
    expect(pending.take(A, 'x')).toBeNull();

    pending.add(A, 'p', 1);
    pending.add(A, 'q', 2);
    pending.add(A, 'r', 3);
    expect(pending.take(A, 'p')).toBeNull();
    expect(pending.take(A, 'r')).toBe(3);
  });
});
