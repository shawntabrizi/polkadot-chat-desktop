/**
 * Spec 0005 signal rules, on a fake clock. Why they matter: a typing hint
 * that outlives its `until` or survives the real message makes a peer look
 * busy when it is not; every standalone signal is one Statement Store
 * submission, so a sender that ignores the 10 s / 5 s limits multiplies what
 * a chat costs the shared network (docs/spec/efficiency.md).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PeerId } from '../../app/database';

import type { TypingKind } from './content';
import {
  LOCAL_WORKING_MS,
  SEEN_INTERVAL_MS,
  TYPING_INTERVAL_MS,
  TYPING_START_MS,
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

  it('sends nothing for a message written and sent within the first second', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'ok');
    vi.advanceTimersByTime(TYPING_START_MS - 1);
    sender.sent(A);
    vi.advanceTimersByTime(60_000);
    // A short answer costs its one submission, not two.
    expect(sent).toEqual([]);
  });

  it('sends the first composing after 1 s of editing, with until = now + 12 s', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'h');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(TYPING_START_MS);
    expect(sent).toEqual([{ peer: A, kind: 'composing', until: Date.now() + TYPING_TTL_MS, at: Date.now() }]);
    expect(TYPING_TTL_MS).toBe(12_000);
  });

  it('refreshes at most once per 10 s while the text keeps changing', () => {
    const { sent, sender } = setup();
    for (let i = 1; i <= 25; i++) {
      sender.edited(A, 'x'.repeat(i));
      vi.advanceTimersByTime(1_000);
    }
    // 25 s of typing: sends at 1, 11 and 21 s, not one per keystroke.
    expect(sent.map(s => s.at - 1_000_000)).toEqual([TYPING_START_MS, TYPING_START_MS + TYPING_INTERVAL_MS, TYPING_START_MS + 2 * TYPING_INTERVAL_MS]);
    expect(sent.every(s => s.kind === 'composing')).toBe(true);
  });

  it('sends stopped on an emptied field only when the 10 s limit allows it; otherwise the hint expires', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'hi');
    vi.advanceTimersByTime(TYPING_START_MS);
    sender.edited(A, '');
    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    // Inside the window: no second submission; the peer drops the hint at `until`.
    expect(sent.map(s => s.kind)).toEqual(['composing']);

    sender.edited(A, 'again');
    vi.advanceTimersByTime(TYPING_START_MS);
    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    sender.edited(A, '');
    expect(sent.map(s => s.kind)).toEqual(['composing', 'composing', 'stopped']);
  });

  it('sends nothing on a real message: the message clears the hint on the peer side', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'hi');
    vi.advanceTimersByTime(TYPING_START_MS);
    sender.sent(A);
    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    expect(sent.map(s => s.kind)).toEqual(['composing']);
    // The next message starts a new hint, after its own first second.
    sender.edited(A, 'next');
    vi.advanceTimersByTime(TYPING_START_MS);
    expect(sent.map(s => s.kind)).toEqual(['composing', 'composing']);
  });

  it('rate-limits per peer, not globally', () => {
    const { sent, sender } = setup();
    sender.edited(A, 'a');
    sender.edited(B, 'b');
    vi.advanceTimersByTime(TYPING_START_MS);
    expect(sent.map(s => s.peer)).toEqual([A, B]);
  });
});

describe('local working state (known bot, no wire signal)', () => {
  it('shows working from our send until the reply, one line even when an older bot also sends typing', () => {
    const store = createTypingStore();
    const now = Date.now();
    store.localWorking(A);
    expect(store.snapshot().get(A)).toEqual({ kind: 'working', until: now + LOCAL_WORKING_MS, local: true });
    // An older bot's own typing replaces the line; it does not add a second one.
    store.receive(A, 'working', now + 12_000, now + 1);
    expect([...store.snapshot().values()]).toHaveLength(1);
    // Its hint expires before the reply: the local state is still there, so the line does not flicker off.
    vi.advanceTimersByTime(12_000);
    expect(store.snapshot().get(A)?.local).toBe(true);
    store.messageFrom(A, now + 20_000);
    expect(store.snapshot().has(A)).toBe(false);
  });

  it('ends after 60 s without a reply, or when the bot deletes a message', () => {
    const store = createTypingStore();
    store.localWorking(A);
    vi.advanceTimersByTime(LOCAL_WORKING_MS - 1);
    expect(store.snapshot().has(A)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.snapshot().has(A)).toBe(false);

    store.localWorking(B);
    store.endLocal(B);
    expect(store.snapshot().has(B)).toBe(false);
  });
});

describe('sent seen', () => {
  it('holds a seen for 5 s and then sends one, carrying the newest displayed message', () => {
    const sent: [PeerId, string][] = [];
    const sender = createSeenSender((peer, upTo) => sent.push([peer, upTo]));
    sender.displayed(A, 'm1');
    sender.displayed(A, 'm2');
    sender.displayed(A, 'm3');
    vi.advanceTimersByTime(SEEN_INTERVAL_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[A, 'm3']]);
    expect(SEEN_INTERVAL_MS).toBe(5_000);
  });

  it('gives the pending seen to a message sent inside the window, and then sends nothing alone', () => {
    const sent: string[] = [];
    const sender = createSeenSender((_peer, upTo) => sent.push(upTo));
    sender.displayed(A, 'm1');
    vi.advanceTimersByTime(2_000);
    expect(sender.take(A)).toEqual({ upTo: 'm1', at: 1_000_000 });
    vi.advanceTimersByTime(SEEN_INTERVAL_MS);
    // It rode on the message: a standalone copy would be a second submission.
    expect(sent).toEqual([]);
    expect(sender.take(A)).toBeNull();
    expect(sender.take(B)).toBeNull();
  });

  it('does not send the same upTo twice', () => {
    const sent: string[] = [];
    const sender = createSeenSender((_peer, upTo) => sent.push(upTo));
    sender.displayed(A, 'm1');
    vi.advanceTimersByTime(SEEN_INTERVAL_MS);
    sender.displayed(A, 'm1');
    vi.advanceTimersByTime(SEEN_INTERVAL_MS);
    expect(sender.take(A)).toBeNull();
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
