import { describe, expect, it } from 'vitest';

import { REVEAL_MAX_MS, revealStart, revealedLength } from './reveal';

describe('revealedLength', () => {
  it('paints about 40 characters per 100 ms', () => {
    expect(revealedLength(1000, 0)).toBe(40);
    expect(revealedLength(1000, 99)).toBe(40);
    expect(revealedLength(1000, 100)).toBe(80);
    expect(revealedLength(1000, 450)).toBe(200);
  });

  // A long answer must not keep the reader waiting: 2 s at most, then all of it.
  it('snaps to the whole text at 2 s', () => {
    expect(revealedLength(5000, REVEAL_MAX_MS - 1)).toBeLessThan(5000);
    expect(revealedLength(5000, REVEAL_MAX_MS)).toBe(5000);
  });

  it('never paints more than the text', () => {
    expect(revealedLength(30, 0)).toBe(30);
    expect(revealedLength(0, 500)).toBe(0);
  });
});

describe('revealStart', () => {
  const state = (text: string, live = false, streaming = false) => ({ text, live, streaming });

  it('reveals a peer’s live frame replaced by other text, from the start', () => {
    expect(revealStart(state('⏳ working · 3s', true), state('Here is the answer'))).toBe(0);
    expect(revealStart(state('⏳ working · 3s', true), state('✓ Answered in 4s'))).toBe(0);
  });

  it('does not reveal a frame that is still a frame, or ordinary edits', () => {
    expect(revealStart(state('⏳ working · 3s', true), state('⏳ working · 6s', true))).toBeNull();
    expect(revealStart(state('hello'), state('hello (fixed)'))).toBeNull();
  });

  it('reveals an Assistant reply when its first text comes', () => {
    expect(revealStart(state('', false, true), state('First words', false, true))).toBe(0);
  });

  // M12d owner bug: completion typed the whole reply a second time.
  it('does not reveal again when the finished reply starts with what streamed', () => {
    expect(revealStart(state('All of it', false, true), state('All of it'))).toBeNull();
    expect(revealStart(state('All of', false, true), state('All of it'))).toBeNull();
    expect(revealStart(state('Some', false, true), state('Some more', false, true))).toBeNull();
  });

  it('reveals only the new tail when a CLI’s closing text replaces what streamed', () => {
    expect(revealStart(state('Let me check the files.', false, true), state('Let me answer: 42'))).toBe('Let me '.length);
    expect(revealStart(state('narration', false, true), state('The answer'))).toBe(0);
  });
});

describe('revealedLength from an offset', () => {
  it('starts after the characters already on screen', () => {
    expect(revealedLength(1000, 0, 300)).toBe(340);
    expect(revealedLength(1000, REVEAL_MAX_MS, 300)).toBe(1000);
  });
});
