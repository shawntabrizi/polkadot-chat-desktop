/**
 * The built-in Assistant contact. It is local to this app: no account on
 * chain, no Statement Store. Its room lives in Dexie like any other
 * (peer `local:assistant`); a message goes to the main process
 * (`window.desktop.assistant`), which runs the engine chosen in Settings
 * (the LLM proxy with the key the renderer never sees, or a local agent
 * CLI), and the reply streams back into one message row.
 *
 * A CLI engine keeps its own session. The session id is kept in Dexie
 * (`assistant.session`) with the reply it produced, and is resumed only
 * while that reply is still the room's last one: after a reply from another
 * engine the CLI starts fresh and gets the room's history instead.
 */

import { randomId } from '../../app/bytes';
import { type AssistantPeerId, type MessageRow, db } from '../../app/database';
import { readSetting, writeSetting } from '../../app/settings';
import { previewOf } from '../chat/content';
import { addMessage, listMessages, setMessageStatus, tombstoneMessage } from '../chat/messages';
import type { AssistantChatMessage, AssistantEngineId, DesktopAssistantApi } from '../../../shared/desktop-api';

export const ASSISTANT_PEER: AssistantPeerId = 'local:assistant';
export const ASSISTANT_USERNAME = 'Assistant';
export const SYSTEM_PROMPT = 'You are the assistant inside Polkadot Chat. Answer briefly in markdown.';
/** How many earlier messages of the room go with a new one as context. */
export const CONTEXT_TURNS = 30;

export const isAssistantPeer = (peer: string): peer is AssistantPeerId => peer === ASSISTANT_PEER;

/**
 * The request for the proxy: the system prompt, then the last `CONTEXT_TURNS`
 * finished text messages of the room, oldest first. A reply that is still
 * streaming or broke off, and the room's notices, are not context.
 */
export const buildContext = (rows: MessageRow[]): AssistantChatMessage[] => {
  const turns = [...rows]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(row => row.direction !== 'system' && row.content.type === 'text' && row.content.text.trim() !== '')
    .filter(row => !(row.direction === 'incoming' && row.status !== 'received'))
    .slice(-CONTEXT_TURNS)
    .map((row): AssistantChatMessage => ({
      role: row.direction === 'outgoing' ? 'user' : 'assistant',
      content: row.content.type === 'text' ? row.content.text : '',
    }));
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...turns];
};

/** What the running reply does now: a tool line under the pending bubble. Null: thinking. */
export type AssistantActivityLine = { messageId: string; title: string } | null;

export type AssistantChat = {
  /** Adds the user's message and starts the reply. Rejects when the main process refuses. */
  send: (text: string) => Promise<void>;
  /** Stops the reply that is streaming; its text so far stays. */
  stop: () => Promise<void>;
  /**
   * Deletes a finished message of the room on this computer (nothing goes on
   * any wire): the same tombstone as RFC-0003. The engine session is dropped,
   * so the next turn starts fresh from the room, which leaves tombstones out.
   */
  deleteMessage: (messageId: string) => Promise<void>;
  /** The current tool line (useSyncExternalStore). */
  activity: () => AssistantActivityLine;
  onActivity: (listener: () => void) => () => void;
  dispose: () => void;
};

type Api = Pick<DesktopAssistantApi, 'send' | 'cancel' | 'onDelta' | 'onDone' | 'onError' | 'onActivity' | 'getSettings'>;

/** The engine session of the room's last reply. */
type StoredSession = { engine: AssistantEngineId; sessionId: string; replyId: string };

const readSession = async (): Promise<StoredSession | null> => {
  const raw = await readSetting('assistant.session');
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return typeof value.engine === 'string' && typeof value.sessionId === 'string' && typeof value.replyId === 'string'
      ? (value as StoredSession)
      : null;
  } catch {
    return null;
  }
};

