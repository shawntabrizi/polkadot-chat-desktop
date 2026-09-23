/**
 * The built-in Assistant contact. It is local to this app: no account on
 * chain, no Statement Store. Its room lives in Dexie like any other
 * (peer `local:assistant`); a message goes to the main process
 * (`window.desktop.assistant`), which calls the LLM proxy with the key the
 * renderer never sees, and the reply streams back into one message row.
 */

import { randomId } from '../../app/bytes';
import { type AssistantPeerId, type MessageRow, db } from '../../app/database';
import { previewOf } from '../chat/content';
import { addMessage, listMessages, setMessageStatus } from '../chat/messages';
import type { AssistantChatMessage, DesktopAssistantApi } from '../../../shared/desktop-api';

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

export type AssistantChat = {
  /** Adds the user's message and starts the reply. Rejects when the main process refuses. */
  send: (text: string) => Promise<void>;
  /** Stops the reply that is streaming; its text so far stays. */
  stop: () => Promise<void>;
  dispose: () => void;
};

type Api = Pick<DesktopAssistantApi, 'send' | 'cancel' | 'onDelta' | 'onDone' | 'onError'>;

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
    void queue(async () => {
      await writeReply(event.messageId, 'received');
      replies.delete(event.messageId);
      ended.add(event.messageId);
    });
  });

  const stopError = api.onError(event => {
    if (event.conversationId !== ASSISTANT_PEER) return;
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
      let messageId: string;
      try {
        ({ messageId } = await api.send({ conversationId: ASSISTANT_PEER, messages: buildContext([...earlier, outgoing]) }));
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
    dispose: () => {
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
export const askOnce = (api: Api, prompt: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let reply = '';
    const stops = [
      api.onDelta(event => {
        if (event.conversationId === TEST_CONVERSATION) reply += event.text;
      }),
      api.onDone(event => {
        if (event.conversationId !== TEST_CONVERSATION) return;
        stops.forEach(stop => stop());
        resolve(reply);
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
