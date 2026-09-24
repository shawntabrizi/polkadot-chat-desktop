/**
 * Dock reopen (macOS `activate`). A closed window's renderer process is gone,
 * so a new window starts a new one from the helper app inside our bundle.
 * Electron finds that helper by the path this process started from. When the
 * bundle was moved or deleted while the app ran (dragged from dist/ to
 * /Applications), the helper is not there and Electron stops the whole
 * process on a native CHECK ("Aborted from launching unexpected helper
 * executable", SIGTRAP): the Dock click killed the app (docs/decisions.md
 * "Dock reopen crash"). So a reopen checks the path first.
 */

import { existsSync } from 'node:fs';

/** The executable this process started from is gone: the app was moved or deleted while it ran. */
export const bundleMoved = (execPath: string = process.execPath, exists: (path: string) => boolean = existsSync): boolean => !exists(execPath);

type WindowLike = { isDestroyed(): boolean };

export type ReopenDeps<W extends WindowLike> = {
  current: () => W | null;
  create: () => W;
  moved: () => boolean;
  onMoved: () => void;
};

export type ReopenResult = 'reused' | 'created' | 'moved';

/** One window per process: a live window is kept; a new one is made only when the bundle is still in place. */
export const reopenWindow = <W extends WindowLike>(deps: ReopenDeps<W>): ReopenResult => {
  const win = deps.current();
  if (win && !win.isDestroyed()) return 'reused';
  if (deps.moved()) {
    deps.onMoved();
    return 'moved';
  }
  deps.create();
  return 'created';
};
