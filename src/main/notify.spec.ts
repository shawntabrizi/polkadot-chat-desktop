import { describe, expect, it } from 'vitest';

import { IPC } from '../shared/desktop-api';

import { type NotifyDeps, showNotification } from './notify';

const setup = (options: { supported?: boolean; minimized?: boolean; window?: boolean } = {}) => {
  const calls: string[] = [];
  const sent: [string, unknown][] = [];
  const handlers = new Map<string, () => void>();
  const created: { title: string; body: string; silent: boolean }[] = [];
  const deps: NotifyDeps = {
    isSupported: () => options.supported ?? true,
    create: opts => {
      created.push(opts);
      return {
        on: (event, listener) => handlers.set(event, listener),
        show: () => calls.push('show-notification'),
      };
    },
    beep: () => calls.push('beep'),
    getWindow: () =>
      options.window === false
        ? null
        : {
            isDestroyed: () => false,
            isMinimized: () => options.minimized ?? false,
            restore: () => calls.push('restore'),
            show: () => calls.push('show-window'),
            focus: () => calls.push('focus'),
            webContents: { send: (channel, payload) => sent.push([channel, payload]) },
          },
  };
  return { deps, calls, sent, created, click: () => handlers.get('click')?.() };
};

describe('showNotification', () => {
  // M6 step 7: a click focuses the window and opens the room.
  it('focuses the window and sends notify:open with the room on click', () => {
    const t = setup({ minimized: true });
    showNotification({ title: 'alice.01', body: 'hi', peerId: '0xaa', sound: false }, t.deps);
    expect(t.created).toEqual([{ title: 'alice.01', body: 'hi', silent: true }]);
    expect(t.calls).toEqual(['show-notification']);
    t.click();
    expect(t.calls).toEqual(['show-notification', 'restore', 'show-window', 'focus']);
    expect(t.sent).toEqual([[IPC.notifyOpen, { peerId: '0xaa' }]]);
  });

  it('opens a request by its id', () => {
    const t = setup();
    showNotification({ title: 'bob.02', body: 'Message request', peerId: '0xbb', requestId: 'r1', sound: false }, t.deps);
    t.click();
    expect(t.sent).toEqual([[IPC.notifyOpen, { peerId: '0xbb', requestId: 'r1' }]]);
  });

  // The Sound switch plays the system sound; the notification itself is silent.
  it('beeps only when sound is on', () => {
    const on = setup();
    showNotification({ title: 'a', body: 'b', peerId: '0xaa', sound: true }, on.deps);
    expect(on.calls[0]).toBe('beep');
    const off = setup();
    showNotification({ title: 'a', body: 'b', peerId: '0xaa', sound: false }, off.deps);
    expect(off.calls).not.toContain('beep');
  });

  it('does nothing visible where notifications are not supported, and survives a closed window', () => {
    const t = setup({ supported: false });
    showNotification({ title: 'a', body: 'b', peerId: '0xaa', sound: false }, t.deps);
    expect(t.created).toHaveLength(0);
    const gone = setup({ window: false });
    showNotification({ title: 'a', body: 'b', peerId: '0xaa', sound: false }, gone.deps);
    gone.click();
    expect(gone.sent).toHaveLength(0);
  });
});
