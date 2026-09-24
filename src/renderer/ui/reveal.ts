/**
 * Typing reveal for bot and Assistant replies (M7 step 6; Android animates
 * one for bot messages, docs/reference/mobile-ux.md). Only the paint is
 * delayed: the row in Dexie already holds the whole text, and a copy, a
 * quote or the chat list see all of it at once.
 */

import { useEffect, useRef, useState } from 'react';

export const REVEAL_CHARS_PER_TICK = 40;
export const REVEAL_TICK_MS = 100;
/** After this the rest shows at once, however long the text is. */
export const REVEAL_MAX_MS = 2000;

/**
 * How many characters are painted `elapsedMs` into a reveal of `length`
 * characters whose first `from` characters were already on screen.
 */
export const revealedLength = (length: number, elapsedMs: number, from = 0): number => {
  if (elapsedMs >= REVEAL_MAX_MS) return length;
  return Math.min(length, from + (Math.floor(Math.max(0, elapsedMs) / REVEAL_TICK_MS) + 1) * REVEAL_CHARS_PER_TICK);
};

/** The states of a row that decide when its answer has just arrived. */
export type RevealInput = {
  /** The text the bubble shows: for a streaming reply, without its client directive block (streamingFence.ts). */
  text: string;
  /** A `pca` live frame (`isLiveFrame`). */
  live: boolean;
  /** An Assistant reply that still streams. */
  streaming: boolean;
};

/**
 * Does the change from `before` to `after` put an answer on screen, and
 * from which character is it new? Null: nothing to reveal.
 * - a peer's live frame was replaced (by an edit) with other text: all of it;
 * - an Assistant reply got its first text after "Thinking…": all of it;
 * - an Assistant reply completed: nothing when the final text starts with
 *   what streamed (the stored reply loses its buttons block, which the
 *   streaming view already hid; M12d: revealing it again typed the whole
 *   reply a second time). A CLI's closing text that differs is new only
 *   after the part both share.
 */
export const revealStart = (before: RevealInput, after: RevealInput): number | null => {
  if (after.live || after.text === '') return null;
  if (before.live) return 0;
  if (!before.streaming) return null;
  if (before.text === '') return 0;
  if (after.streaming || after.text.startsWith(before.text)) return null;
  let shared = 0;
  while (shared < before.text.length && before.text[shared] === after.text[shared]) shared++;
  return shared;
};

const motionAllowed = (): boolean =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * The text to paint for one bubble. Starts a reveal when `revealStart` finds
 * one, the setting is on, the room is visible and reduced motion is not asked for.
 */
export const useTypingReveal = (input: RevealInput, enabled: boolean): string => {
  const [previous, setPrevious] = useState(input);
  // null: paint everything. `from`: the characters that were on screen when it started.
  const [run, setRun] = useState<{ from: number; painted: number } | null>(null);

  // React's "state from the previous render" pattern: the change is seen
  // during render, so the first frame of the answer is already cut short.
  if (previous.text !== input.text || previous.live !== input.live || previous.streaming !== input.streaming) {
    setPrevious(input);
    const from = enabled ? revealStart(previous, input) : null;
    if (from !== null && motionAllowed()) setRun({ from, painted: revealedLength(input.text.length, 0, from) });
  }

  // A streaming reply keeps growing during its reveal; the clock must not restart.
  const length = useRef(input.text.length);
  useEffect(() => {
    length.current = input.text.length;
  });
  const revealing = run !== null;
  const from = run?.from ?? 0;
  useEffect(() => {
    if (!revealing) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const next = revealedLength(length.current, Date.now() - started, from);
      setRun(next >= length.current ? null : { from, painted: next });
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [revealing, from]);

  return run === null ? input.text : input.text.slice(0, run.painted);
};
