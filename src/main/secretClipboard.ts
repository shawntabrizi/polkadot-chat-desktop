/**
 * A copied secret (the recovery phrase) leaves the clipboard after 60 s, but
 * only if the clipboard still holds it. The page cannot read the clipboard
 * to check that; main can (docs/questions.md M19 "Clipboard after Copy").
 * Main keeps a SHA-256 of the secret for the check, never the text.
 *
 * Plain Node (the clipboard and the timers come in), so the rule runs in a spec.
 */

import { createHash } from 'node:crypto';

export const SECRET_CLIPBOARD_MS = 60_000;

type Timers = { set: (run: VoidFunction, ms: number) => ReturnType<typeof setTimeout>; clear: (timer: ReturnType<typeof setTimeout>) => void };
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: timer => clearTimeout(timer) };

/** Electron 44's clipboard reads and writes are promises. */
export type ClipboardLike = { writeText: (text: string) => Promise<void>; readText: () => Promise<string>; clear: () => void };

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * `copy` writes the secret and starts the 60 s time (a second copy starts it
 * again). When the time ends and the clipboard still holds the same text,
 * the clipboard is cleared and `onCleared` runs. Anything the person copied
 * after it stays.
 */
export const createSecretClipboard = (clipboard: ClipboardLike, onCleared: VoidFunction, timers: Timers = realTimers) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    copy: async (secret: string): Promise<void> => {
      await clipboard.writeText(secret);
      const held = digest(secret);
      if (timer !== null) timers.clear(timer);
      timer = timers.set(() => {
        timer = null;
        void clipboard.readText().then(
          text => {
            if (digest(text) !== held) return;
            clipboard.clear();
            onCleared();
          },
          (error: unknown) => console.warn('[clipboard] could not read the clipboard to clear the phrase', error),
        );
      }, SECRET_CLIPBOARD_MS);
    },
  };
};
