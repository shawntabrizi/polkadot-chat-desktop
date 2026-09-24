/**
 * M12h: a pending request's row must turn from "Sent · just now" to "No
 * answer yet" by itself after 15 s, with nothing else in the list changing.
 * Without its own timer the row keeps "Sent" until an unrelated write
 * re-renders the list, so a silent bot would look like it got the request.
 */

import { act, createElement } from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { RequestRow } from '../app/database';

// react-dom decides at import time whether a DOM exists: install it first.
const dom = await vi.hoisted(async () => (await import('./testDom')).installTestDom());
const { createRoot } = await import('react-dom/client');
// sonner injects its CSS at import time; the list only needs its toast function.
vi.mock('sonner', () => ({ toast: () => undefined }));
const { outgoingPreview, useSentClock } = await import('./ChatList');

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

describe('the chat-list row of a request just sent', () => {
  const root = createRoot(dom.container as unknown as HTMLElement);
  afterAll(async () => {
    await act(async () => root.unmount());
  });

  it('turns to "No answer yet" 15 s after sending with no other render', async () => {
    // Sent 14.8 s ago: the turn is 200 ms away, well inside the test.
    const request = { requestId: 'r', direction: 'outgoing', status: 'pending', timestamp: Date.now() - 14_800 } as RequestRow;
    const Row = () => createElement('span', { 'data-testid': 'preview' }, outgoingPreview(request.timestamp, useSentClock({ requests: [request] })));
    await act(async () => root.render(createElement(Row)));
    expect(dom.container.byTestId('preview')[0]?.textContent).toBe('Sent · just now');
    await act(() => sleep(400));
    expect(dom.container.byTestId('preview')[0]?.textContent).toBe('No answer yet · sent just now');
  });
});
