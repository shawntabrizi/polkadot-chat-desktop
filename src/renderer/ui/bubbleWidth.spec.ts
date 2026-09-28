/**
 * Owner report (2026-09-28): in a 720 px window the chat column was 390 px
 * wide, but bubbles were 60-80 px, words broke inside ("messag / es") and
 * the time took two lines ("01:57 / PM"). The hover toolbar (eight
 * reactions and More, 276 px) was a flex item beside the bubble, invisible
 * but still in the layout, and the bubble got only what was left of the row.
 * The toolbar must stay out of the flow, so the bubble alone sets its width,
 * and the time line must not wrap. The layout itself is measured in a real
 * browser by `npm run screenshots -- --only narrow-room-360,narrow-room-720,narrow-room-1280`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MessageRow } from '../app/database';
import type * as Markdown from '../domain/markdown/markdown';

import { MessageBubble } from './MessageBubble';

// DOMPurify needs a DOM and specs run under node (as ownMarkdown.spec.ts).
vi.mock('../domain/markdown/markdown', async importOriginal => {
  const original = await importOriginal<typeof Markdown>();
  return { ...original, renderMarkdown: original.markdownToHtml };
});

const row = (direction: MessageRow['direction']): MessageRow => ({
  messageId: `m-${direction}`,
  peerAccountId: '0xc9',
  timestamp: 1,
  direction,
  status: direction === 'outgoing' ? 'delivered' : 'received',
  content: { type: 'text', text: 'Long messages should wrap between words; messaging stays readable.' },
  reactions: [],
  editedAt: null,
});

const render = (direction: MessageRow['direction']): string =>
  renderToStaticMarkup(
    createElement(MessageBubble, { row: row(direction), quote: null, first: true, last: true, actions: { react: () => undefined, reply: () => undefined } }),
  );

/** The class list of the element with this test id. */
const classOf = (html: string, testId: string): string => {
  const match = new RegExp(`<div class="([^"]*)" data-testid="${testId}"`).exec(html);
  if (!match) throw new Error(`no ${testId} in ${html}`);
  return match[1] ?? '';
};

describe('a bubble keeps its width in a narrow room', () => {
  for (const direction of ['outgoing', 'incoming'] as const) {
    it(`${direction}: the hover toolbar is positioned out of the flow, so it takes no width from the bubble`, () => {
      const html = render(direction);
      const toolbar = classOf(html, 'message-toolbar').split(' ');
      expect(toolbar).toContain('absolute');
      expect(toolbar).not.toContain('shrink-0');
      // The row is the toolbar's containing block: it floats over this bubble, not a far ancestor.
      const rowClasses = classOf(html, `message-${direction}`).split(' ');
      expect(rowClasses).toContain('relative');
    });
  }

  it('the time and the ticks stay on one line', () => {
    expect(classOf(render('outgoing'), 'message-time').split(' ')).toContain('whitespace-nowrap');
  });
});
