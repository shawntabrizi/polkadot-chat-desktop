/**
 * Owner bug (M12d): a streaming Assistant reply painted choppily, and when
 * it completed the whole message "loaded a second time".
 * - Every delta re-read the room from Dexie and re-rendered every bubble,
 *   and each bubble parsed its markdown again; the cost grew with the room.
 *   A delta must re-render the streaming bubble only, however long the room
 *   is, also when its text is written to Dexie for history.
 * - Completion restarted the typing reveal from the first character (the
 *   stored reply lost its buttons block, so its text "changed") and swapped
 *   the bubble's DOM. Completion must keep the painted text and element.
 */

import { act, createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type MessageRow, appDatabase, db } from '../app/database';
import { ASSISTANT_PEER, createAssistantChat } from '../domain/assistant/assistant';
import { listMessages } from '../domain/chat/messages';
import type * as Markdown from '../domain/markdown/markdown';
import type * as Reveal from './reveal';
import type { AssistantDelta, AssistantDone, AssistantSettings } from '../../shared/desktop-api';

// react-dom decides at import time whether a DOM exists: install it first.
const dom = await vi.hoisted(async () => (await import('./testDom')).installTestDom());
const { createRoot } = await import('react-dom/client');
const { MessageFlow } = await import('./MessageFlow');
const { useLiveQuery } = await import('./useLiveQuery');

// DOMPurify needs a real DOM; the markdown layer alone is enough here.
vi.mock('../domain/markdown/markdown', async importOriginal => {
  const original = await importOriginal<typeof Markdown>();
  return { ...original, renderMarkdown: original.markdownToHtml };
});

// Every bubble render calls useTypingReveal once, with the text it paints: a render counter per bubble.
const renders: string[] = [];
vi.mock('./reveal', async importOriginal => {
  const original = await importOriginal<typeof Reveal>();
  return {
    ...original,
    useTypingReveal: (...args: Parameters<typeof original.useTypingReveal>) => {
      renders.push(args[0].text);
      return original.useTypingReveal(...args);
    },
  };
});

const ROOM = 60;
/** 80 characters at 40 per 100 ms, and a tick to spare. */
const REVEAL_DONE_MS = 400;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

const seedRow = (i: number): MessageRow => ({
  messageId: `seed-${i}`,
  peerAccountId: ASSISTANT_PEER,
  timestamp: 1_000 + i,
  direction: i % 2 ? 'incoming' : 'outgoing',
  status: i % 2 ? 'received' : 'sent',
  content: { type: 'text', text: `Earlier message ${i} with **markdown**` },
  reactions: [],
  editedAt: null,
});

const fakeApi = () => {
  const delta: ((event: AssistantDelta) => void)[] = [];
  const done: ((event: AssistantDone) => void)[] = [];
  const none = () => () => undefined;
  let replies = 0;
  const current = () => `reply-${replies}`;
  return {
    delta: (text: string) => delta.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId: current(), text })),
    /** `text`: a CLI engine's closing text. */
    done: (text?: string) => done.forEach(l => l({ conversationId: ASSISTANT_PEER, messageId: current(), engine: 'proxy', ...(text === undefined ? {} : { text }) })),
    api: {
      send: async () => ({ messageId: `reply-${++replies}` }),
      cancel: async () => undefined,
      onDelta: (l: (event: AssistantDelta) => void) => (delta.push(l), () => undefined),
      onDone: (l: (event: AssistantDone) => void) => (done.push(l), () => undefined),
      onError: none,
      onActivity: none,
      getSettings: async () => ({ engine: 'proxy', model: 'test' }) as AssistantSettings,
    },
  };
};

