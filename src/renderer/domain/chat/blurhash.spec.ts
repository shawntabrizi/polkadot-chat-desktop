import { describe, expect, it } from 'vitest';

import { decodeBlurhash, encodeBlurhash, isBlurhash } from './blurhash';

const solid = (width: number, height: number, [r, g, b]: [number, number, number]) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([r, g, b, 255], i * 4);
  return pixels;
};

// Why: the hash is what a recipient sees before the image arrives, and the
// phone apps send 4×3 hashes. A wrong hash paints the wrong colours; a
// malformed one from a remote message must not break the bubble.
describe('BlurHash', () => {
  it('encodes 4×3 components in 28 characters, as the phone apps send', () => {
    const hash = encodeBlurhash(solid(8, 6, [200, 30, 40]), 8, 6);
    expect(hash).toHaveLength(28);
    expect(isBlurhash(hash)).toBe(true);
  });

  it('paints back the colour it was made from', () => {
    const hash = encodeBlurhash(solid(8, 6, [200, 30, 40]), 8, 6);
    const pixels = decodeBlurhash(hash, 8, 6) as Uint8ClampedArray;
    const mean = (channel: number) => {
      let sum = 0;
      for (let i = channel; i < pixels.length; i += 4) sum += pixels[i] as number;
      return sum / (pixels.length / 4);
    };
    expect(Math.abs(mean(0) - 200)).toBeLessThanOrEqual(8);
    expect(Math.abs(mean(1) - 30)).toBeLessThanOrEqual(8);
    expect(Math.abs(mean(2) - 40)).toBeLessThanOrEqual(8);
  });

  it('decodes the reference example of blurha.sh and refuses malformed hashes', () => {
    expect(decodeBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj', 32, 32)).toHaveLength(32 * 32 * 4);
    // vectors-0012.md vector A carries a cut 12-character hash: shown as no placeholder, not an error.
    expect(decodeBlurhash('LEHV6nWB2yk8', 32, 32)).toBeNull();
    expect(decodeBlurhash('', 4, 4)).toBeNull();
    expect(decodeBlurhash('LéHV6nWB2yk8pyo0adR*.7kCMdnj', 4, 4)).toBeNull();
  });
});
