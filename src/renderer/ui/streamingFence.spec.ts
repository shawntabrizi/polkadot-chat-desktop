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

  it('a closed but malformed block stays plain text (the end-of-reply fallback)', () => {
    const bad = `${INTRO}\n\n\`\`\`buttons\n{"rows": "no"}\n\`\`\``;
    expect(streamingView(bad)).toEqual({ text: bad, placeholder: false, block: null });
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
