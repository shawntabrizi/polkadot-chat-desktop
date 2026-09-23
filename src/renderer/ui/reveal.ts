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

/** How many characters are painted `elapsedMs` into a reveal of `length` characters. */
export const revealedLength = (length: number, elapsedMs: number): number => {
  if (elapsedMs >= REVEAL_MAX_MS) return length;
  return Math.min(length, (Math.floor(Math.max(0, elapsedMs) / REVEAL_TICK_MS) + 1) * REVEAL_CHARS_PER_TICK);
};

/** The states of a row that decide when its answer has just arrived. */
export type RevealInput = {
  text: string;
  /** A `pca` live frame (`isLiveFrame`). */
  live: boolean;
  /** An Assistant reply that still streams. */
  streaming: boolean;
};

/**
 * Does the change from `before` to `after` put an answer on screen?
 * - a peer's live frame was replaced (by an edit) with other text;
 * - an Assistant reply got its first text after "Thinking…";
 * - an Assistant reply completed with text other than what streamed.
 */
export const answerArrived = (before: RevealInput, after: RevealInput): boolean => {
  if (after.live || after.text === '') return false;
  if (before.live) return true;
  if (before.streaming && before.text === '') return true;
  return before.streaming && !after.streaming && before.text !== after.text;
};

const motionAllowed = (): boolean =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * The text to paint for one bubble. Starts a reveal when `answerArrived`,
 * the setting is on, the room is visible and reduced motion is not asked for.
 */
export const useTypingReveal = (input: RevealInput, enabled: boolean): string => {
  const [previous, setPrevious] = useState(input);
  // null: paint everything.
  const [painted, setPainted] = useState<number | null>(null);

  // React's "state from the previous render" pattern: the change is seen
  // during render, so the first frame of the answer is already cut short.
  if (previous.text !== input.text || previous.live !== input.live || previous.streaming !== input.streaming) {
    setPrevious(input);
    if (enabled && answerArrived(previous, input) && motionAllowed()) setPainted(revealedLength(input.text.length, 0));
  }

  // A streaming reply keeps growing during its reveal; the clock must not restart.
  const length = useRef(input.text.length);
  useEffect(() => {
    length.current = input.text.length;
  });
  const revealing = painted !== null;
  useEffect(() => {
    if (!revealing) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const next = revealedLength(length.current, Date.now() - started);
      setPainted(next >= length.current ? null : next);
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [revealing]);

  return painted === null ? input.text : input.text.slice(0, painted);
};
