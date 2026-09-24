/**
 * Owner-reported bug (M12c step 10): after one copy the button stayed
 * "Copied" until the room re-mounted, so a second copy gave no sign it
 * worked. The flag must clear by itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COPIED_MS, createCopyFlag, shortHash } from './copyFlag';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('copy flag', () => {
  it('shows "Copied" for 1.5 s, then clears, so the next copy shows it again', () => {
    const states: boolean[] = [];
    const flag = createCopyFlag(copied => states.push(copied));
    flag.copied();
    vi.advanceTimersByTime(COPIED_MS - 1);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
    flag.copied();
    expect(states.at(-1)).toBe(true);
    expect(COPIED_MS).toBe(1_500);
  });

  it('starts the 1.5 s again on a second copy, and a disposed flag changes nothing later', () => {
    const states: boolean[] = [];
    const flag = createCopyFlag(copied => states.push(copied));
    flag.copied();
    vi.advanceTimersByTime(1_000);
    flag.copied();
    vi.advanceTimersByTime(1_000);
    expect(states).toEqual([true, true]);
    flag.dispose();
    vi.advanceTimersByTime(COPIED_MS);
    expect(states).toEqual([true, true]);
  });
});

describe('shortHash', () => {
  it('keeps the first 6 and last 4 characters, as wallets show a hash', () => {
    expect(shortHash('0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f9f8e')).toBe('0x1a2b…9f8e');
    expect(shortHash('0x1234')).toBe('0x1234');
  });
});
