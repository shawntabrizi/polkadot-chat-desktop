/**
 * Owner bug (2026-09-24): in the meter bot's room the last message was the
 * "Top up 1 PAS" button; pressing it opened the signing strip below the fold,
 * so nothing seemed to happen until the user scrolled. The strip now docks
 * above the composer, which makes the flow shorter by the strip's height.
 * These rules keep what the user pressed in view while that happens, and
 * never move the flow when the pressed message is still visible.
 */

import { describe, expect, it } from 'vitest';

import { scrollAfterResize } from './flowScroll';

const STRIP = 220;
const CONTENT = 2_000;
const BEFORE = 600;
const AFTER = BEFORE - STRIP;
const distanceFromBottom = (scrollTop: number, clientHeight: number) => CONTENT - scrollTop - clientHeight;

describe('scrollAfterResize', () => {
  it('keeps the pressed last message fully in view: the flow stays at its bottom, above the strip', () => {
    const atBottom = CONTENT - BEFORE;
    const next = scrollAfterResize({ scrollTop: atBottom, scrollHeight: CONTENT, clientHeight: AFTER }, true, { top: CONTENT - 120, bottom: CONTENT });
    expect(next).not.toBeNull();
    expect(distanceFromBottom(next!, AFTER)).toBe(0);
    // Exactly the strip's height: the content under the reader does not jump.
    expect(next! - atBottom).toBe(STRIP);
  });

  it('at the bottom, keeps a pressed message near the top of the view in view instead of following the bottom', () => {
    const atBottom = CONTENT - BEFORE;
    const next = scrollAfterResize({ scrollTop: atBottom, scrollHeight: CONTENT, clientHeight: AFTER }, true, { top: atBottom + 20, bottom: atBottom + 160 });
    expect(next).toBe(atBottom + 20);
  });

  it('does not move the flow when the pressed message is still visible', () => {
    expect(scrollAfterResize({ scrollTop: 500, scrollHeight: CONTENT, clientHeight: AFTER }, false, { top: 600, bottom: 700 })).toBeNull();
  });

  it('scrolls just enough to show the end of a pressed message the strip would hide', () => {
    const next = scrollAfterResize({ scrollTop: 500, scrollHeight: CONTENT, clientHeight: AFTER }, false, { top: 850, bottom: 1_000 });
    expect(next).toBe(1_000 - AFTER);
  });

  it('shows the top of a pressed message taller than the flow, where its buttons start', () => {
    expect(scrollAfterResize({ scrollTop: 500, scrollHeight: CONTENT, clientHeight: AFTER }, false, { top: 700, bottom: 1_300 })).toBe(700);
  });

  it('leaves the flow alone with nothing to keep and the reader up in the history', () => {
    expect(scrollAfterResize({ scrollTop: 300, scrollHeight: CONTENT, clientHeight: AFTER }, false, null)).toBeNull();
  });
});
