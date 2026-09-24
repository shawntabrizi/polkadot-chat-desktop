/**
 * Owner-reported bug (M12): while an Assistant reply streams, its ```buttons
 * block showed as raw JSON in a code block until the reply ended. The raw
 * JSON must never reach the screen; placeholders stand in until the block
 * closes, then the keyboard shows.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MessageRow } from '../app/database';
import type * as Markdown from '../domain/markdown/markdown';

import { MessageBubble } from './MessageBubble';

// DOMPurify needs a DOM and specs run under node: the bubble renders the
// markdown layer only (sanitizing is not what these specs check).
vi.mock('../domain/markdown/markdown', async importOriginal => {
  const original = await importOriginal<typeof Markdown>();
  return { ...original, renderMarkdown: original.markdownToHtml };
});
import { streamingView } from './streamingFence';

const INTRO = 'Pick one:';
const OPEN = `${INTRO}\n\n\`\`\`buttons\n{"rows":[[{"label":"Yes","action":{"command":"yes"}},{"label":"No","action":{"com`;
const CLOSED = `${INTRO}\n\n\`\`\`buttons\n{"rows":[[{"label":"Yes","action":{"command":"yes"}},{"label":"No","action":{"command":"no"}}]]}\n\`\`\``;

const streamingRow = (text: string): MessageRow => ({
  messageId: 'r1',
  peerAccountId: 'local:assistant',
  timestamp: 1,
  direction: 'incoming',
  status: 'streaming',
  content: { type: 'text', text },
  reactions: [],
  editedAt: null,
});
const render = (text: string): string => renderToStaticMarkup(createElement(MessageBubble, { row: streamingRow(text), quote: null, first: true, last: true, actions: null }));

describe('streaming reply with a client directive fence', () => {
  it('an open buttons fence renders no JSON and two chip placeholders', () => {
    const html = render(OPEN);
    expect(html).not.toContain('{');
    expect(html).toContain(INTRO);
    expect(html.match(/data-testid="chip-placeholder"/g)).toHaveLength(2);
    expect(html).not.toContain('data-testid="keyboard"');
  });

  it('the same text, closed, renders the keyboard and no placeholder', () => {
    const html = render(CLOSED);
    expect(html).not.toContain('{');
    expect(html).toContain('data-testid="keyboard"');
    expect(html).toContain('Yes');
    expect(html).not.toContain('chip-placeholder');
  });

  // M12e (spec 0006 "Host parsing leniency"): a button-looking block that breaks
  // the rules is stripped, as the finished reply strips it; before M12e it stayed as text.
  it('a closed but malformed buttons block is stripped, as at the end', () => {
    const bad = `${INTRO}\n\n\`\`\`buttons\n{"rows": "no"}\n\`\`\``;
    expect(streamingView(bad)).toEqual({ text: INTRO, placeholder: false, block: null });
  });

  it('holds back a trailing partial fence (one or two backticks, or "```butt") so it does not flicker', () => {
    expect(streamingView(`${INTRO}\n\``).text).toBe(INTRO);
    expect(streamingView(`${INTRO}\n\`\``).text).toBe(INTRO);
    expect(streamingView(`${INTRO}\n\`\`\`butt`).text).toBe(INTRO);
  });

  it('an ordinary code fence still renders as code while it streams', () => {
    const code = `${INTRO}\n\n\`\`\`js\nconst a = { b: 1 };`;
    expect(streamingView(code)).toEqual({ text: code, placeholder: false, block: null });
    expect(render(code)).toContain('<code');
  });
});

// The owner's case (M12e): a small model wrote a bare fence with a flat array
// and a tip line after it. While it streams, no JSON may flash either.
describe('streaming reply with a lenient buttons fence', () => {
  const HEAD = "I'm Claude Haiku 4.5, the model behind this bot.";
  const JSON_ROW = '[{"label":"Got it","action":{"command":"ok"}}]';

  it('an open bare fence whose body starts with [ shows placeholders, not JSON', () => {
    const view = streamingView(`${HEAD}\n\n\`\`\`\n[{"label":"Got`);
    expect(view).toEqual({ text: HEAD, placeholder: true, block: null });
    expect(render(`${HEAD}\n\n\`\`\`\n[{"label":"Got`)).not.toContain('Got');
  });

  it('an open json fence whose body starts with { is hidden the same way', () => {
    expect(streamingView(`${HEAD}\n\`\`\`json\n  {"rows":[[`)).toEqual({ text: HEAD, placeholder: true, block: null });
  });

  it('an open bare fence with nothing in it yet is held back until its first character', () => {
    expect(streamingView(`${HEAD}\n\`\`\`\n`)).toEqual({ text: HEAD, placeholder: false, block: null });
  });

  it('closed, the keyboard shows and the tip line after it streams as text', () => {
    const view = streamingView(`${HEAD}\n\n\`\`\`\n${JSON_ROW}\n\`\`\`\n\n(Tip: send /help`);
    expect(view.text).toBe(`${HEAD}\n\n(Tip: send /help`);
    expect(view.block?.rows).toEqual([[{ label: 'Got it', action: { command: 'ok' } }]]);
    expect(view.placeholder).toBe(false);
  });

  it('an untagged fence of ordinary code or a plain list still streams as code', () => {
    const code = `${INTRO}\n\n\`\`\`\nnpm test`;
    expect(streamingView(code)).toEqual({ text: code, placeholder: false, block: null });
    const numbers = `${INTRO}\n\n\`\`\`json\n[1, 2, 3]\n\`\`\``;
    expect(streamingView(numbers)).toEqual({ text: numbers, placeholder: false, block: null });
  });
});
