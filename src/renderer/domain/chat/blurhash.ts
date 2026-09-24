/**
 * BlurHash encode and decode (https://blurha.sh, the algorithm of
 * woltapp/blurhash), written here from the published algorithm: no
 * dependency for ~100 lines. Spec 0012 sends a 4×3 hash, as the phone apps do
 * (Android `BlurHash.kt`, iOS `BlurHashConfiguration.swift`); a bubble paints
 * it while the image downloads.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

const encode83 = (value: number, length: number): string => {
  let out = '';
  for (let i = 1; i <= length; i++) out += DIGITS[Math.floor(value / 83 ** (length - i)) % 83];
  return out;
};

const decode83 = (text: string): number => {
  let value = 0;
  for (const char of text) {
    const digit = DIGITS.indexOf(char);
    if (digit < 0) return Number.NaN;
    value = value * 83 + digit;
  }
  return value;
};

const toLinear = (value: number): number => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (value: number): number => {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308 ? Math.trunc(v * 12.92 * 255 + 0.5) : Math.trunc((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5);
};

const signPow = (value: number, exp: number): number => Math.sign(value) * Math.abs(value) ** exp;

type Rgb = [number, number, number];

/** A BlurHash of `componentsX × componentsY` (1–9 each) for RGBA pixels. */
export const encodeBlurhash = (pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, componentsX = 4, componentsY = 3): string => {
  if (componentsX < 1 || componentsX > 9 || componentsY < 1 || componentsY > 9) throw new Error('BlurHash has 1 to 9 components per axis.');
  if (pixels.length !== width * height * 4) throw new Error('The pixels are not width × height RGBA.');
  const factors: Rgb[] = [];
  for (let j = 0; j < componentsY; j++) {
    for (let i = 0; i < componentsX; i++) {
      const normalisation = i === 0 && j === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const basis = normalisation * Math.cos((Math.PI * i * x) / width) * Math.cos((Math.PI * j * y) / height);
          const at = 4 * (x + y * width);
          r += basis * toLinear(pixels[at] as number);
          g += basis * toLinear(pixels[at + 1] as number);
          b += basis * toLinear(pixels[at + 2] as number);
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }
  const [dc, ...ac] = factors as [Rgb, ...Rgb[]];
  let hash = encode83(componentsX - 1 + (componentsY - 1) * 9, 1);
  let maximum = 1;
  if (ac.length > 0) {
    const actual = Math.max(...ac.flatMap(factor => factor.map(Math.abs)));
    const quantised = Math.floor(Math.max(0, Math.min(82, Math.floor(actual * 166 - 0.5))));
    maximum = (quantised + 1) / 166;
    hash += encode83(quantised, 1);
  } else {
    hash += encode83(0, 1);
  }
  hash += encode83((toSrgb(dc[0]) << 16) + (toSrgb(dc[1]) << 8) + toSrgb(dc[2]), 4);
  for (const factor of ac) {
    const [r, g, b] = factor.map(value => Math.floor(Math.max(0, Math.min(18, Math.floor(signPow(value / maximum, 0.5) * 9 + 9.5))))) as Rgb;
    hash += encode83(r * 19 * 19 + g * 19 + b, 2);
  }
  return hash;
};

/** Whether `hash` is a well-formed BlurHash (a remote message may carry anything). */
export const isBlurhash = (hash: string): boolean => {
  if (hash.length < 6) return false;
  const size = decode83(hash[0] as string);
  if (!Number.isFinite(size)) return false;
  const x = (size % 9) + 1;
  const y = Math.floor(size / 9) + 1;
  return hash.length === 4 + 2 * x * y && Number.isFinite(decode83(hash));
};

/** RGBA pixels of a `width × height` rendering of `hash`; null for a malformed hash. */
export const decodeBlurhash = (hash: string, width: number, height: number, punch = 1): Uint8ClampedArray | null => {
  if (!isBlurhash(hash)) return null;
  const size = decode83(hash[0] as string);
  const componentsY = Math.floor(size / 9) + 1;
  const componentsX = (size % 9) + 1;
  const maximum = ((decode83(hash[1] as string) + 1) / 166) * punch;
  const colors: Rgb[] = [];
  for (let i = 0; i < componentsX * componentsY; i++) {
    if (i === 0) {
      const value = decode83(hash.substring(2, 6));
      colors.push([toLinear(value >> 16), toLinear((value >> 8) & 255), toLinear(value & 255)]);
    } else {
      const value = decode83(hash.substring(4 + i * 2, 6 + i * 2));
      const q = [Math.floor(value / 361), Math.floor(value / 19) % 19, value % 19];
      colors.push(q.map(part => signPow((part - 9) / 9, 2) * maximum) as Rgb);
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < componentsY; j++) {
        for (let i = 0; i < componentsX; i++) {
          const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
          const color = colors[i + j * componentsX] as Rgb;
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const at = 4 * (x + y * width);
      pixels[at] = toSrgb(r);
      pixels[at + 1] = toSrgb(g);
      pixels[at + 2] = toSrgb(b);
      pixels[at + 3] = 255;
    }
  }
  return pixels;
};
