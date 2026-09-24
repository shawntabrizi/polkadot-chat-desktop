/**
 * Spec 0012 voice notes (M15b): record from the microphone with
 * MediaRecorder (WebM/Opus, mono, 24 kbps; see voice.ts for why not Ogg),
 * then decode the recording once for its real duration and a 32-bar
 * waveform. DOM only; the pure part is voice.ts.
 */

import { MAX_VOICE_MS, RECORDER_MIME, type RecordedVoice, VOICE_BITRATE, WAVEFORM_BARS, waveformOf } from './voice';

export type VoiceRecording = {
  startedAt: number;
  /** Ends the recording and resolves with its bytes, duration and waveform. */
  stop: () => Promise<RecordedVoice>;
  /** Ends it and drops what was recorded. */
  cancel: () => void;
};

/** Stops a little before the limit: the decoded length can run a few ms past the timer. */
const LIMIT_MARGIN_MS = 250;

const microphone = (): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48_000, echoCancellation: true, noiseSuppression: true } });

/** Duration and waveform from the recording itself; the timer's length when it cannot be decoded. */
const measure = async (bytes: Uint8Array, elapsedMs: number): Promise<{ durationMs: number; waveform: number[] }> => {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes.slice().buffer);
    return { durationMs: Math.round(audio.duration * 1000), waveform: waveformOf(audio.getChannelData(0), WAVEFORM_BARS) };
  } catch {
    return { durationMs: elapsedMs, waveform: new Array<number>(WAVEFORM_BARS).fill(0) };
  } finally {
    void context.close();
  }
};

/**
 * Starts recording. `onLimit` runs when 5 minutes are reached (the caller
 * stops and sends). Rejects when there is no microphone or no permission.
 */
export async function startVoiceRecording(onLimit: () => void, openStream: () => Promise<MediaStream> = microphone): Promise<VoiceRecording> {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(RECORDER_MIME)) throw new Error('This computer cannot record Opus audio.');
  const stream = await openStream();
  const recorder = new MediaRecorder(stream, { mimeType: RECORDER_MIME, audioBitsPerSecond: VOICE_BITRATE });
  const parts: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size > 0) parts.push(event.data);
  };
  const stopped = new Promise<void>(done => {
    recorder.onstop = () => done();
  });
  const startedAt = Date.now();
  const limit = setTimeout(onLimit, MAX_VOICE_MS - LIMIT_MARGIN_MS);
  const end = () => {
    clearTimeout(limit);
    if (recorder.state !== 'inactive') recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  };
  recorder.start(1_000);
  return {
    startedAt,
    stop: async () => {
      const elapsed = Date.now() - startedAt;
      end();
      await stopped;
      const bytes = new Uint8Array(await new Blob(parts, { type: RECORDER_MIME }).arrayBuffer());
      return { bytes, ...(await measure(bytes, elapsed)) };
    },
    cancel: () => {
      end();
      parts.length = 0;
    },
  };
}
