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
import { type BotCommand, type MessageContent, keyboardOf, previewOf } from '../chat/content';
import { addMessage, listMessages, setMessageStatus, tombstoneMessage } from '../chat/messages';
import { extractButtonsBlock, toButtonWire } from '../../../shared/buttonsBlock';
import type { AssistantChatMessage, AssistantEngineId, DesktopAssistantApi } from '../../../shared/desktop-api';

import { type ReplyStream, createReplyStream } from './replyStream';

export const ASSISTANT_PEER: AssistantPeerId = 'local:assistant';
export const ASSISTANT_USERNAME = 'Assistant';
export const SYSTEM_PROMPT =
  'You are the Assistant inside Polkadot Chat, a desktop chat app on Polkadot: people and bots have usernames on the People chain, ' +
  'every chat is end-to-end encrypted, and you run locally on this computer as a built-in contact. Answer briefly in markdown. ' +
  'This client renders a trailing fenced ```buttons block in your reply as REAL clickable buttons under your message. ' +
  'When the user asks for buttons, or should pick from a few choices, you MUST end the reply with exactly one such block: ' +
  '```buttons\n{"rows":[[{"label":"Yes","action":{"command":"yes"}},{"label":"No","action":{"command":"no"}}]]}\n``` ' +
  'A pressed command button sends its command text back to you as the user\'s next message, so you will know which one was chosen. ' +
  'Only "command" and "url" (https) actions work here; at most 8 rows of 4 buttons, labels up to 40 characters. Put nothing after the block.';

/**
 * A finished reply: a ```buttons block (spec 0006, the lenient extraction pca
 * uses since a0e0497: a bare or `json` fence, a flat array, text after it)
 * becomes a keyboard under the text. A block that looks like buttons but
 * breaks the rules is stripped and logged, never shown as JSON. The
 * Assistant has no peer to receive a `callback`, so a callback button shows
 * disabled.
 */
export const replyContent = (text: string): MessageContent => {
  const block = extractButtonsBlock(text);
  if (!block) return { type: 'text', text };
  if (block.invalid.length > 0) console.warn('[assistant] dropped an invalid buttons block: %s', block.invalid.join('; '));
  if (!block.rows) return { type: 'text', text: block.text };
  const rows = keyboardOf(block.rows.map(row => row.map(toButtonWire))).map(row =>
    row.map(button => (button.action.kind === 'callback' ? { ...button, action: { kind: 'unsupported' as const } } : button)),
  );
  return { type: 'buttons', text: block.text, rows, oneShot: block.oneShot, pressed: null };
};
/**
 * How often a streaming reply's text goes to Dexie (M12d). The bubble paints
 * from memory (`AssistantChat.stream`); the row is for history and restarts.
 */
export const PERSIST_MS = 500;

/** How many earlier messages of the room go with a new one as context. */
export const CONTEXT_TURNS = 30;

/**
 * The Assistant's fixed command menu (M10 step 3). Both run here, in the
 * app; neither goes to the engine.
 */
export const ASSISTANT_COMMANDS: readonly BotCommand[] = [
  { name: 'reset', description: 'Start a new conversation' },
  { name: 'model', description: 'Show the engine and model' },
];

/** The notice `/reset` leaves in the room; the context starts after the last one. */
const RESET_ROW_PREFIX = 'assistant-reset:';

export const isAssistantPeer = (peer: string): peer is AssistantPeerId => peer === ASSISTANT_PEER;

/**
 * The request for the proxy: the system prompt, then the last `CONTEXT_TURNS`
 * finished text messages of the room, oldest first. A reply that is still
 * streaming or broke off, and the room's notices, are not context.
 */
export const buildContext = (rows: MessageRow[]): AssistantChatMessage[] => {
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  const lastReset = sorted.findLastIndex(row => row.messageId.startsWith(RESET_ROW_PREFIX));
  const turns = sorted
    .slice(lastReset + 1)
    .filter(row => row.direction !== 'system' && (row.content.type === 'text' || row.content.type === 'buttons') && row.content.text.trim() !== '')
    .filter(row => !(row.direction === 'incoming' && row.status !== 'received'))
    .slice(-CONTEXT_TURNS)
    .map((row): AssistantChatMessage => {
      const text = row.content.type === 'text' || row.content.type === 'buttons' ? row.content.text : '';
      // A forwarded message is someone's words the user asks about, not the user's own (M12f).
      const content = row.direction === 'outgoing' && row.forwardedFrom ? `Forwarded from ${row.forwardedFrom}:\n${text}` : text;
      return { role: row.direction === 'outgoing' ? 'user' : 'assistant', content };
    });
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...turns];
};

/** What the running reply does now: a tool line under the pending bubble. Null: thinking. */
export type AssistantActivityLine = { messageId: string; title: string } | null;

