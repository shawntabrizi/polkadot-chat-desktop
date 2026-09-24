/**
 * Spec 0005 signals, in memory only: the peer's typing state (received, or
 * our local "working" for a known bot), the rate-limited `typing` and `seen`
 * we send, and the `seen` receipts whose `upTo` is not known yet. Nothing
 * here is persisted; the one persisted effect of `seen` (`seenAt` on own
 * rows) is `applySeen` in messages.ts.
 *
 * Revision 2026-09-23 (docs/spec/efficiency.md): every standalone signal is
 * one Statement Store submission, so `typing` is opt-in and slow (one per
 * 10 s), and a `seen` waits 5 s for a message it can ride on.
 */

import type { PeerId } from '../../app/database';

import type { TypingKind } from './content';

/** A `composing` hint lasts this long (spec 0005 revision 2026-09-23: `until = now + 12 s`). */
export const TYPING_TTL_MS = 12_000;
/** At most one `typing` per peer in this time (spec 0005: one per 10 s). */
export const TYPING_INTERVAL_MS = 10_000;
/** The first `composing` goes out after the user has edited this long. */
export const TYPING_START_MS = 1_000;
/** A received `until` further ahead than this is ignored (clock skew guard). */
export const TYPING_MAX_AHEAD_MS = 15_000;
/**
 * A pending `seen` waits this long for a message to the same peer to ride on
 * (one submission); if none comes, it goes out alone when the window ends.
 */
export const SEEN_INTERVAL_MS = 5_000;
/** The local "working" state of a known bot ends after this long without a reply (spec 0005). */
export const LOCAL_WORKING_MS = 60_000;
/** How many `seen` receipts with an unknown `upTo` are kept per peer (M9 step 2). */
export const PENDING_SEEN_PER_PEER = 200;

type Clock = () => number;
type Timers = {
  set: (run: VoidFunction, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
};
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: timer => clearTimeout(timer) };

// ── Received typing and the local "working" state ───────────────────────

/**
 * What a room shows for a peer: `stopped` is never a state, it clears one.
 * `local`: no wire signal; we sent a known bot a message and wait for its reply.
 */
export type PeerTyping = { kind: 'composing' | 'working'; until: number; local?: true };

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
  /**
   * We sent `peer`, a known bot, a message: show it working until its reply,
   * `endLocal`, or 60 s. No wire signal (spec 0005 revision 2026-09-23).
   */
  localWorking: (peer: PeerId) => void;
  /** The peer deleted a message, or our send failed: the local state ends. */
  endLocal: (peer: PeerId) => void;
  dispose: VoidFunction;
};

type Timed = { state: PeerTyping; timer: ReturnType<typeof setTimeout> };

export const createTypingStore = (clock: Clock = Date.now, timers: Timers = realTimers): TypingStore => {
  // Two sources per peer: what the peer sent, and our local "working" for a
  // bot. The room shows one line: the received state wins while it lasts,
  // so an older bot that still sends `typing` does not double the indicator.
  const received = new Map<PeerId, Timed>();
  const local = new Map<PeerId, Timed>();
  let states: ReadonlyMap<PeerId, PeerTyping> = new Map();
  // The newest real message per peer: a `typing` that was batched with (or
  // before) it must not bring the indicator back.
  const lastMessageAt = new Map<PeerId, number>();
  const listeners = new Set<VoidFunction>();

  const publish = () => {
    const next = new Map<PeerId, PeerTyping>();
    for (const [peer, entry] of local) next.set(peer, entry.state);
    for (const [peer, entry] of received) next.set(peer, entry.state);
    states = next;
    for (const listener of listeners) listener();
  };
  const drop = (source: Map<PeerId, Timed>, peer: PeerId): boolean => {
    const entry = source.get(peer);
    if (!entry) return false;
    timers.clear(entry.timer);
    source.delete(peer);
    return true;
  };
  const put = (source: Map<PeerId, Timed>, peer: PeerId, state: PeerTyping, now: number) => {
    drop(source, peer);
    source.set(peer, {
      state,
      timer: timers.set(() => {
        if (drop(source, peer)) publish();
      }, state.until - now),
    });
    publish();
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
        const changed = drop(received, peer);
        if (drop(local, peer) || changed) publish();
        return;
      }
      const now = clock();
      if (!acceptsTyping(until, now)) return;
      put(received, peer, { kind, until }, now);
    },
    messageFrom: (peer, sentAt) => {
      lastMessageAt.set(peer, Math.max(sentAt, lastMessageAt.get(peer) ?? -Infinity));
      const changed = drop(received, peer);
      if (drop(local, peer) || changed) publish();
    },
    localWorking: peer => {
      const now = clock();
      put(local, peer, { kind: 'working', until: now + LOCAL_WORKING_MS, local: true }, now);
    },
    endLocal: peer => {
      if (drop(local, peer)) publish();
    },
    dispose: () => {
      for (const entry of [...received.values(), ...local.values()]) timers.clear(entry.timer);
      received.clear();
      local.clear();
      listeners.clear();
    },
  };
};

