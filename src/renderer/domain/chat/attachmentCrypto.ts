/**
 * Spec 0012 "Encryption": the per-attachment chunk cipher and the content
 * addresses. Browser-safe (WebCrypto AES-256-GCM, @noble BLAKE2b), so the
 * renderer, the tests and the Node e2e run the same code.
 *
 *   nonce_i   = nonce[0..8] : (nonce[8..12] XOR u32_be(i))
 *   aad_i     = b"pcd-att-v1" : u32_le(i) : u32_le(n) : u64_le(size)
 *   c_i       = AES-256-GCM(key, nonce_i, chunk_i, aad_i)   // ciphertext : tag
 *   chunks[i] = blake2b_256(c_i)
 *   cid_i     = "b" base32( 01 55 a0e402 20 : chunks[i] )
 *
 * The AAD binds a chunk to its place, the count and the size, so a swapped,
 * dropped or cut chunk fails to decrypt. The hash is checked before any
 * decryption: a wrong byte from a source never reaches the cipher.
 */

import { blake2b } from '@noble/hashes/blake2.js';

/** Plaintext bytes per chunk a sender uses: a 2,000,016-byte ciphertext, under Bulletin's 2 MiB `MaxTransactionSize`. */
export const SENDER_CHUNK_SIZE = 2_000_000;
const AAD_PREFIX = new TextEncoder().encode('pcd-att-v1');
const TAG_BYTES = 16;

export type AttachmentFailure = 'count' | 'hash' | 'damaged' | 'length';
export type AttachmentError = Error & { reason: AttachmentFailure };

const failure = (reason: AttachmentFailure, message: string): AttachmentError => Object.assign(new Error(message), { reason });

export const isAttachmentError = (error: unknown): error is AttachmentError =>
  error instanceof Error && typeof (error as Partial<AttachmentError>).reason === 'string';

/** `n = ⌈size / chunkSize⌉`; a size below 1 is not an attachment. */
export const chunkCount = (size: number, chunkSize: number): number => {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('An attachment has at least 1 byte.');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('The chunk size must be at least 1 byte.');
  return Math.ceil(size / chunkSize);
};

export const chunkNonce = (nonce: Uint8Array, index: number): Uint8Array => {
  if (nonce.length !== 12) throw new Error('The nonce is 12 bytes.');
  const out = nonce.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(8, (view.getUint32(8, false) ^ index) >>> 0, false);
  return out;
};

export const chunkAad = (index: number, count: number, size: number): Uint8Array => {
  const out = new Uint8Array(AAD_PREFIX.length + 16);
  out.set(AAD_PREFIX);
  const view = new DataView(out.buffer, AAD_PREFIX.length);
  view.setUint32(0, index, true);
  view.setUint32(4, count, true);
  view.setBigUint64(8, BigInt(size), true);
  return out;
};

/** The Bulletin content hash (unkeyed BLAKE2b, 32 bytes). */
export const contentHash = (bytes: Uint8Array): Uint8Array => blake2b(bytes, { dkLen: 32 });

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

export const matchesHash = (bytes: Uint8Array, hash: Uint8Array): boolean => sameBytes(contentHash(bytes), hash);

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const base32 = (bytes: Uint8Array): string => {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
};

/** CIDv1, raw codec (0x55), multihash blake2b-256 (0xb220), multibase base32: `bafk2bzace…`. */
export const cidOf = (hash: Uint8Array): string => {
  if (hash.length !== 32) throw new Error('A content hash is 32 bytes.');
  return `b${base32(Uint8Array.of(0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20, ...hash))}`;
};

/** A fresh key and nonce per attachment (never reused for another file). */
export const freshKeyAndNonce = (): { key: Uint8Array; nonce: Uint8Array } => ({
  key: crypto.getRandomValues(new Uint8Array(32)),
  nonce: crypto.getRandomValues(new Uint8Array(12)),
});

// WebCrypto wants ArrayBuffer-backed views; a copy makes that true for any input.
const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

const importKey = (key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> => {
  if (key.length !== 32) throw new Error('The key is 32 bytes.');
  return crypto.subtle.importKey('raw', own(key), 'AES-GCM', false, [usage]);
};

export type EncryptedAttachment = { ciphertexts: Uint8Array[]; hashes: Uint8Array[] };

/**
 * Encrypts `plaintext` into chunks. Deterministic for a key, nonce and file,
 * so a re-store (spec 0012 "Re-upload on request") yields the same CIDs.
 */
export async function encryptAttachment(plaintext: Uint8Array, key: Uint8Array, nonce: Uint8Array, chunkSize = SENDER_CHUNK_SIZE): Promise<EncryptedAttachment> {
  const size = plaintext.length;
  const count = chunkCount(size, chunkSize);
  const cryptoKey = await importKey(key, 'encrypt');
  const ciphertexts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = plaintext.subarray(i * chunkSize, Math.min(size, (i + 1) * chunkSize));
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: own(chunkNonce(nonce, i)), additionalData: own(chunkAad(i, count, size)), tagLength: TAG_BYTES * 8 },
      cryptoKey,
      own(chunk),
    );
    ciphertexts.push(new Uint8Array(sealed));
  }
  return { ciphertexts, hashes: ciphertexts.map(contentHash) };
}

export type ChunkRecipe = { key: Uint8Array; nonce: Uint8Array; size: number; chunkSize: number; chunks: readonly Uint8Array[] };

/**
 * Decrypts one fetched chunk: the hash first (a mismatch is `hash`, and the
 * cipher never sees the bytes), then the AEAD (a tag failure is `damaged`),
 * then the plaintext length of that position (`length`).
 */
export async function decryptChunk(recipe: ChunkRecipe, index: number, ciphertext: Uint8Array): Promise<Uint8Array> {
  const count = chunkCount(recipe.size, recipe.chunkSize);
  const expected = recipe.chunks[index];
  if (recipe.chunks.length !== count || !expected) throw failure('count', 'The attachment lists the wrong number of chunks.');
  if (!matchesHash(ciphertext, expected)) throw failure('hash', `Chunk ${index + 1} does not match its hash.`);
  const cryptoKey = await importKey(recipe.key, 'decrypt');
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: own(chunkNonce(recipe.nonce, index)), additionalData: own(chunkAad(index, count, recipe.size)), tagLength: TAG_BYTES * 8 },
        cryptoKey,
        own(ciphertext),
      ),
    );
  } catch {
    throw failure('damaged', 'Attachment is damaged.');
  }
  const want = index === count - 1 ? recipe.size - index * recipe.chunkSize : recipe.chunkSize;
  if (plain.length !== want) throw failure('length', 'Attachment is damaged.');
  return plain;
}

/** All chunks in order: each checked and decrypted, then the total length checked against `size`. */
export async function decryptAttachment(recipe: ChunkRecipe, ciphertexts: readonly Uint8Array[]): Promise<Uint8Array> {
  const count = chunkCount(recipe.size, recipe.chunkSize);
  if (ciphertexts.length !== count || recipe.chunks.length !== count) throw failure('count', 'The attachment has the wrong number of chunks.');
  const out = new Uint8Array(recipe.size);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const plain = await decryptChunk(recipe, i, ciphertexts[i] as Uint8Array);
    out.set(plain, offset);
    offset += plain.length;
  }
  if (offset !== recipe.size) throw failure('length', 'Attachment is damaged.');
  return out;
}
