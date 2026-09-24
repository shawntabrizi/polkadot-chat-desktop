/**
 * The "Copied" state of a copy button (M12c step 10, owner feedback): it
 * shows for 1.5 s and then clears, so the next copy shows it again. A second
 * copy inside the 1.5 s starts the time again.
 */

export const COPIED_MS = 1_500;

/** Short form of a hash for a label beside its actions: "0x1a2b…9f8e" (the full hash goes in the tooltip). */
export const shortHash = (hash: string): string => (hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`);

type Timers = { set: (run: VoidFunction, ms: number) => ReturnType<typeof setTimeout>; clear: (timer: ReturnType<typeof setTimeout>) => void };
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: timer => clearTimeout(timer) };

export type CopyFlag = {
  /** The text was copied: the flag turns on now and off after 1.5 s. */
  copied: VoidFunction;
  dispose: VoidFunction;
};

export const createCopyFlag = (onChange: (copied: boolean) => void, timers: Timers = realTimers): CopyFlag => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    copied: () => {
      if (timer !== null) timers.clear(timer);
      onChange(true);
      timer = timers.set(() => {
        timer = null;
        onChange(false);
      }, COPIED_MS);
    },
    dispose: () => {
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
};
