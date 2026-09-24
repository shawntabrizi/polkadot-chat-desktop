import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageRow, appDatabase, db } from '../../app/database';
import { listMessages } from '../chat/messages';
import type {
  AssistantActivity,
  AssistantDelta,
  AssistantDone,
  AssistantEngineId,
  AssistantError,
  AssistantSendRequest,
  AssistantSettings,
} from '../../../shared/desktop-api';

import { ASSISTANT_COMMANDS, ASSISTANT_PEER, CONTEXT_TURNS, SYSTEM_PROMPT, TEST_PROMPT, askOnce, buildContext, createAssistantChat, replyContent } from './assistant';

/** A stand-in for `window.desktop.assistant`: records requests, lets the test emit events. */
const fakeApi = (options: { refuse?: boolean; engine?: AssistantEngineId } = {}) => {
  const listeners = {
    delta: [] as ((event: AssistantDelta) => void)[],
    done: [] as ((event: AssistantDone) => void)[],
    error: [] as ((event: AssistantError) => void)[],
    activity: [] as ((event: AssistantActivity) => void)[],
  };
  const settings = { engine: options.engine ?? 'proxy' };
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
    done: (messageId: string, extra: Partial<AssistantDone> = {}) =>
      listeners.done.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId, engine: settings.engine, ...extra })),
    tool: (messageId: string, title: string) =>
      listeners.activity.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId, event: { type: 'tool_use', name: 'Read', title } })),
    settings,
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
      onActivity: subscribe(listeners.activity),
      getSettings: async () => ({ engine: settings.engine, model: 'auto/test-model' }) as AssistantSettings,
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