/** "reading notes.md" → "Reading notes.md…" (M6 step 13). */
export const activityTitle = (title: string): string => {
  const line = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!line) return 'Working…';
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}${line.endsWith('…') ? '' : '…'}`;
};

export const createAssistantChat = (api: Api, now: () => number = Date.now): AssistantChat => {
  // Reply text so far, per reply id. Dexie is written from here, one write at
  // a time (`queue`), with the latest text: a burst of deltas makes one write.
  const replies = new Map<string, { text: string; timestamp: number }>();
  const dirty = new Set<string>();
  // Replies that already ended: a late `send` answer must not bring them back.
  const ended = new Set<string>();
  // A reply sorts after the message it answers, even within one millisecond.
  let lastSentAt = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const queue = (task: () => Promise<unknown>): Promise<unknown> => {
    chain = chain.then(task).catch((cause: unknown) => console.error('[assistant] write failed', cause));
    return chain;
  };

  /** Writes the reply row: created on the first write, then its text and status replaced. */
  const writeReply = async (messageId: string, status: MessageRow['status']): Promise<void> => {
    const reply = replies.get(messageId);
    if (!reply) return;
    const content = { type: 'text' as const, text: reply.text };
    // A reply deleted in the room stays deleted, whatever still arrives for it.
    if ((await db.messages.get(messageId))?.content.type === 'deleted') return;
    const updated = await db.messages.update(messageId, { content, status });
    if (updated === 0) {
      await addMessage({
        messageId,
        peerAccountId: ASSISTANT_PEER,
        timestamp: reply.timestamp,
        direction: 'incoming',
        status,
        content,
        reactions: [],
        editedAt: null,
      });
    }
    if (status !== 'streaming') await db.rooms.update(ASSISTANT_PEER, { lastPreview: previewOf(content) });
  };

  const track = (messageId: string, after: number) => {
    if (!replies.has(messageId)) replies.set(messageId, { text: '', timestamp: Math.max(now(), after + 1) });
    return replies.get(messageId) as { text: string; timestamp: number };
  };

  // A reply that was streaming when the app last closed will never finish.
  void queue(() =>
    db.messages
      .where('[peerAccountId+timestamp]')
      .between([ASSISTANT_PEER, -Infinity], [ASSISTANT_PEER, Infinity])
      .filter(row => row.status === 'streaming')
      .modify({ status: 'failed' }),
  );

  let activity: AssistantActivityLine = null;
  const activityListeners = new Set<() => void>();
  const setActivity = (next: AssistantActivityLine) => {
    if (activity?.messageId === next?.messageId && activity?.title === next?.title) return;
    activity = next;
    for (const listener of activityListeners) listener();
  };
  const endActivity = (messageId: string) => {
    if (activity?.messageId === messageId) setActivity(null);
  };

  const stopActivity = api.onActivity(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    if (event.event.type === 'tool_use') setActivity({ messageId: event.messageId, title: activityTitle(event.event.title) });
  });

  const stopDelta = api.onDelta(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    track(event.messageId, lastSentAt).text += event.text;
    if (dirty.has(event.messageId)) return;
    dirty.add(event.messageId);
    void queue(async () => {
      dirty.delete(event.messageId);
      await writeReply(event.messageId, 'streaming');
    });
  });

  const stopDone = api.onDone(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    endActivity(event.messageId);
    void queue(async () => {
      const reply = track(event.messageId, lastSentAt);
      // A CLI's closing text is the answer; what streamed before it may
      // include narration between tool calls.
      if (event.text !== undefined) reply.text = event.text;
      if (!reply.text.trim()) reply.text = '(no answer)';
      await writeReply(event.messageId, 'received');
      replies.delete(event.messageId);
      ended.add(event.messageId);
      if (event.sessionId) {
        await writeSetting('assistant.session', JSON.stringify({ engine: event.engine, sessionId: event.sessionId, replyId: event.messageId } satisfies StoredSession));
      }
    });
  });

  const stopError = api.onError(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    endActivity(event.messageId);
    void queue(async () => {
      const reply = replies.get(event.messageId);
      if (reply?.text) await writeReply(event.messageId, 'failed');
      else await db.messages.delete(event.messageId);
      // The reason is a notice in the room, so it stays after a restart.
      await addMessage(
        {
          messageId: randomId(),
          peerAccountId: ASSISTANT_PEER,
          timestamp: Math.max(now(), (reply?.timestamp ?? 0) + 1),
          direction: 'system',
          status: 'received',
          content: { type: 'text', text: `Assistant: ${event.message}` },
          reactions: [],
          editedAt: null,
        },
        { read: true },
      );
      replies.delete(event.messageId);
      ended.add(event.messageId);
    });
  });

  /** The stored session, while its reply is the room's last one and its engine is the current one. */
  const sessionToResume = async (earlier: MessageRow[]): Promise<string | null> => {
    const stored = await readSession();
    if (!stored) return null;
    const lastReply = [...earlier].reverse().find(row => row.direction === 'incoming');
    if (lastReply?.messageId !== stored.replyId) return null;
    const { engine } = await api.getSettings();
    return engine === stored.engine ? stored.sessionId : null;
  };

  return {
    send: async text => {
      const earlier = await listMessages(ASSISTANT_PEER);
      const outgoing: MessageRow = {
        messageId: randomId(),
        peerAccountId: ASSISTANT_PEER,
        timestamp: Math.max(now(), (earlier.at(-1)?.timestamp ?? 0) + 1),
        direction: 'outgoing',
        status: 'sending',
        content: { type: 'text', text },
        reactions: [],
        editedAt: null,
      };
      await addMessage(outgoing);
      lastSentAt = outgoing.timestamp;
      const sessionId = await sessionToResume(earlier);
      let messageId: string;
      try {
        ({ messageId } = await api.send({
          conversationId: ASSISTANT_PEER,
          messages: buildContext([...earlier, outgoing]),
          ...(sessionId ? { sessionId } : {}),
        }));
      } catch (cause) {
        await setMessageStatus(outgoing.messageId, 'failed');
        throw cause;
      }
      await setMessageStatus(outgoing.messageId, 'sent');
      // The row shows at once as "streaming", before the first delta.
      await queue(async () => {
        if (ended.has(messageId)) return;
        track(messageId, outgoing.timestamp);
        await writeReply(messageId, 'streaming');
      });
    },
    stop: () => api.cancel(ASSISTANT_PEER),
    deleteMessage: async messageId => {
      const row = await db.messages.get(messageId);
      if (!row || row.peerAccountId !== ASSISTANT_PEER || row.direction === 'system') return;
      if (row.status === 'streaming') throw new Error('Stop the reply first, then delete it.');
      await tombstoneMessage(messageId);
      // The CLI session still holds the deleted text; do not resume it.
      await writeSetting('assistant.session', '');
    },
    activity: () => activity,
    onActivity: listener => {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    dispose: () => {
      stopActivity();
      stopDelta();
      stopDone();
      stopError();
    },
  };
};

/** The prompt of the Settings "Test" button and of `npm run e2e:assistant`. */
export const TEST_PROMPT = 'Reply with exactly: proxy ok';
const TEST_CONVERSATION = 'settings-test';

/**
 * One prompt, not stored: resolves with the whole reply (Settings "Test").
 * Listens before it sends, so no delta is missed.
 */
export const askOnce = (api: Pick<Api, 'send' | 'onDelta' | 'onDone' | 'onError'>, prompt: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let reply = '';
    const stops = [
      api.onDelta(event => {
        if (event.conversationId === TEST_CONVERSATION) reply += event.text;
      }),
      api.onDone(event => {
        if (event.conversationId !== TEST_CONVERSATION) return;
        stops.forEach(stop => stop());
        resolve(event.text ?? reply);
      }),
      api.onError(event => {
        if (event.conversationId !== TEST_CONVERSATION) return;
        stops.forEach(stop => stop());
        reject(new Error(event.message));
      }),
    ];
    api.send({ conversationId: TEST_CONVERSATION, messages: [{ role: 'user', content: prompt }] }).catch((cause: unknown) => {
      stops.forEach(stop => stop());
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    });
  });
