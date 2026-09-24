/**
 * The text of an Assistant reply while it streams, in memory (M12d step 1).
 * The streaming bubble subscribes to its own reply here and repaints at most
 * once per animation frame; Dexie gets the text every 500 ms and at the end,
 * for history, previews and restarts, not for painting. Writing each delta
 * to Dexie re-read and re-rendered the whole room.
 */

export type ReplyStream = {
  /** The text streamed so far, or undefined when this reply has none in memory. */
  text: (messageId: string) => string | undefined;
  /** Called at most once per frame while the reply's text changes. */
  subscribe: (messageId: string, listener: () => void) => () => void;
};

export type ReplyStreamWriter = ReplyStream & {
  set: (messageId: string, text: string) => void;
  /** Forgets replies that ended; their rows hold the final text. */
  forget: (messageIds: Iterable<string>) => void;
};

type Schedule = (paint: () => void) => void;

const nextFrame: Schedule = paint => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => paint());
  else setTimeout(paint, 16);
};

export const createReplyStream = (schedule: Schedule = nextFrame): ReplyStreamWriter => {
  const texts = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const changed = new Set<string>();
  let scheduled = false;

  const paint = () => {
    scheduled = false;
    const ids = [...changed];
    changed.clear();
    for (const id of ids) for (const listener of listeners.get(id) ?? []) listener();
  };

  return {
    text: messageId => texts.get(messageId),
    subscribe: (messageId, listener) => {
      if (!listeners.has(messageId)) listeners.set(messageId, new Set());
      listeners.get(messageId)?.add(listener);
      return () => {
        listeners.get(messageId)?.delete(listener);
        if (listeners.get(messageId)?.size === 0) listeners.delete(messageId);
      };
    },
    set: (messageId, text) => {
      texts.set(messageId, text);
      changed.add(messageId);
      if (scheduled) return;
      scheduled = true;
      schedule(paint);
    },
    forget: messageIds => {
      for (const id of messageIds) texts.delete(id);
    },
  };
};
