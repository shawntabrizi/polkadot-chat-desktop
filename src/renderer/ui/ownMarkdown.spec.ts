/**
 * Owner ask (2026-09-24): what I send must look as my peer sees it. Before,
 * own bubbles showed raw `**` and backticks while the same text from a peer
 * rendered as markdown. Own text goes through the same renderer, so the
 * markup must be identical; only the bubble's tone class differs.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MessageRow } from '../app/database';
import type * as Markdown from '../domain/markdown/markdown';

import { MessageBubble } from './MessageBubble';

// DOMPurify needs a DOM and specs run under node: the bubble renders the
// markdown layer only (sanitizing is checked in markdown.spec.ts).
vi.mock('../domain/markdown/markdown', async importOriginal => {
  const original = await importOriginal<typeof Markdown>();
  return { ...original, renderMarkdown: original.markdownToHtml };
});

const TEXT = 'Some **bold** and `code`:\n\n```js\nconst a = 1;\n```\n\n- one\n- two\n\n[docs](https://example.com)';

const row = (direction: MessageRow['direction']): MessageRow => ({
  messageId: `m-${direction}`,
  peerAccountId: 'local:assistant',
  timestamp: 1,
  direction,
  status: direction === 'outgoing' ? 'sent' : 'delivered',
  content: { type: 'text', text: TEXT },
  reactions: [],
  editedAt: null,
});

const render = (direction: MessageRow['direction']): string =>
  renderToStaticMarkup(createElement(MessageBubble, { row: row(direction), quote: null, first: true, last: true, actions: null }));

/** The markdown element: its class list and its inner HTML. */
const markdownOf = (html: string): { classes: string; inner: string } => {
  const match = /<div class="([^"]*)" data-testid="markdown">(.*?)<\/div><\/div>/s.exec(html);
  if (!match) throw new Error(`no markdown element in ${html}`);
  return { classes: match[1] ?? '', inner: match[2] ?? '' };
};

describe('own messages render markdown like a peer', () => {
  it('an own message with bold, code, a fence, a list and a link gives the same HTML as the peer version', () => {
    const own = markdownOf(render('outgoing'));
    const peer = markdownOf(render('incoming'));
    expect(own.inner).toBe(peer.inner);
    expect(own.inner).toContain('<strong>bold</strong>');
    expect(own.inner).toContain('<code>code</code>');
    expect(own.inner).toContain('<pre>');
    expect(own.inner).toContain('<li>one</li>');
    expect(own.inner).not.toContain('**');
  });

  it('only the own bubble takes the inverted tone, so its links and code stay readable on the inverted surface', () => {
    expect(markdownOf(render('outgoing')).classes.split(' ')).toContain('md-inverted');
    expect(markdownOf(render('incoming')).classes.split(' ')).not.toContain('md-inverted');
  });
});
