// M15a: test images drawn without a canvas, for e2e-attach.mjs (a red circle
// on noise, about 300 KB, for the bot to describe) and screenshots.mjs (calm
// scenes for the attachment fixtures). RGB PNGs, written by hand.

import { deflateSync } from 'node:zlib';

/** A seeded PRNG, so every run draws the same image. */
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** RGBA pixels and a PNG of `paint(x, y) -> [r, g, b]`. */
const drawImage = (width, height, paint) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const [red, green, blue] = paint(x, y).map(v => Math.max(0, Math.min(255, Math.round(v))));
      rgba.set([red, green, blue, 255], (x + y * width) * 4);
      raw.set([red, green, blue], y * (1 + width * 3) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return { png: new Uint8Array(png), rgba, width, height };
};

/** A red circle on grey noise, about 300 KB (the noise does not compress): the e2e image a bot describes. */
export const drawTestImage = (width = 410, height = 310) => {
  const random = prng(15);
  const [cx, cy, r] = [width / 2, height / 2, Math.min(width, height) * 0.32];
  return drawImage(width, height, (x, y) => {
    const grey = 40 + Math.floor(random() * 216);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? [220, 20 + Math.floor(random() * 30), 30 + Math.floor(random() * 30)] : [grey, grey, grey];
  });
};

/** A calm scene for screenshots: a sky from `top` to `bottom`, a sun, and a sea below the horizon. */
export const drawScene = (width, height, { top, bottom, sun, sea }) =>
  drawImage(width, height, (x, y) => {
    const horizon = height * 0.62;
    const [sx, sy, sr] = [width * 0.68, horizon - height * 0.08, Math.min(width, height) * 0.11];
    if ((x - sx) ** 2 + (y - sy) ** 2 <= sr * sr && y < horizon) return sun;
    if (y >= horizon) {
      const ripple = Math.sin(x / 9 + y / 3) * 6;
      const t = (y - horizon) / (height - horizon);
      return sea.map((v, i) => v * (1 - t * 0.35) + ripple + (i === 2 ? 10 : 0));
    }
    const t = y / horizon;
    return top.map((v, i) => v * (1 - t) + (bottom[i] ?? 0) * t);
  });

/** Nearest-neighbour scale for the blurhash input. */
export const shrink = (rgba, width, height, side = 32) => {
  const w = side;
  const h = Math.max(1, Math.round((side * height) / width));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (Math.floor((x * width) / w) + Math.floor((y * height) / h) * width) * 4;
      out.set(rgba.subarray(from, from + 4), (x + y * w) * 4);
    }
  }
  return { pixels: out, w, h };
};

