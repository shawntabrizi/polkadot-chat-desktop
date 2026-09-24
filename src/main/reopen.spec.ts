/**
 * Why: the owner's v0.2.0 died on a Dock click after the app bundle was moved
 * to /Applications while it ran. A new window needs a new renderer process
 * from the bundle's old path, and Electron aborts the process when that path
 * is gone. The reopen must never ask for a window then, and must never make
 * a second window while one is alive.
 */

import { describe, expect, it, vi } from 'vitest';

import { bundleMoved, reopenWindow } from './reopen';

const win = (destroyed = false) => ({ isDestroyed: () => destroyed });

describe('bundleMoved', () => {
  it('is true only when the executable the process started from is gone', () => {
    const exe = '/Users/x/dist/mac-arm64/Polkadot Chat.app/Contents/MacOS/Polkadot Chat';
    expect(bundleMoved(exe, () => true)).toBe(false);
    expect(bundleMoved(exe, () => false)).toBe(true);
  });

  it('checks the path it is given', () => {
    const exists = vi.fn(() => true);
    bundleMoved('/Applications/Polkadot Chat.app/Contents/MacOS/Polkadot Chat', exists);
    expect(exists).toHaveBeenCalledWith('/Applications/Polkadot Chat.app/Contents/MacOS/Polkadot Chat');
  });
});

describe('reopenWindow', () => {
  it('keeps a live window: a second activate never makes a second window', () => {
    const create = vi.fn(() => win());
    const onMoved = vi.fn();
    expect(reopenWindow({ current: () => win(), create, moved: () => false, onMoved })).toBe('reused');
    expect(create).not.toHaveBeenCalled();
  });

  it('makes a window when there is none, or only a destroyed one', () => {
    const create = vi.fn(() => win());
    expect(reopenWindow({ current: () => null, create, moved: () => false, onMoved: vi.fn() })).toBe('created');
    expect(reopenWindow({ current: () => win(true), create, moved: () => false, onMoved: vi.fn() })).toBe('created');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never makes a window after the bundle moved (a new renderer would abort the process); it tells the person instead', () => {
    const create = vi.fn(() => win());
    const onMoved = vi.fn();
    expect(reopenWindow({ current: () => null, create, moved: () => true, onMoved })).toBe('moved');
    expect(create).not.toHaveBeenCalled();
    expect(onMoved).toHaveBeenCalledOnce();
  });

  it('does not check the bundle while a window is alive (that window needs no new renderer)', () => {
    const moved = vi.fn(() => true);
    expect(reopenWindow({ current: () => win(), create: vi.fn(() => win()), moved, onMoved: vi.fn() })).toBe('reused');
    expect(moved).not.toHaveBeenCalled();
  });
});
