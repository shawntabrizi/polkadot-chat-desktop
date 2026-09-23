/**
 * Window size and position across restarts, in `<userData>/window.json`.
 * A saved position is used only while it is on a connected display; a
 * window placed on a monitor that is gone would open out of sight.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserWindow, type Rectangle, app, screen } from 'electron';

export type WindowBounds = { width: number; height: number; x?: number; y?: number };

const DEFAULT_BOUNDS: WindowBounds = { width: 1200, height: 800 };
const MIN_SIZE = 320;

const statePath = (): string => join(app.getPath('userData'), 'window.json');

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

const onSomeDisplay = (bounds: Rectangle): boolean =>
  screen.getAllDisplays().some(({ workArea: area }) => {
    // At least a strip of the title bar must be on the display to drag it back.
    const left = Math.max(bounds.x, area.x);
    const right = Math.min(bounds.x + bounds.width, area.x + area.width);
    return right - left >= 100 && bounds.y >= area.y && bounds.y < area.y + area.height - 40;
  });

/** The saved bounds, or the default size when there are none or they do not fit. Call after `app` is ready. */
export const loadWindowBounds = (): WindowBounds => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return DEFAULT_BOUNDS;
  }
  const value = raw as Partial<WindowBounds> | null;
  if (!isInt(value?.width) || !isInt(value.height) || value.width < MIN_SIZE || value.height < MIN_SIZE) return DEFAULT_BOUNDS;
  const size = { width: value.width, height: value.height };
  if (isInt(value.x) && isInt(value.y) && onSomeDisplay({ ...size, x: value.x, y: value.y })) return { ...size, x: value.x, y: value.y };
  return size;
};

/** Saves the window's normal (not maximized, not full-screen) bounds when it closes. */
export const rememberWindowBounds = (win: BrowserWindow): void => {
  win.on('close', () => {
    const { x, y, width, height } = win.getNormalBounds();
    try {
      const target = statePath();
      writeFileSync(`${target}.tmp`, `${JSON.stringify({ x, y, width, height })}\n`);
      renameSync(`${target}.tmp`, target);
    } catch (error) {
      console.warn('[window] could not save the window bounds', error);
    }
  });
};
