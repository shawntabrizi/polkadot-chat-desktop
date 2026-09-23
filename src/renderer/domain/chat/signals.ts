/**
 * Spec 0005 signals, in memory only: the peer's typing state (received), the
 * rate-limited `typing` and `seen` we send, and the `seen` receipts whose
 * `upTo` is not known yet. Nothing here is persisted; the one persisted
 * effect of `seen` (`seenAt` on own rows) is `applySeen` in messages.ts.
 */

import type { PeerId } from '../../app/database';

import type { TypingKind } from './content';

/** A `composing` hint lasts this long (spec: `until = now + 6 s`). */
export const TYPING_TTL_MS = 6_000;
/** At most one `typing` per peer in this time (spec 0005, README rate limits). */
export const TYPING_INTERVAL_MS = 4_000;
/** A received `until` further ahead than this is ignored (clock skew guard). */
export const TYPING_MAX_AHEAD_MS = 15_000;
/** At most one `seen` per peer in this time. */
export const SEEN_INTERVAL_MS = 2_000;
/** How many `seen` receipts with an unknown `upTo` are kept per peer (M9 step 2). */
export const PENDING_SEEN_PER_PEER = 200;

type Clock = () => number;
type Timers = {
  set: (run: VoidFunction, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
};
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: timer => clearTimeout(timer) };

// ── Received typing ─────────────────────────────────────────────────────

/** What a room shows for a peer: `stopped` is never a state, it clears one. */
export type PeerTyping = { kind: 'composing' | 'working'; until: number };

/** A received `until` is shown only if it is ahead of now and at most 15 s ahead. */
export const acceptsTyping = (until: number, now: number): boolean => until > now && until <= now + TYPING_MAX_AHEAD_MS;

export type TypingStore = {
  /** A stable map, replaced on every change (for `useSyncExternalStore`). */
  snapshot: () => ReadonlyMap<PeerId, PeerTyping>;
  subscribe: (listener: VoidFunction) => VoidFunction;
  /** A `typing` from `peer`; `sentAt` is its envelope timestamp. */
  receive: (peer: PeerId, kind: TypingKind, until: number, sentAt: number) => void;
  /** A real message from `peer`: the hint ends, and a `typing` sent before it is stale. */
  messageFrom: (peer: PeerId, sentAt: number) => void;
  dispose: VoidFunction;
};

export const createTypingStore = (clock: Clock = Date.now, timers: Timers = realTimers): TypingStore => {
  let states = new Map<PeerId, PeerTyping>();
  const expiry = new Map<PeerId, ReturnType<typeof setTimeout>>();
  // The newest real message per peer: a `typing` that was batched with (or
  // before) it must not bring the indicator back.
  const lastMessageAt = new Map<PeerId, number>();
  const listeners = new Set<VoidFunction>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const clear = (peer: PeerId) => {
    const timer = expiry.get(peer);
    if (timer !== undefined) timers.clear(timer);
    expiry.delete(peer);
    if (!states.has(peer)) return;
    states = new Map(states);
    states.delete(peer);
    emit();
  };

  return {
    snapshot: () => states,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive: (peer, kind, until, sentAt) => {
      if (sentAt <= (lastMessageAt.get(peer) ?? -Infinity)) return;
      if (kind === 'stopped') {
        clear(peer);
        return;
      }
      const now = clock();
      if (!acceptsTyping(until, now)) return;
      const timer = expiry.get(peer);
      if (timer !== undefined) timers.clear(timer);
      expiry.set(
        peer,
        timers.set(() => clear(peer), until - now),
      );
      states = new Map(states);
      states.set(peer, { kind, until });
      emit();
    },
    messageFrom: (peer, sentAt) => {
      lastMessageAt.set(peer, Math.max(sentAt, lastMessageAt.get(peer) ?? -Infinity));
      clear(peer);
    },
    dispose: () => {
      for (const timer of expiry.values()) timers.clear(timer);
      expiry.clear();
      listeners.clear();
    },
  };
};

// ── Sent typing ─────────────────────────────────────────────────────────

export type TypingSender = {
  /** A person changed the composer text for `peer`. */
  edited: (peer: PeerId, text: string) => void;
  /** A real message went to `peer`; it clears the hint on the peer's side, so nothing else is sent. */
  sent: (peer: PeerId) => void;
  dispose: VoidFunction;
};

/**
 * Empty → non-empty sends `composing` (until now + 6 s); further edits refresh
 * it at most every 4 s; emptying the field sends `stopped`, delayed until the
 * 4 s window allows it. Nothing is sent on a real message.
 */
