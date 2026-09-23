import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageRow, appDatabase, db } from '../../app/database';
import { listMessages } from '../chat/messages';
import type { AssistantDelta, AssistantDone, AssistantError, AssistantSendRequest } from '../../../shared/desktop-api';

import { ASSISTANT_PEER, CONTEXT_TURNS, SYSTEM_PROMPT, TEST_PROMPT, askOnce, buildContext, createAssistantChat } from './assistant';

/** A stand-in for `window.desktop.assistant`: records requests, lets the test emit events. */
const fakeApi = (options: { refuse?: boolean } = {}) => {
  const listeners = {
    delta: [] as ((event: AssistantDelta) => void)[],
    done: [] as ((event: AssistantDone) => void)[],
    error: [] as ((event: AssistantError) => void)[],
  };
  const sent: AssistantSendRequest[] = [];
  const cancelled: string[] = [];
  let next = 0;
  const subscribe =
    <T>(list: ((event: T) => void)[]) =>
    (listener: (event: T) => void) => {
      list.push(listener);
      return () => list.splice(list.indexOf(listener), 1);
    };
  return {
    sent,
    cancelled,
    delta: (messageId: string, text: string) => listeners.delta.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId, text })),
    done: (messageId: string) => listeners.done.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId })),
    error: (messageId: string, message: string) => listeners.error.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId, message })),
    api: {
      send: async (request: AssistantSendRequest) => {
        if (options.refuse) throw new Error('No API key for the LLM proxy.');
        sent.push(request);
        return { messageId: `reply-${++next}` };
      },
      cancel: async (conversationId: string) => {
        cancelled.push(conversationId);
      },
      onDelta: subscribe(listeners.delta),
      onDone: subscribe(listeners.done),
      onError: subscribe(listeners.error),
    },
  };
};

const text = (row: MessageRow | undefined): string | undefined => (row?.content.type === 'text' ? row.content.text : undefined);