describe('a streaming reply in a room of 60 messages', () => {
  const fake = fakeApi();
  const chat = createAssistantChat(fake.api);
  const root = createRoot(dom.container as unknown as HTMLElement);

  const Harness = () => {
    const rows = useLiveQuery(() => listMessages(ASSISTANT_PEER), []);
    return createElement(MessageFlow, {
      rows: rows ?? [],
      peerName: 'Assistant',
      requests: [],
      assistant: true,
      // Fresh closures on every render, as the rooms build them.
      actionsFor: (row: MessageRow) => (row.status === 'streaming' ? {} : { remove: { label: 'Delete', run: () => void row } }),
      reveal: true,
      stream: chat.stream,
    });
  };

  beforeAll(async () => {
    await appDatabase.delete();
    await appDatabase.open();
    await db.messages.bulkAdd(Array.from({ length: ROOM }, (_, i) => seedRow(i)));
    await act(async () => {
      root.render(createElement(Harness));
      await sleep(100);
    });
    await act(async () => {
      await chat.send('Tell me more');
      fake.delta('First words');
      // Past the first reveal (2 s at most) and past a Dexie write.
      await sleep(2_200);
    });
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    chat.dispose();
  });

  it('re-renders only the streaming bubble on a delta, also when the text is written to Dexie', async () => {
    expect(dom.container.byTestId('bubble').length).toBe(ROOM + 2);
    renders.length = 0;
    // One act per delta, so each delta commits on its own (act batches what happens inside it).
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        fake.delta(` more ${i}`);
        await sleep(40);
      });
    }
    // Longer than the 500 ms between Dexie writes of a streaming reply.
    await act(() => sleep(700));
    const others = renders.filter(text => !text.startsWith('First words'));
    expect(others, `${others.length} renders of other bubbles for 10 deltas`).toEqual([]);
    expect(renders.length).toBeGreaterThan(0);
    // What streamed is on screen.
    expect(dom.container.byTestId('markdown').at(-1)?.textContent).toContain('more 9');
  });

  const lastMarkdown = () => dom.container.byTestId('markdown').at(-1);
  const BLOCK = '\n\n```buttons\n{"rows":[[{"label":"Yes","action":{"command":"yes"}},{"label":"No","action":{"command":"no"}}]]}\n```';

  it('completes a reply that ends in a buttons block without typing it again or re-creating it', async () => {
    await act(async () => {
      fake.delta(BLOCK);
      await sleep(40);
    });
    const streamedText = lastMarkdown()?.textContent ?? '';
    const element = lastMarkdown();
    const keyboard = dom.container.byTestId('keyboard')[0];
    expect(streamedText).toContain('more 9');
    expect(keyboard).toBeDefined();
    renders.length = 0;
    // The stored reply is the text without the block, plus a keyboard.
    await act(async () => {
      fake.done();
      await sleep(150);
    });
    expect(renders.at(-1)).toBe(streamedText.trim());
    // A restarted reveal paints 40 characters here; all of it stays on screen.
    expect(lastMarkdown()?.textContent).toBe(streamedText);
    // The same elements: the keyboard the stream showed becomes the finished one.
    expect(lastMarkdown()).toBe(element);
    expect(dom.container.byTestId('keyboard')).toEqual([keyboard]);
    expect(dom.container.byTestId('chip-placeholder')).toHaveLength(0);
  });

  it('completes with a closing text that starts with what streamed by appending only', async () => {
    const STREAMED = 'The answer, after reading every file in the project folder, is';
    await act(async () => {
      await chat.send('And then?');
      fake.delta(STREAMED);
      await sleep(2_100);
    });
    const element = lastMarkdown();
    expect(element?.textContent).toContain(STREAMED);
    await act(async () => {
      fake.done(`${STREAMED} 42.`);
      await sleep(150);
    });
    // A restarted reveal paints 40 characters here.
    expect(lastMarkdown()?.textContent).toContain(`${STREAMED} 42.`);
    expect(lastMarkdown()).toBe(element);
  });
});

// M12d step 5: a pca bot's live frames reach the bubble through the same
// memoized path; the answer that replaces the last frame is revealed once.
describe('a bot’s live frame replaced by its answer', () => {
  const ANSWER = 'Here is the answer from the bot, long enough to need more than one reveal tick.';
  const frame = (text: string, editedAt: number | null): MessageRow => ({
    messageId: 'bot-1',
    peerAccountId: '0x01',
    timestamp: 5_000,
    direction: 'incoming',
    status: 'received',
    content: { type: 'text', text },
    reactions: [],
    editedAt,
  });
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const show = (rows: MessageRow[]) =>
    act(async () => {
      root.render(createElement(MessageFlow, { rows, peerName: 'bot', requests: [], assistant: false, actionsFor: () => ({ reply: () => undefined }), reveal: true }));
      await sleep(20);
    });

  afterAll(async () => {
    await act(async () => root.unmount());
  });

  it('reveals the answer from its start, once', async () => {
    await show([frame('⏳ working · 3s', null)]);
    expect(container.byTestId('live-frame')).toHaveLength(1);
    await show([frame('⏳ working · 6s', 2)]);
    await show([frame(ANSWER, 3)]);
    const painted = container.byTestId('markdown')[0]?.textContent ?? '';
    expect(painted.length).toBeLessThan(ANSWER.length);
    expect(ANSWER.startsWith(painted.trim())).toBe(true);
    await act(() => sleep(REVEAL_DONE_MS));
    expect(container.byTestId('markdown')[0]?.textContent?.trim()).toBe(ANSWER);
    // The same row read again (a new object from the next live query) does not reveal again.
    await show([frame(ANSWER, 3)]);
    expect(container.byTestId('markdown')[0]?.textContent?.trim()).toBe(ANSWER);
  });
});
