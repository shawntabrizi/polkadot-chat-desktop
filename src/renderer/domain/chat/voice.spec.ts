/**
 * Spec 0012 voice notes: the bubble draws the waveform the sender computed,
 * so it must be 0–255 per bar, loudest bar 255, and a silent recording must
 * not divide by zero into NaN bars.
 */

import { describe, expect, it } from 'vitest';

import { WAVEFORM_BARS, clockOf, voiceProblem, waveformOf } from './voice';

describe('waveformOf', () => {
  it('takes the peak of each slice, scaled so the loudest is 255', () => {
    const samples = new Float32Array(3_200);
    samples[50] = -0.5; // bar 0, negative peaks count
    samples[3_150] = 0.25; // bar 31
    const bars = waveformOf(samples);
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(bars[0]).toBe(255);
    expect(bars[31]).toBe(128);
    expect(bars.slice(1, 31).every(v => v === 0)).toBe(true);
  });

  it('is all zeros for silence and for fewer samples than bars', () => {
    expect(waveformOf(new Float32Array(1_000))).toEqual(new Array(32).fill(0));
    expect(waveformOf([0.1, 0.2])).toHaveLength(32);
    expect(waveformOf([0.1, 0.2]).every(v => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });
});

describe('voice limits', () => {
  it('refuses a tap and anything over 5 minutes', () => {
    expect(voiceProblem(100)).toMatch(/too short/);
    expect(voiceProblem(300_001)).toMatch(/at most 5 minutes/);
    expect(voiceProblem(300_000)).toBeNull();
    expect(clockOf(299_999)).toBe('4:59');
  });
});