export const createTypingSender = (
  send: (peer: PeerId, kind: TypingKind, until: number) => void,
  clock: Clock = Date.now,
  timers: Timers = realTimers,
): TypingSender => {
  type State = { active: boolean; lastSentAt: number | null; stop: ReturnType<typeof setTimeout> | null };
  const peers = new Map<PeerId, State>();
  const stateOf = (peer: PeerId): State => {
    const existing = peers.get(peer);
    if (existing) return existing;
    const created: State = { active: false, lastSentAt: null, stop: null };
    peers.set(peer, created);
    return created;
  };
  const cancelStop = (state: State) => {
    if (state.stop !== null) timers.clear(state.stop);
    state.stop = null;
  };
  const maySend = (state: State, now: number) => state.lastSentAt === null || now - state.lastSentAt >= TYPING_INTERVAL_MS;
  const fire = (peer: PeerId, state: State, kind: TypingKind, now: number) => {
    state.lastSentAt = now;
    send(peer, kind, kind === 'stopped' ? now : now + TYPING_TTL_MS);
  };

  return {
    edited: (peer, text) => {
      const state = stateOf(peer);
      const now = clock();
      if (text.trim() !== '') {
        cancelStop(state);
        // Inside the window the peer still shows the last hint; the next edit
        // after the window refreshes it.
        if (maySend(state, now)) fire(peer, state, 'composing', now);
        state.active = true;
        return;
      }
      if (!state.active) return;
      state.active = false;
      if (maySend(state, now)) {
        fire(peer, state, 'stopped', now);
        return;
      }
      cancelStop(state);
      state.stop = timers.set(
        () => {
          state.stop = null;
          if (!state.active) fire(peer, state, 'stopped', clock());
        },
        (state.lastSentAt ?? now) + TYPING_INTERVAL_MS - now,
      );
    },
    sent: peer => {
      const state = stateOf(peer);
      cancelStop(state);
      state.active = false;
    },
    dispose: () => {
      for (const state of peers.values()) cancelStop(state);
      peers.clear();
    },
  };
};

// ── Sent seen ───────────────────────────────────────────────────────────

export type SeenSender = {
  /** The newest message from `peer` the user has seen. */
  displayed: (peer: PeerId, messageId: string) => void;
  dispose: VoidFunction;
};

/**
 * At most one `seen` per peer every 2 s, carrying the newest displayed
 * message; a message displayed inside the window goes out when it ends. The
 * same `upTo` is never sent twice in a row.
 */
export const createSeenSender = (send: (peer: PeerId, upTo: string, at: number) => void, clock: Clock = Date.now, timers: Timers = realTimers): SeenSender => {
  type State = { lastSentAt: number | null; lastUpTo: string | null; latest: string | null; timer: ReturnType<typeof setTimeout> | null };
  const peers = new Map<PeerId, State>();

  const flush = (peer: PeerId, state: State) => {
    if (state.latest === null || state.latest === state.lastUpTo) return;
    const now = clock();
    state.lastSentAt = now;
    state.lastUpTo = state.latest;
    send(peer, state.latest, now);
  };

  return {
    displayed: (peer, messageId) => {
      const state = peers.get(peer) ?? { lastSentAt: null, lastUpTo: null, latest: null, timer: null };
      peers.set(peer, state);
      state.latest = messageId;
      if (state.timer !== null) return;
      const now = clock();
      if (state.lastSentAt === null || now - state.lastSentAt >= SEEN_INTERVAL_MS) {
        flush(peer, state);
        return;
      }
      state.timer = timers.set(() => {
        state.timer = null;
        flush(peer, state);
      }, state.lastSentAt + SEEN_INTERVAL_MS - now);
    },
    dispose: () => {
      for (const state of peers.values()) if (state.timer !== null) timers.clear(state.timer);
      peers.clear();
    },
  };
};

// ── Received seen with an unknown upTo ──────────────────────────────────

export type PendingSeen = {
  /** Keep `seen{upTo, at}` until `upTo` is known; the oldest goes past the per-peer bound. */
  add: (peer: PeerId, upTo: string, at: number) => void;
  /** The `at` waiting for `messageId`, removed; null if none. */
  take: (peer: PeerId, messageId: string) => number | null;
};

export const createPendingSeen = (limit: number = PENDING_SEEN_PER_PEER): PendingSeen => {
  // A Map keeps insertion order, so its first key is the oldest.
  const byPeer = new Map<PeerId, Map<string, number>>();
  return {
    add: (peer, upTo, at) => {
      const entries = byPeer.get(peer) ?? new Map<string, number>();
      byPeer.set(peer, entries);
      // A repeat keeps the earliest `at`: the message was seen then.
      if (entries.has(upTo)) return;
      entries.set(upTo, at);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    take: (peer, messageId) => {
      const entries = byPeer.get(peer);
      const at = entries?.get(messageId);
      if (at === undefined) return null;
      entries?.delete(messageId);
      return at;
    },
  };
};
