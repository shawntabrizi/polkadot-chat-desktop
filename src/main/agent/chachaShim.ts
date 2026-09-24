/**
 * M13: Electron's Node is built on BoringSSL, which has no
 * `chacha20-poly1305` cipher (`crypto.createCipheriv` throws "Unknown
 * cipher"). pca bot-core encrypts every chat statement with it through
 * `node:crypto`, so in an Electron utility process it could not read a single
 * chat request (seen live: BOT_OPENER_DECODE_FAILED "Unknown cipher"). This
 * gives `createCipheriv` / `createDecipheriv` that one algorithm from
 * `@noble/ciphers`, with the part of Node's AEAD API bot-core uses: update,
 * final, setAuthTag, getAuthTag, setAAD. Every other algorithm goes to the
 * native functions unchanged, and nothing is patched where the native cipher
 * exists. Same bytes as Node's (the spec round-trips against it).
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';

const ALGORITHM = 'chacha20-poly1305';
const TAG_BYTES = 16;

type Bytes = Uint8Array;
type CryptoModule = {
  createCipheriv: (...args: never[]) => unknown;
  createDecipheriv: (...args: never[]) => unknown;
};

/** An AEAD object shaped like Node's Cipher/Decipher for one-shot use: the output comes at `final()`. */
export const chachaAead = (key: Bytes, nonce: Bytes, decrypt: boolean) => {
  const parts: Buffer[] = [];
  let aad: Uint8Array | undefined;
  let tag: Buffer | null = null;
  let sealedTag: Buffer | null = null;
  let done = false;
  const self = {
    setAAD(data: Bytes) {
      aad = Uint8Array.from(data);
      return self;
    },
    setAutoPadding() {
      return self;
    },
    setAuthTag(value: Bytes) {
      if (!decrypt) throw new Error('setAuthTag is for decryption');
      tag = Buffer.from(value);
      return self;
    },
    update(data: Bytes | string, inputEncoding?: BufferEncoding) {
      if (done) throw new Error('Cipher already finalized');
      parts.push(typeof data === 'string' ? Buffer.from(data, inputEncoding) : Buffer.from(data));
      return Buffer.alloc(0);
    },
    final() {
      if (done) throw new Error('Cipher already finalized');
      done = true;
      const input = Buffer.concat(parts);
      const aead = chacha20poly1305(Uint8Array.from(key), Uint8Array.from(nonce), aad);
      if (decrypt) {
        if (!tag || tag.length !== TAG_BYTES) throw new Error('Unsupported state or unable to authenticate data');
        try {
          return Buffer.from(aead.decrypt(Buffer.concat([input, tag])));
        } catch {
          throw new Error('Unsupported state or unable to authenticate data');
        }
      }
      const sealed = aead.encrypt(input);
      sealedTag = Buffer.from(sealed.subarray(sealed.length - TAG_BYTES));
      return Buffer.from(sealed.subarray(0, sealed.length - TAG_BYTES));
    },
    getAuthTag() {
      if (!sealedTag) throw new Error('getAuthTag needs final() first');
      return sealedTag;
    },
  };
  return self;
};

const nativeWorks = (crypto: CryptoModule): boolean => {
  try {
    (crypto.createCipheriv as unknown as (a: string, k: Bytes, n: Bytes, o: object) => unknown)(ALGORITHM, new Uint8Array(32), new Uint8Array(12), { authTagLength: TAG_BYTES });
    return true;
  } catch {
    return false;
  }
};

/** Patches `crypto` (the `node:crypto` module object) when it lacks the cipher. True when it patched. */
export const installChachaShim = (crypto: CryptoModule): boolean => {
  if (nativeWorks(crypto)) return false;
  const nativeCipher = crypto.createCipheriv as unknown as (...args: unknown[]) => unknown;
  const nativeDecipher = crypto.createDecipheriv as unknown as (...args: unknown[]) => unknown;
  const pick =
    (native: (...args: unknown[]) => unknown, decrypt: boolean) =>
    (...args: unknown[]) => {
      const [algorithm, key, nonce] = args;
      if (typeof algorithm === 'string' && algorithm.toLowerCase() === ALGORITHM) return chachaAead(key as Bytes, nonce as Bytes, decrypt);
      return native(...args);
    };
  crypto.createCipheriv = pick(nativeCipher, false) as never;
  crypto.createDecipheriv = pick(nativeDecipher, true) as never;
  return true;
};
