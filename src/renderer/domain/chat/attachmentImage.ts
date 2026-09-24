/**
 * Spec 0012 "Upload flow" step 1 for images, in the renderer (canvas APIs):
 * apply the EXIF rotation and drop all EXIF (GPS) by drawing and encoding
 * again, at most 2560 px on the long side, JPEG quality 0.8. A PNG under
 * 1 MiB (a screenshot) and a GIF (it may move) are sent as they are. Also
 * the 4×3 blurhash and, when it fits, a WebP thumbnail of at most 2 KB.
 */

import { MAX_THUMBNAIL_BYTES, type PreparedFile } from './attachments';
import { encodeBlurhash } from './blurhash';

const MAX_SIDE = 2560;
const KEEP_PNG_BYTES = 1024 * 1024;
const JPEG_QUALITY = 0.8;
const BLURHASH_SIDE = 32;
const THUMBNAIL_SIDES = [96, 72, 48] as const;
const THUMBNAIL_QUALITIES = [0.6, 0.4, 0.25] as const;

const fit = (width: number, height: number, side: number): { width: number; height: number } => {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const draw = (bitmap: ImageBitmap, size: { width: number; height: number }): OffscreenCanvas => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This computer cannot draw the image.');
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas;
};

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

const blurhashOf = (bitmap: ImageBitmap): string => {
  const size = fit(bitmap.width, bitmap.height, BLURHASH_SIDE);
  const pixels = draw(bitmap, size).getContext('2d')?.getImageData(0, 0, size.width, size.height).data;
  if (!pixels) throw new Error('This computer cannot read the image.');
  return encodeBlurhash(pixels, size.width, size.height, 4, 3);
};

/** The largest WebP thumbnail of at most 2 KB, or null (the blurhash is enough). */
const thumbnailOf = async (bitmap: ImageBitmap): Promise<Uint8Array | null> => {
  for (const side of THUMBNAIL_SIDES) {
    const canvas = draw(bitmap, fit(bitmap.width, bitmap.height, side));
    for (const quality of THUMBNAIL_QUALITIES) {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.type === 'image/webp' && blob.size <= MAX_THUMBNAIL_BYTES) return bytesOf(blob);
    }
  }
  return null;
};

export async function prepareImage(file: File): Promise<PreparedFile> {
  // `from-image` applies the EXIF orientation before anything is drawn.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const keep = file.type === 'image/gif' || (file.type === 'image/png' && file.size <= KEEP_PNG_BYTES);
    let bytes: Uint8Array;
    let mime: string;
    let size = { width: bitmap.width, height: bitmap.height };
    if (keep) {
      bytes = await bytesOf(file);
      mime = file.type;
    } else {
      size = fit(bitmap.width, bitmap.height, MAX_SIDE);
      bytes = await bytesOf(await draw(bitmap, size).convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }));
      mime = 'image/jpeg';
    }
    return {
      bytes,
      mime,
      // Photos carry no name (spec 0012); the picker's name may say more than the person meant to share.
      name: null,
      media: { kind: 'image', width: size.width, height: size.height },
      blurhash: blurhashOf(bitmap),
      thumbnail: await thumbnailOf(bitmap),
    };
  } finally {
    bitmap.close();
  }
}
