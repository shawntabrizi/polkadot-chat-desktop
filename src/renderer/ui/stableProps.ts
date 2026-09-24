/**
 * Stable props for the memoized bubbles (M12d step 2). A Dexie live query
 * returns new row objects on every change, and the rooms build new action
 * closures on every render, so without these every bubble re-renders
 * whenever any row of the room changes.
 */

import type { MessageRow } from '../app/database';

import type { BubbleActions } from './MessageBubble';

/** Structural equality for rows read from Dexie: plain objects, arrays, bytes, primitives. */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};

/** Keeps the previous object of each row that did not change, so a memoized bubble sees the same `row`. */
export const createRowCache = () => {
  let previous = new Map<string, MessageRow>();
  return {
    stabilize: (rows: readonly MessageRow[]): MessageRow[] => {
      const next = new Map<string, MessageRow>();
      const stable = rows.map(row => {
        const old = previous.get(row.messageId);
        const kept = old && sameValue(old, row) ? old : row;
        next.set(row.messageId, kept);
        return kept;
      });
      previous = next;
      return stable;
    },
  };
};

/** What a bubble renders from its actions: which ones exist, and their data (not the closures). */
const shapeOf = (actions: BubbleActions): string =>
  JSON.stringify({
    react: !!actions.react,
    reply: !!actions.reply,
    edit: !!actions.edit,
    retry: !!actions.retry,
    remove: actions.remove?.label ?? null,
    forward: !!actions.forward,
    keyboard: actions.keyboard ? { active: actions.keyboard.active, tx: actions.keyboard.tx ?? null, done: actions.keyboard.done ?? null } : null,
    referenceText: actions.referenceText ?? null,
    pin: actions.pin?.pinned ?? null,
  });

/**
 * Per row, the same actions object while what the bubble shows of it stays
 * the same. Its functions call the closures of the latest render, so a press
 * never runs against old room state. Actions that carry React elements
 * (`below`: the signing strip; M12g `body` and a keyboard's `extra`; M14
 * `status`) are passed through as they are.
 */
export const createActionCache = () => {
  const latest = new Map<string, BubbleActions>();
  const wrappers = new Map<string, { shape: string; actions: BubbleActions }>();
  const current = (messageId: string): BubbleActions | undefined => latest.get(messageId);

  const wrap = (messageId: string, actions: BubbleActions): BubbleActions => ({
    ...(actions.react ? { react: (emoji: string) => current(messageId)?.react?.(emoji) } : {}),
    ...(actions.reply ? { reply: () => current(messageId)?.reply?.() } : {}),
    ...(actions.edit ? { edit: () => current(messageId)?.edit?.() } : {}),
    ...(actions.retry ? { retry: () => current(messageId)?.retry?.() } : {}),
    ...(actions.remove ? { remove: { label: actions.remove.label, run: () => current(messageId)?.remove?.run() } } : {}),
    ...(actions.referenceText !== undefined ? { referenceText: actions.referenceText } : {}),
    // M14 fix: without this the M16b Pin / Unpin item never reached the menu.
    ...(actions.pin ? { pin: { pinned: actions.pin.pinned, run: () => current(messageId)?.pin?.run() } } : {}),
    ...(actions.forward ? { forward: (target: Parameters<NonNullable<BubbleActions['forward']>>[0]) => current(messageId)?.forward?.(target) } : {}),
    ...(actions.keyboard
      ? {
          keyboard: {
            press: (row: number, index: number) => current(messageId)?.keyboard?.press(row, index),
            active: actions.keyboard.active,
            ...(actions.keyboard.tx !== undefined ? { tx: actions.keyboard.tx } : {}),
            ...(actions.keyboard.done !== undefined ? { done: actions.keyboard.done } : {}),
          },
        }
      : {}),
  });

  return {
    get: (messageId: string, actions: BubbleActions | null): BubbleActions | null => {
      if (!actions) {
        latest.delete(messageId);
        wrappers.delete(messageId);
        return null;
      }
      latest.set(messageId, actions);
      if (actions.below || actions.body || actions.status || actions.keyboard?.extra) {
        wrappers.delete(messageId);
        return actions;
      }
      const shape = shapeOf(actions);
      const cached = wrappers.get(messageId);
      if (cached?.shape === shape) return cached.actions;
      const wrapped = wrap(messageId, actions);
      wrappers.set(messageId, { shape, actions: wrapped });
      return wrapped;
    },
  };
};