// ── Sent typing (opt-in) ────────────────────────────────────────────────

export type TypingSender = {
  /** A person changed the composer text for `peer`. */
  edited: (peer: PeerId, text: string) => void;
  /** A real message went to `peer`; it clears the hint on the peer's side, so nothing else is sent. */
  sent: (peer: PeerId) => void;
  dispose: VoidFunction;
};

/**
 * Only called when the user turned typing on. The first `composing` goes out
 * after 1 s of editing (until now + 12 s); further edits refresh it at most
 * every 10 s. Emptying the field sends `stopped` only when the 10 s limit
 * allows it at that moment; otherwise the hint expires on its own (the spec
 * allows either, and a delayed `stopped` would be one more submission).
 * Nothing is sent on a real message.
 */
export const createTypingSender = (
  send: (peer: PeerId, kind: TypingKind, until: number) => void,
  clock: Clock = Date.now,
  timers: Timers = realTimers,
): TypingSender => {
  type State = { active: boolean; hinted: boolean; lastSentAt: number | null; start: ReturnType<typeof setTimeout> | null };
  const peers = new Map<PeerId, State>();
  const stateOf = (peer: PeerId): State => {
    const existing = peers.get(peer);
    if (existing) return existing;
    const created: State = { active: false, hinted: false, lastSentAt: null, start: null };
    peers.set(peer, created);
    return created;
  };
  const cancelStart = (state: State) => {
    if (state.start !== null) timers.clear(state.start);
    state.start = null;
  };
  const maySend = (state: State, now: number) => state.lastSentAt === null || now - state.lastSentAt >= TYPING_INTERVAL_MS;
  const fire = (peer: PeerId, state: State, kind: TypingKind, now: number) => {
    state.lastSentAt = now;
    state.hinted = kind === 'composing';
    send(peer, kind, kind === 'stopped' ? now : now + TYPING_TTL_MS);
  };

  return {
    edited: (peer, text) => {
      const state = stateOf(peer);
      const now = clock();
      if (text.trim() !== '') {
        if (!state.active) {
          state.active = true;
          // Wait 1 s of editing: a one-word answer is sent before any hint.
          state.start = timers.set(() => {
            state.start = null;
            const at = clock();
            if (state.active && maySend(state, at)) fire(peer, state, 'composing', at);
          }, TYPING_START_MS);
          return;
        }
        // Past the first second; inside the 10 s window the peer still shows the last hint.
        if (state.start === null && maySend(state, now)) fire(peer, state, 'composing', now);
        return;
      }
      if (!state.active) return;
      state.active = false;
      cancelStart(state);
      if (state.hinted && maySend(state, now)) fire(peer, state, 'stopped', now);
    },
    sent: peer => {
      const state = stateOf(peer);
      cancelStart(state);
      state.active = false;
      state.hinted = false;
    },
    dispose: () => {
      for (const state of peers.values()) cancelStart(state);
      peers.clear();
    },
  };
};

// ── Sent seen ───────────────────────────────────────────────────────────

export type SeenSender = {
  /** The newest message from `peer` the user has seen. */
  displayed: (peer: PeerId, messageId: string) => void;
  /**
   * A message to `peer` is about to be submitted: the pending `seen`, if
   * any, to put in the same request batch. Taking it cancels its own send.
   */
  take: (peer: PeerId) => { upTo: string; at: number } | null;
  dispose: VoidFunction;
};

/**
 * A displayed message opens a 5 s window; the newest message displayed in
 * it is what the `seen` names. A message to the peer inside the window takes
 * the `seen` along (`take`, one submission); else it goes out alone when the
 * window ends, so at most one standalone `seen` per peer per 5 s. The same
 * `upTo` is never sent twice in a row. `at` is when that message was displayed.
 */
export const createSeenSender = (send: (peer: PeerId, upTo: string, at: number) => void, clock: Clock = Date.now, timers: Timers = realTimers): SeenSender => {
  type State = { lastUpTo: string | null; latest: string | null; latestAt: number; timer: ReturnType<typeof setTimeout> | null };
  const peers = new Map<PeerId, State>();

  const due = (state: State): state is State & { latest: string } => state.latest !== null && state.latest !== state.lastUpTo;

  return {
    displayed: (peer, messageId) => {
      const state = peers.get(peer) ?? { lastUpTo: null, latest: null, latestAt: 0, timer: null };
      peers.set(peer, state);
      if (state.latest !== messageId) state.latestAt = clock();
      state.latest = messageId;
      if (state.timer !== null || !due(state)) return;
      state.timer = timers.set(() => {
        state.timer = null;
        if (!due(state)) return;
        state.lastUpTo = state.latest;
        send(peer, state.latest, state.latestAt);
      }, SEEN_INTERVAL_MS);
    },
    take: peer => {
      const state = peers.get(peer);
      if (!state || state.timer === null || !due(state)) return null;
      timers.clear(state.timer);
      state.timer = null;
      state.lastUpTo = state.latest;
      return { upTo: state.latest, at: state.latestAt };
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
