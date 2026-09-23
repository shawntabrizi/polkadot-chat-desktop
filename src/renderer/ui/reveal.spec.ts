import { describe, expect, it } from 'vitest';

import { REVEAL_MAX_MS, answerArrived, revealedLength } from './reveal';

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

describe('answerArrived', () => {
  const state = (text: string, live = false, streaming = false) => ({ text, live, streaming });

  it('reveals a peer’s live frame replaced by other text', () => {
    expect(answerArrived(state('⏳ working · 3s', true), state('Here is the answer'))).toBe(true);
    expect(answerArrived(state('⏳ working · 3s', true), state('✓ Answered in 4s'))).toBe(true);
  });

  it('does not reveal a frame that is still a frame, or ordinary edits', () => {
    expect(answerArrived(state('⏳ working · 3s', true), state('⏳ working · 6s', true))).toBe(false);
    expect(answerArrived(state('hello'), state('hello (fixed)'))).toBe(false);
  });

  it('reveals an Assistant reply when its first text comes, and when the finished text replaces what streamed', () => {
    expect(answerArrived(state('', false, true), state('First words', false, true))).toBe(true);
    expect(answerArrived(state('narration', false, true), state('The answer'))).toBe(true);
  });

  it('does not reveal a streamed reply twice when it completes with the same text', () => {
    expect(answerArrived(state('All of it', false, true), state('All of it'))).toBe(false);
    expect(answerArrived(state('Some', false, true), state('Some more', false, true))).toBe(false);
  });
});
