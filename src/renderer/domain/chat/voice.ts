/**
 * Spec 0012 "Voice notes" (M15b), the pure part: limits, the waveform, and
 * the `PreparedFile` of a recording. Recording itself is voiceRecorder.ts
 * (MediaRecorder, DOM only).
 *
 * Container: Chromium's MediaRecorder cannot write Ogg (Electron 44:
 * `isTypeSupported('audio/ogg;codecs=opus')` is false, checked 2026-09-24),
 * so a voice note is `audio/webm; codecs=opus` (spec 0012 Unresolved 5; the
 * Opus packets are what the spec asks for, the container differs).
 */

import type { PreparedFile } from './attachments';

/** Spec 0012 "Limits": 5 minutes, one chunk at 24 kbps. */
export const MAX_VOICE_MS = 5 * 60_000;
/** Bars in the bubble's waveform (the spec allows up to 64 samples). */
export const WAVEFORM_BARS = 32;
export const VOICE_MIME = 'audio/webm; codecs=opus';
/** What MediaRecorder is asked for (no space: the form `isTypeSupported` takes). */
export const RECORDER_MIME = 'audio/webm;codecs=opus';
export const VOICE_BITRATE = 24_000;
/** A tap on the mic is not a voice note. */
export const MIN_VOICE_MS = 500;

export type RecordedVoice = { bytes: Uint8Array; durationMs: number; waveform: number[] };

/** Why a recording cannot be sent; null when it can. */
export const voiceProblem = (durationMs: number): string | null => {
  if (!Number.isFinite(durationMs) || durationMs < MIN_VOICE_MS) return 'The voice message is too short.';
  if (durationMs > MAX_VOICE_MS) return 'A voice message is at most 5 minutes.';
  return null;
};

/**
 * Peak per slice, 0–255, `bars` slices over the samples (spec 0012: "peak
 * per slice"). Scaled so the loudest slice is 255; silence stays 0.
 */
export const waveformOf = (samples: ArrayLike<number>, bars = WAVEFORM_BARS): number[] => {
  const peaks: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * samples.length) / bars));
    let peak = 0;
    for (let i = from; i < Math.min(to, samples.length); i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks, 0);
  return peaks.map(peak => (loudest > 0 ? Math.round((peak / loudest) * 255) : 0));
};

/** A voice note for `buildAttachment`: no name, no blurhash, no thumbnail. Throws the refusal text. */
export const prepareVoice = (voice: RecordedVoice): PreparedFile => {
  const problem = voiceProblem(voice.durationMs);
  if (problem) throw new Error(problem);
  if (voice.waveform.length > 64 || voice.waveform.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('The waveform is not 0–255 samples.');
  return {
    bytes: voice.bytes,
    mime: VOICE_MIME,
    name: null,
    media: { kind: 'voice', durationMs: Math.round(voice.durationMs), waveform: [...voice.waveform] },
    blurhash: null,
    thumbnail: null,
  };
};

/** "0:07", "4:59". */
export const clockOf = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