const row = (index: number, overrides: Partial<MessageRow> = {}): MessageRow => ({
  messageId: `m${index}`,
  peerAccountId: ASSISTANT_PEER,
  timestamp: index,
  direction: index % 2 === 0 ? 'outgoing' : 'incoming',
  status: index % 2 === 0 ? 'sent' : 'received',
  content: { type: 'text', text: `turn ${index}` },
  reactions: [],
  editedAt: null,
  ...overrides,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('buildContext', () => {
  // The prompt must lead every request, and the context must stay bounded no
  // matter how long the room gets (cost and the model's window).
  it('puts the system prompt first and keeps only the last 30 messages, oldest first', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i));
    const context = buildContext(rows.reverse());
    expect(context[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(context).toHaveLength(CONTEXT_TURNS + 1);
    expect(context[1]).toEqual({ role: 'user', content: 'turn 10' });
    expect(context.at(-1)).toEqual({ role: 'assistant', content: 'turn 39' });
  });

  // A half reply or an error notice would teach the model a wrong history.
  it('leaves out replies still streaming or broken off, and notices', () => {
    const context = buildContext([
      row(0),
      row(1, { status: 'failed' }),
      row(2),
      row(3, { status: 'streaming' }),
      row(4, { direction: 'system', status: 'received' }),
    ]);
    expect(context.map(m => m.content)).toEqual([SYSTEM_PROMPT, 'turn 0', 'turn 2']);
  });
});

describe('createAssistantChat', () => {
  it('stores the question, streams the reply into one row, and finishes it', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');

    expect(fake.sent[0]?.conversationId).toBe(ASSISTANT_PEER);
    expect(fake.sent[0]?.messages).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'hello' },
    ]);
    // The pending row exists before any text, so the room shows the reply is coming.
    expect((await db.messages.get('reply-1'))?.status).toBe('streaming');

    fake.delta('reply-1', '**Hi**');
    fake.delta('reply-1', ' there');
    await vi.waitFor(async () => expect(text(await db.messages.get('reply-1'))).toBe('**Hi** there'));
    fake.done('reply-1');
    await vi.waitFor(async () => expect((await db.messages.get('reply-1'))?.status).toBe('received'));

    const rows = await listMessages(ASSISTANT_PEER);
    expect(rows.map(r => [r.direction, r.status, text(r)])).toEqual([
      ['outgoing', 'sent', 'hello'],
      ['incoming', 'received', '**Hi** there'],
    ]);
    expect((await db.rooms.get(ASSISTANT_PEER))?.lastPreview).toBe('**Hi** there');
    chat.dispose();
  });

  it('keeps the partial text of a broken reply and adds the reason as a notice', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');
    fake.delta('reply-1', 'partial');
    fake.error('reply-1', 'Stopped.');
    await vi.waitFor(async () => expect((await listMessages(ASSISTANT_PEER)).at(-1)?.direction).toBe('system'));
    const rows = await listMessages(ASSISTANT_PEER);
    expect(rows.map(r => [r.direction, r.status, text(r)])).toEqual([
      ['outgoing', 'sent', 'hello'],
      ['incoming', 'failed', 'partial'],
      ['system', 'received', 'Assistant: Stopped.'],
    ]);
    chat.dispose();
  });

  it('drops an empty reply row when the request fails before any text', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');
    fake.error('reply-1', 'The proxy answered HTTP 401');
    await vi.waitFor(async () => expect((await listMessages(ASSISTANT_PEER)).at(-1)?.direction).toBe('system'));
    expect((await listMessages(ASSISTANT_PEER)).map(r => r.direction)).toEqual(['outgoing', 'system']);
    chat.dispose();
  });

  it('marks the question failed when the main process refuses it', async () => {
    const chat = createAssistantChat(fakeApi({ refuse: true }).api);
    await expect(chat.send('hello')).rejects.toThrow(/No API key/);
    expect((await listMessages(ASSISTANT_PEER)).map(r => r.status)).toEqual(['failed']);
    chat.dispose();
  });

  // After a restart no stream exists for such a row; it must not spin forever.
  it('marks a reply left streaming by an earlier run as failed', async () => {
    await db.messages.add(row(1, { status: 'streaming' }));
    const chat = createAssistantChat(fakeApi().api);
    await vi.waitFor(async () => expect((await db.messages.get('m1'))?.status).toBe('failed'));
    chat.dispose();
  });

  it('stops through the main process', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.stop();
    expect(fake.cancelled).toEqual([ASSISTANT_PEER]);
    chat.dispose();
  });
});

describe('askOnce', () => {
  // The Settings test must not add rows to the Assistant room.
  it('collects one reply without touching the database', async () => {
    const listeners: { delta?: (e: AssistantDelta) => void; done?: (e: AssistantDone) => void } = {};
    const sent: AssistantSendRequest[] = [];
    const api = {
      send: async (request: AssistantSendRequest) => {
        sent.push(request);
        queueMicrotask(() => {
          listeners.delta?.({ conversationId: request.conversationId, messageId: 'r', text: 'proxy ' });
          listeners.delta?.({ conversationId: request.conversationId, messageId: 'r', text: 'ok' });
          listeners.done?.({ conversationId: request.conversationId, messageId: 'r' });
        });
        return { messageId: 'r' };
      },
      cancel: async () => undefined,
      onDelta: (l: (e: AssistantDelta) => void) => ((listeners.delta = l), () => undefined),
      onDone: (l: (e: AssistantDone) => void) => ((listeners.done = l), () => undefined),
      onError: () => () => undefined,
    };
    expect(await askOnce(api, TEST_PROMPT)).toBe('proxy ok');
    expect(sent[0]?.conversationId).not.toBe(ASSISTANT_PEER);
    expect(sent[0]?.messages).toEqual([{ role: 'user', content: TEST_PROMPT }]);
    expect(await db.messages.count()).toBe(0);
  });
});