describe('the Assistant command menu (M10 step 3)', () => {
  it('offers exactly /reset and /model', () => {
    expect(ASSISTANT_COMMANDS.map(command => command.name)).toEqual(['reset', 'model']);
  });

  // `/reset` must really forget: a model that still sees the old turns after
  // "New conversation" would contradict the notice.
  it('/reset runs locally, and the next question goes without the earlier turns', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await db.messages.bulkAdd([row(0), row(1)]);
    await chat.send('/reset');
    expect(fake.sent).toHaveLength(0);
    const notice = (await listMessages(ASSISTANT_PEER)).at(-1);
    expect(notice?.direction).toBe('system');
    expect(text(notice)).toContain('New conversation');
    await chat.send('fresh start');
    expect(fake.sent[0]?.messages).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'fresh start' },
    ]);
    chat.dispose();
  });

  it('/model names the proxy model, or says a CLI engine picks its own, without asking the engine', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('/model');
    expect(text((await listMessages(ASSISTANT_PEER)).at(-1))).toBe('Model: auto/test-model, through the LLM proxy. Change it in Settings.');
    fake.settings.engine = 'claude';
    await chat.send(' /model ');
    expect(text((await listMessages(ASSISTANT_PEER)).at(-1))).toBe('Engine: claude. The engine picks its own model. Change it in Settings.');
    expect(fake.sent).toHaveLength(0);
    chat.dispose();
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

  // M12d: each delta written to Dexie re-read and re-rendered the whole room.
  it('keeps the streaming text in memory at once and writes Dexie at most every 500 ms', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');
    let writes = 0;
    const count = () => {
      writes++;
    };
    db.messages.hook('updating', count);
    try {
      for (let i = 0; i < 20; i++) fake.delta('reply-1', `${i} `);
      expect(chat.stream.text('reply-1')).toBe(Array.from({ length: 20 }, (_, i) => `${i} `).join(''));
      await new Promise(done => setTimeout(done, 100));
      expect(writes).toBe(0);
      await vi.waitFor(async () => expect(text(await db.messages.get('reply-1'))).toBe(chat.stream.text('reply-1')));
      expect(writes).toBe(1);
      fake.done('reply-1');
      await vi.waitFor(async () => expect((await db.messages.get('reply-1'))?.status).toBe('received'));
      // A delta after the end does not bring the reply back to "streaming".
      fake.delta('reply-1', 'late');
      await new Promise(done => setTimeout(done, 600));
      expect((await db.messages.get('reply-1'))?.status).toBe('received');
    } finally {
      db.messages.hook('updating').unsubscribe(count);
      chat.dispose();
    }
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

  // A CLI streams narration between tool calls; the room must end with the
  // answer the CLI closed the turn with, not the narration.
  it('replaces the streamed text with the final text of a CLI engine', async () => {
    const fake = fakeApi({ engine: 'claude' });
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');
    fake.delta('reply-1', 'Let me look. ');
    fake.delta('reply-1', 'The answer.');
    fake.done('reply-1', { text: 'The answer.', sessionId: 'S-1' });
    await vi.waitFor(async () => expect((await db.messages.get('reply-1'))?.status).toBe('received'));
    expect(text(await db.messages.get('reply-1'))).toBe('The answer.');
    chat.dispose();
  });

  // Resuming a session that did not see the room's last turns would answer
  // from a wrong history, so only the session of the last reply resumes.
  it('resumes the engine session only while its reply is the last one and the engine is the same', async () => {
    const fake = fakeApi({ engine: 'claude' });
    const chat = createAssistantChat(fake.api);
    await chat.send('one');
    fake.done('reply-1', { text: 'first', sessionId: 'S-1' });
    await vi.waitFor(async () => expect((await db.settings.get('assistant.session'))?.value).toContain('S-1'));

    await chat.send('two');
    expect(fake.sent[1]?.sessionId).toBe('S-1');
    fake.done('reply-2', { text: 'second' }); // an engine that reports no session (the proxy)
    await vi.waitFor(async () => expect((await db.messages.get('reply-2'))?.status).toBe('received'));

    await chat.send('three');
    expect(fake.sent[2]?.sessionId).toBeUndefined();
    fake.done('reply-3', { text: 'third', sessionId: 'S-3' });
    await vi.waitFor(async () => expect((await db.settings.get('assistant.session'))?.value).toContain('S-3'));

    fake.settings.engine = 'codex';
    await chat.send('four');
    expect(fake.sent[3]?.sessionId).toBeUndefined();
    chat.dispose();
  });

  it('shows the running tool as one line and clears it when the reply ends', async () => {
    const fake = fakeApi({ engine: 'claude' });
    const chat = createAssistantChat(fake.api);
    const seen: (string | null)[] = [];
    chat.onActivity(() => seen.push(chat.activity()?.title ?? null));
    await chat.send('hello');
    fake.tool('reply-1', 'reading notes.md');
    expect(chat.activity()).toEqual({ messageId: 'reply-1', title: 'Reading notes.md…' });
    fake.done('reply-1', { text: 'done' });
    expect(chat.activity()).toBeNull();
    expect(seen).toEqual(['Reading notes.md…', null]);
    chat.dispose();
  });

  // M7 step 4: local only, and the deleted text must not reach the engine
  // again, neither as room context nor through a resumed CLI session.
  it('deletes a message locally, leaves it out of the next context, and starts a fresh engine session', async () => {
    const fake = fakeApi({ engine: 'claude' });
    const chat = createAssistantChat(fake.api);
    await chat.send('my secret is 1234');
    fake.done('reply-1', { text: 'noted: 1234', sessionId: 'S-1' });
    await vi.waitFor(async () => expect((await db.settings.get('assistant.session'))?.value).toContain('S-1'));
    const question = (await listMessages(ASSISTANT_PEER)).find(r => r.direction === 'outgoing')!;

    await chat.deleteMessage(question.messageId);
    await chat.deleteMessage('reply-1');
    expect((await db.messages.get(question.messageId))?.content).toEqual({ type: 'deleted' });
    expect((await db.messages.get('reply-1'))?.content).toEqual({ type: 'deleted' });

    await chat.send('next');
    expect(fake.sent[1]?.sessionId).toBeUndefined();
    expect(JSON.stringify(fake.sent[1]?.messages)).not.toContain('1234');
    chat.dispose();
  });

  it('does not delete a reply that is still streaming, and a late event does not undo a deletion', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('hello');
    fake.delta('reply-1', 'partial');
    await vi.waitFor(async () => expect(text(await db.messages.get('reply-1'))).toBe('partial'));
    await expect(chat.deleteMessage('reply-1')).rejects.toThrow('Stop the reply first');
    fake.done('reply-1');
    await vi.waitFor(async () => expect((await db.messages.get('reply-1'))?.status).toBe('received'));
    await chat.deleteMessage('reply-1');
    fake.done('reply-1', { text: 'late' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await db.messages.get('reply-1'))?.content).toEqual({ type: 'deleted' });
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
          listeners.done?.({ conversationId: request.conversationId, messageId: 'r', engine: 'proxy' });
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

describe('Assistant buttons (spec 0006 fenced block)', () => {
  const reply = 'Which network?\n\n```buttons\n{"rows":[[{"label":"Paseo","action":{"command":"paseo"}},{"label":"Later","action":{"callback":"x"}}],[{"label":"Docs","action":{"url":"https://docs.polkadot.com"}}]]}\n```';

  it('turns a finished reply that ends with a block into text plus a keyboard; the Assistant cannot take a callback', () => {
    expect(replyContent(reply)).toEqual({
      type: 'buttons',
      text: 'Which network?',
      rows: [
        [
          { label: 'Paseo', action: { kind: 'command', command: 'paseo' } },
          { label: 'Later', action: { kind: 'unsupported' } },
        ],
        [{ label: 'Docs', action: { kind: 'url', url: 'https://docs.polkadot.com' } }],
      ],
      oneShot: false,
      pressed: null,
    });
    expect(replyContent('no block here')).toEqual({ type: 'text', text: 'no block here' });
  });

  // M12e, the owner's report: a small model wrote a bare fence, a flat array
  // and a tip line after it; the strict parser showed the raw JSON.
  it("takes the owner's lenient reply as text plus one row, and strips an invalid block with a log", () => {
    const owner = 'I\'m Claude Haiku 4.5.\n\n```\n[{"label":"Got it","action":{"command":"ok"}}]\n```\n\n(Tip: send /help to see my commands.)';
    expect(replyContent(owner)).toEqual({
      type: 'buttons',
      text: "I'm Claude Haiku 4.5.\n\n(Tip: send /help to see my commands.)",
      rows: [[{ label: 'Got it', action: { kind: 'command', command: 'ok' } }]],
      oneShot: false,
      pressed: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(replyContent('Pick\n```\n[{"label":"Go","action":{"url":"http://insecure.example"}}]\n```')).toEqual({ type: 'text', text: 'Pick' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid buttons block'), expect.stringContaining('row 1 button 1'));
    warn.mockRestore();
  });

  it('stores the keyboard only when the reply ends, and keeps the text as context for the next turn', async () => {
    const fake = fakeApi();
    const chat = createAssistantChat(fake.api);
    await chat.send('pick one for me');
    fake.delta('reply-1', reply);
    await vi.waitFor(async () => expect(text(await db.messages.get('reply-1'))).toBe(reply));
    fake.done('reply-1');
    await vi.waitFor(async () => expect((await db.messages.get('reply-1'))?.content.type).toBe('buttons'));
    expect((await db.rooms.get(ASSISTANT_PEER))?.lastPreview).toBe('Which network?');

    // A press sends the command as the next user message, with the keyboard's text as context.
    await chat.send('paseo');
    expect(fake.sent[1]?.messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Which network?' },
      { role: 'user', content: 'paseo' },
    ]);
    chat.dispose();
  });
});