export type AssistantChat = {
  /**
   * Adds the user's message and starts the reply. Rejects when the main process refuses.
   * `forwardedFrom` (M12f "Ask the Assistant"): a message forwarded here; it is never run as a command.
   */
  send: (text: string, options?: { forwardedFrom?: string }) => Promise<void>;
  /** Stops the reply that is streaming; its text so far stays. */
  stop: () => Promise<void>;
  /**
   * Deletes a finished message of the room on this computer (nothing goes on
   * any wire): the same tombstone as RFC-0003. The engine session is dropped,
   * so the next turn starts fresh from the room, which leaves tombstones out.
   */
  deleteMessage: (messageId: string) => Promise<void>;
  /** The text of each streaming reply, for its bubble to paint (M12d). */
  stream: ReplyStream;
  /** The current tool line (useSyncExternalStore). */
  activity: () => AssistantActivityLine;
  onActivity: (listener: () => void) => () => void;
  dispose: () => void;
};

type Api = Pick<DesktopAssistantApi, 'send' | 'cancel' | 'onDelta' | 'onDone' | 'onError' | 'onActivity' | 'getSettings'>;

/** The engine session of the room's last reply. */
type StoredSession = { engine: AssistantEngineId; sessionId: string; replyId: string; prompt?: string };

/**
 * A CLI session keeps the system prompt it was created with (`--append-system-prompt`
 * on a resumed Claude Code session does not replace the original), so a
 * session is resumed only while the prompt is the one it was born with.
 */
export const promptFingerprint = (prompt: string): string => {
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) { h ^= prompt.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
};

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
  // Reply text so far, per reply id. The bubble paints it from `stream`;
  // Dexie is written from here at most every PERSIST_MS, one write at a time
  // (`queue`), with the latest text.
  const replies = new Map<string, { text: string; timestamp: number }>();
  const stream = createReplyStream();
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelPersist = (messageId: string) => {
    clearTimeout(persistTimers.get(messageId));
    persistTimers.delete(messageId);
  };
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
    // Buttons only once the reply is whole: a half-streamed block is text.
    const content: MessageContent = status === 'received' ? replyContent(reply.text) : { type: 'text', text: reply.text };
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
    if (event.conversationId !== ASSISTANT_PEER || ended.has(event.messageId)) return;
    const reply = track(event.messageId, lastSentAt);
    reply.text += event.text;
    stream.set(event.messageId, reply.text);
    if (persistTimers.has(event.messageId)) return;
    persistTimers.set(
      event.messageId,
      setTimeout(() => {
        persistTimers.delete(event.messageId);
        void queue(() => writeReply(event.messageId, 'streaming'));
      }, PERSIST_MS),
    );
  });

  const stopDone = api.onDone(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    endActivity(event.messageId);
    cancelPersist(event.messageId);
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
        await writeSetting('assistant.session', JSON.stringify({ engine: event.engine, sessionId: event.sessionId, replyId: event.messageId, prompt: promptFingerprint(SYSTEM_PROMPT) } satisfies StoredSession));
      }
    });
  });

  const stopError = api.onError(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
    endActivity(event.messageId);
    cancelPersist(event.messageId);
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
    if (stored.prompt !== promptFingerprint(SYSTEM_PROMPT)) return null;
    const { engine } = await api.getSettings();
    return engine === stored.engine ? stored.sessionId : null;
  };

  /** A notice row in the room (not context, not unread). */
  const notice = async (messageId: string, text: string): Promise<void> => {
    const last = (await listMessages(ASSISTANT_PEER)).at(-1);
    await addMessage(
      {
        messageId,
        peerAccountId: ASSISTANT_PEER,
        timestamp: Math.max(now(), (last?.timestamp ?? 0) + 1),
        direction: 'system',
        status: 'received',
        content: { type: 'text', text },
        reactions: [],
        editedAt: null,
      },
      { read: true },
    );
  };

  /** `/reset` and `/model` (ASSISTANT_COMMANDS). True when `text` was one of them. */
  const runCommand = async (text: string): Promise<boolean> => {
    const command = text.trim();
    if (command === '/reset') {
      // The CLI session holds the old turns too; do not resume it.
      await writeSetting('assistant.session', '');
      await notice(`${RESET_ROW_PREFIX}${randomId()}`, 'New conversation. The Assistant does not see the messages above.');
      return true;
    }
    if (command === '/model') {
      const settings = await api.getSettings();
      await notice(
        randomId(),
        settings.engine === 'proxy'
          ? `Model: ${settings.model}, through the LLM proxy. Change it in Settings.`
          : `Engine: ${settings.engine}. The engine picks its own model. Change it in Settings.`,
      );
      return true;
    }
    return false;
  };

  return {
    send: async (text, options = {}) => {
      if (!options.forwardedFrom && (await runCommand(text))) return;
      // Ended replies are painted from their rows now; their in-memory text can go.
      stream.forget(ended);
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
        ...(options.forwardedFrom ? { forwardedFrom: options.forwardedFrom } : {}),
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
    stream,
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
      for (const id of [...persistTimers.keys()]) cancelPersist(id);
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
