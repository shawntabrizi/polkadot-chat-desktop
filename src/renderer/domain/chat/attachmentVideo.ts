/**
 * M15c (review M15b answer 4): a video is sent as a file (as it is, no
 * re-encode) with `media = video { width, height, durationMs }` and a poster:
 * the blurhash and, when it fits, a WebP thumbnail of one frame. The
 * renderer reads the size, the duration and the frame with a detached
 * `<video>` element; Chromium plays MP4 (H.264) and WebM (VP8/VP9) inline.
 */

import { type PreparedFile, wireFileName } from './attachments';
import { blurhashOf, thumbnailOf } from './attachmentImage';

/** What the app plays inline; other video types go as plain files. */
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
export const isVideoType = (type: string): boolean => (VIDEO_TYPES as readonly string[]).includes(type);

const LOAD_TIMEOUT_MS = 15_000;
/** The poster frame: 1 s in, or a quarter of a shorter video. */
const POSTER_AT_S = 1;

const once = (video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked'): Promise<void> =>
  new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('This video cannot be read.')), LOAD_TIMEOUT_MS);
    video.addEventListener(event, () => {
      clearTimeout(timer);
      done();
    }, { once: true });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      fail(new Error('This video cannot be played here. Send it as a file in another format (MP4 or WebM).'));
    }, { once: true });
  });

/** Duration in ms from the element; a WebM from MediaRecorder reports Infinity until it is scanned to the end. */
const durationOf = async (video: HTMLVideoElement): Promise<number> => {
  if (Number.isFinite(video.duration)) return Math.round(video.duration * 1000);
  video.currentTime = Number.MAX_SAFE_INTEGER;
  await once(video, 'seeked');
  const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
  return Math.round(duration * 1000);
};

export async function prepareVideo(file: File): Promise<PreparedFile> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadedmetadata');
    const durationMs = await durationOf(video);
    video.currentTime = Math.min(POSTER_AT_S, durationMs / 4000);
    await once(video, 'seeked');
    const frame = await createImageBitmap(video);
    try {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
        // A video is a file (review M15b answer 4): its name goes, as a file's does.
        name: wireFileName(file.name),
        media: { kind: 'video', width: video.videoWidth, height: video.videoHeight, durationMs },
        blurhash: blurhashOf(frame),
        thumbnail: await thumbnailOf(frame),
      };
    } finally {
      frame.close();
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
