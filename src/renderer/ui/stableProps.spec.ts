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

  // The M16b Pin item lives in the bubble's menu: a cache that drops `pin` hides it from every member with the flag.
  it('keeps the Pin action, its state and the latest closure', () => {
    const cache = createActionCache();
    const calls: string[] = [];
    const off = cache.get('a', { pin: { pinned: false, run: () => calls.push('old') } });
    cache.get('a', { pin: { pinned: false, run: () => calls.push('new') } })?.pin?.run();
    expect(calls).toEqual(['new']);
    expect(cache.get('a', { pin: { pinned: true, run: () => undefined } })).not.toBe(off);
    expect(cache.get('a', { pin: { pinned: true, run: () => undefined } })?.pin?.pinned).toBe(true);
  });

  // 2026-09-24: an expired tx button's "Ask for a new one". The first
  // screenshot run showed why: the cache dropped it, so the action never showed.
  it('keeps the ask-again action of an expired tx button and calls the latest closure', () => {
    const cache = createActionCache();
    const press = () => undefined;
    const calls: string[] = [];
    const plain = cache.get('a', { keyboard: { press, active: null } });
    expect(plain?.keyboard?.askAgain).toBeUndefined();
    const offered = cache.get('a', { keyboard: { press, active: null, askAgain: () => calls.push('old') } });
    expect(offered).not.toBe(plain);
    cache.get('a', { keyboard: { press, active: null, askAgain: (row, index) => calls.push(`new ${row}:${index}`) } })?.keyboard?.askAgain?.(0, 1);
    expect(calls).toEqual(['new 0:1']);
  });

  // M14: the proposal card's countdown changes every second; a cached status would freeze it.
  it('passes a status block through as it is', () => {
    const cache = createActionCache();
    const status = 'Voting closes in 5 s';
    expect(cache.get('a', { status })?.status).toBe(status);
  });
});

describe('createActionCache and M12g payments', () => {
  // The first screenshot run showed why: the cache dropped these fields, so a
  // paid request never showed "Paid" and the payer never saw Decline.
  it('passes a payment line, a done button, a body and a Decline through, and a change of state reaches the bubble', () => {
    const cache = createActionCache();
    const press = () => undefined;
    const pending = cache.get('r', { keyboard: { press, active: null, done: null }, referenceText: 'Sent 1 PAS to bob.02 · in block #7' });
    expect(pending?.referenceText).toBe('Sent 1 PAS to bob.02 · in block #7');
    const paid = cache.get('r', { keyboard: { press, active: null, done: { row: 0, index: 0, label: 'Paid' } }, referenceText: 'Sent 1 PAS to bob.02 · in block #7' });
    expect(paid).not.toBe(pending);
    expect(paid?.keyboard?.done).toEqual({ row: 0, index: 0, label: 'Paid' });
    const body = 'request bubble';
    expect(cache.get('own', { body })?.body).toBe(body);
    const extra = 'Decline';
    expect(cache.get('in', { keyboard: { press, active: null, extra } })?.keyboard?.extra).toBe(extra);
  });
});
