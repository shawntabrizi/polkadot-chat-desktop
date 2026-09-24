/**
 * M14 proposal card in the bubble. Why it matters: members stake PAS from
 * this bubble, so the state block must sit between the proposal text and its
 * vote buttons, say what this account did, and vanish with a deleted message
 * (a tombstone must not keep claiming a live vote).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MessageRow } from '../app/database';
import { type ProposalView, mineLine } from '../domain/chat/proposals';
import type * as Markdown from '../domain/markdown/markdown';

import { MessageBubble } from './MessageBubble';
import { ProposalStatus } from './ProposalCard';

// DOMPurify needs a DOM and specs run under node (as streamingFence.spec.ts).
vi.mock('../domain/markdown/markdown', async importOriginal => {
  const original = await importOriginal<typeof Markdown>();
  return { ...original, renderMarkdown: original.markdownToHtml };
});

const NOW = 1_800_000_000_000;
const view: ProposalView = { id: '3', title: 'Seeds', deadline: NOW + 65_000, tally: 'yes 0.2 PAS (2 votes), no 0 PAS (0 votes)', outcome: null, executed: false, myVote: 'yes', withdrawn: false };

const proposalRow = (content: MessageRow['content']): MessageRow => ({
  messageId: 'p3',
  peerAccountId: 'group:g',
  timestamp: 1,
  direction: 'incoming',
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
});

const render = (row: MessageRow, card: ProposalView) =>
  renderToStaticMarkup(
    createElement(MessageBubble, {
      row,
      quote: null,
      first: true,
      last: true,
      actions: { keyboard: { press: () => undefined, active: null }, status: createElement(ProposalStatus, { view: card, now: NOW }) },
    }),
  );

const buttons = proposalRow({
  type: 'buttons',
  text: 'Proposal #3: Seeds',
  rows: [[{ label: 'Vote yes (stake 0.1 PAS)', action: { kind: 'command', command: 'x' } }]],
  oneShot: false,
  pressed: null,
});

describe('ProposalStatus in the proposal bubble (M14)', () => {
  it('sits between the proposal text and the vote buttons, with the tally, the countdown and our vote', () => {
    const html = render(buttons, view);
    const text = html.indexOf('Proposal #3: Seeds');
    const card = html.indexOf('data-testid="proposal-card"');
    const vote = html.indexOf('Vote yes (stake 0.1 PAS)');
    expect(text).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(text);
    expect(vote).toBeGreaterThan(card);
    expect(html).toContain('Tally: yes 0.2 PAS (2 votes), no 0 PAS (0 votes)');
    expect(html).toContain('Voting closes in 1 min 5 s');
    expect(html).toContain('You voted yes');
  });

  it('is gone from a deleted message', () => {
    expect(render(proposalRow({ type: 'deleted' }), view)).not.toContain('proposal-card');
  });

  it('says when our stake is back, and nothing when we did nothing', () => {
    expect(mineLine({ ...view, withdrawn: true })).toBe('You voted yes · your stake is back');
    expect(mineLine({ ...view, myVote: null })).toBeNull();
    expect(render(buttons, { ...view, executed: true })).toContain('data-phase="executed"');
  });
});
