/**
 * Local actions that wait out an Undo toast (design system §10: no confirm
 * dialog; act at once, undo for 6 s). The rows stay in Dexie until the time
 * is up; meanwhile the screens hide what the action removes by its key
 * (`delete:<peer>`, `clear:<peer>`, `withdraw:<peer>`). The commit runs even
 * if the screen that started it is closed.
 */

/** How long a local delete, clear or withdraw can be undone (the M7 message delete uses the same). */
export const UNDO_MS = 6000;

export type PendingActions = {
  /** Keys whose commit has not finished: the screens hide what they remove. */
  snapshot: () => ReadonlySet<string>;
  subscribe: (listener: VoidFunction) => VoidFunction;
  /**
   * Hides `key` now and runs `commit` after `ms`. `undo` before then cancels
   * it and shows the key again; after then it does nothing. The key stays
   * hidden until the commit settles, so nothing flashes back before the rows
   * are gone. A key already pending is not scheduled twice (`undo` is a no-op).
   */
  schedule: (key: string, commit: () => Promise<unknown>, ms?: number) => { undo: VoidFunction; done: Promise<void> };
};

export const createPendingActions = (onError: (key: string, cause: unknown) => void = (key, cause) => console.warn('[chat] %s failed', key, cause)): PendingActions => {
  let keys: ReadonlySet<string> = new Set();
  const listeners = new Set<VoidFunction>();
  const set = (key: string, on: boolean) => {
    const next = new Set(keys);
    if (on) next.add(key);
    else next.delete(key);
    keys = next;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => keys,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    schedule: (key, commit, ms = UNDO_MS) => {
      if (keys.has(key)) return { undo: () => undefined, done: Promise.resolve() };
      set(key, true);
      let settle: VoidFunction = () => undefined;
      const done = new Promise<void>(resolve => {
        settle = resolve;
      });
      let started = false;
      const timer = setTimeout(() => {
        started = true;
        void Promise.resolve()
          .then(commit)
          .catch((cause: unknown) => onError(key, cause))
          .finally(() => {
            set(key, false);
            settle();
          });
      }, ms);
      return {
        undo: () => {
          if (started) return;
          clearTimeout(timer);
          set(key, false);
          settle();
        },
        done,
      };
    },
  };
};

/** The app's one store: the chat list, the rooms and Shell read it. */
export const pendingActions = createPendingActions();

export const deleteKey = (peer: string): string => `delete:${peer}`;
export const clearKey = (peer: string): string => `clear:${peer}`;
export const withdrawKey = (peer: string): string => `withdraw:${peer}`;
