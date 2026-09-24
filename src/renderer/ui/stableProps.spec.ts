/**
 * The memoized bubbles (M12d) only help when their props keep their
 * identity across a room render. The actions must also never run old room
 * state: a bubble that did not re-render still presses with the latest closure.
 */

import { describe, expect, it } from 'vitest';

import type { MessageRow } from '../app/database';

import { createActionCache, createRowCache, sameValue } from './stableProps';

const row = (id: string, text: string): MessageRow => ({
  messageId: id,
  peerAccountId: 'local:assistant',
  timestamp: 1,
  direction: 'incoming',
  status: 'received',
  content: { type: 'text', text },
  reactions: [],
  editedAt: null,
});

describe('createRowCache', () => {
  it('keeps the old object of an unchanged row and takes the new one of a changed row', () => {
    const cache = createRowCache();
    const [a, b] = cache.stabilize([row('a', 'one'), row('b', 'two')]);
    const [a2, b2] = cache.stabilize([row('a', 'one'), row('b', 'two, edited')]);
    expect(a2).toBe(a);
    expect(b2).not.toBe(b);
    expect(b2?.content).toEqual({ type: 'text', text: 'two, edited' });
  });

  it('compares bytes by value (a transaction intent in a button)', () => {
    expect(sameValue({ bytes: new Uint8Array([1, 2]) }, { bytes: new Uint8Array([1, 2]) })).toBe(true);
    expect(sameValue({ bytes: new Uint8Array([1, 2]) }, { bytes: new Uint8Array([1, 3]) })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
  });
});

describe('createActionCache', () => {
  it('returns the same actions while the bubble would show the same, and calls the latest closure', () => {
    const cache = createActionCache();
    const calls: string[] = [];
    const first = cache.get('a', { reply: () => calls.push('old'), remove: { label: 'Delete', run: () => calls.push('old delete') } });
    const second = cache.get('a', { reply: () => calls.push('new'), remove: { label: 'Delete', run: () => calls.push('new delete') } });
    expect(second).toBe(first);
    first?.reply?.();
    first?.remove?.run();
    expect(calls).toEqual(['new', 'new delete']);
  });

  it('gives new actions when what the bubble shows changes', () => {
    const cache = createActionCache();
    const press = () => undefined;
    const idle = cache.get('a', { keyboard: { press, active: null } });
    const pressed = cache.get('a', { keyboard: { press, active: { row: 0, index: 1, busy: true } } });
    expect(pressed).not.toBe(idle);
    expect(pressed?.keyboard?.active).toEqual({ row: 0, index: 1, busy: true });
    expect(cache.get('a', { keyboard: { press, active: null }, edit: () => undefined })).not.toBe(pressed);
    expect(cache.get('a', null)).toBeNull();
  });
});
