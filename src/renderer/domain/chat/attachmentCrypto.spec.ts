import { afterEach, describe, expect, it, vi } from 'vitest';

import { bytesToHex, hexToBytes } from '../../app/bytes';

import { chunkAad, chunkCount, chunkNonce, cidOf, decryptAttachment, decryptChunk, encryptAttachment, isAttachmentError } from './attachmentCrypto';

// docs/spec/vectors-0012.md, computed with Node crypto and Python hashlib.
// The pca codec pins the same bytes: a chunk the desktop stores must be one
// a bot can fetch by CID and decrypt, and the reverse.
const key = new Uint8Array(32).fill(0x11);
const nonce = new Uint8Array(12).fill(0x22);
const text = (value: string) => new TextEncoder().encode(value);

const C1 = {
  aad: '0x7063642d6174742d763100000000010000000f00000000000000',
  c0: '0x7f926b25afe3bf3d9053b2593ccf8785d9d92181762c9f5eb36cf0a96d4554',
  hash: '0xd47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a',
  cid: 'bafk2bzacedkhwk4hqr7cfe4526y7krkb7753jl7pycofql525ces2buc7sfiu',
};
const C2 = {
  nonce1: '0x222222222222222222222223',
  aad: ['0x7063642d6174742d763100000000020000000d00000000000000', '0x7063642d6174742d763101000000020000000d00000000000000'],
  c: ['0x67986b22a1abf02bcb5de371c38de836d3c4fd3d580848ad', '0x196f0194e977fac63158d4778d8a53ac4c540c207f'],
  hash: ['0xf2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb4', '0x7e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a8'],
  cid: ['bafk2bzacedzecptijg7o5ueul5l4nyvneer76h5ro75jl5yr5mdik6dlinf3i', 'bafk2bzaceb7hsb3nqsmjcnpyjyxqbvzz6pihcsc7cq7kjbpn4tgsam7r5oykq'],
};
const c2Recipe = { key, nonce, size: 13, chunkSize: 8, chunks: C2.hash.map(hash => hexToBytes(hash)) };

const failureOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    return isAttachmentError(error) ? error.reason : `other: ${String(error)}`;
  }
  return 'no failure';
};

afterEach(() => vi.restoreAllMocks());

describe('vector C1: one chunk', () => {
  it('reproduces nonce, AAD, ciphertext, hash and CID', async () => {
    expect(bytesToHex(chunkNonce(nonce, 0))).toBe('0x222222222222222222222222');
    expect(bytesToHex(chunkAad(0, 1, 15))).toBe(C1.aad);
    const { ciphertexts, hashes } = await encryptAttachment(text('hello, bulletin'), key, nonce, 2_000_000);
    expect(ciphertexts.map(bytesToHex)).toEqual([C1.c0]);
    expect(hashes.map(bytesToHex)).toEqual([C1.hash]);
    expect(cidOf(hexToBytes(C1.hash))).toBe(C1.cid);
  });

  it('decrypts back to the plaintext', async () => {
    const plain = await decryptAttachment({ key, nonce, size: 15, chunkSize: 2_000_000, chunks: [hexToBytes(C1.hash)] }, [hexToBytes(C1.c0)]);
    expect(new TextDecoder().decode(plain)).toBe('hello, bulletin');
  });
});

describe('vector C2: two chunks', () => {
  it('reproduces both chunks', async () => {
    expect(bytesToHex(chunkNonce(nonce, 1))).toBe(C2.nonce1);
    expect([bytesToHex(chunkAad(0, 2, 13)), bytesToHex(chunkAad(1, 2, 13))]).toEqual(C2.aad);
    const { ciphertexts, hashes } = await encryptAttachment(text('polkadot chat'), key, nonce, 8);
    expect(ciphertexts.map(bytesToHex)).toEqual(C2.c);
    expect(hashes.map(bytesToHex)).toEqual(C2.hash);
    expect(hashes.map(cidOf)).toEqual(C2.cid);
  });

  it('decrypts in order', async () => {
    const plain = await decryptAttachment(c2Recipe, C2.c.map(hex => hexToBytes(hex)));
    expect(new TextDecoder().decode(plain)).toBe('polkadot chat');
  });

  // The negative checks vectors-0012.md requires: a source (or a relay of the
  // message) that reorders, drops or resizes must never yield a file.
  it('fails when the chunks are swapped', async () => {
    expect(await failureOf(decryptAttachment(c2Recipe, [hexToBytes(C2.c[1] as string), hexToBytes(C2.c[0] as string)]))).toBe('hash');
    // Even with the hash list swapped too, the AAD binds the position: the tag fails.
    const swapped = { ...c2Recipe, chunks: [c2Recipe.chunks[1] as Uint8Array, c2Recipe.chunks[0] as Uint8Array] };
    expect(await failureOf(decryptAttachment(swapped, [hexToBytes(C2.c[1] as string), hexToBytes(C2.c[0] as string)]))).toBe('damaged');
  });

  it('fails when the last chunk is dropped', async () => {
    expect(await failureOf(decryptAttachment(c2Recipe, [hexToBytes(C2.c[0] as string)]))).toBe('count');
    // A message that claims one chunk of 8 bytes: the first chunk's AAD says n = 2.
    expect(await failureOf(decryptAttachment({ ...c2Recipe, size: 8, chunks: [c2Recipe.chunks[0] as Uint8Array] }, [hexToBytes(C2.c[0] as string)]))).toBe('damaged');
  });

  it('fails when the size changes (chunk 0 with size 12 in the AAD)', async () => {
    expect(await failureOf(decryptChunk({ ...c2Recipe, size: 12 }, 0, hexToBytes(C2.c[0] as string)))).toBe('damaged');
  });
});

describe('a tampered chunk', () => {
  it('fails the hash check and never reaches the cipher', async () => {
    const tampered = hexToBytes(C1.c0);
    tampered[3] = (tampered[3] as number) ^ 0x01;
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    expect(await failureOf(decryptAttachment({ key, nonce, size: 15, chunkSize: 2_000_000, chunks: [hexToBytes(C1.hash)] }, [tampered]))).toBe('hash');
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe('chunking', () => {
  it('refuses an empty file and counts 1, exact and over the chunk size', () => {
    expect(() => chunkCount(0, 2_000_000)).toThrow();
    expect(chunkCount(1, 2_000_000)).toBe(1);
    expect(chunkCount(2_000_000, 2_000_000)).toBe(1);
    expect(chunkCount(2_000_001, 2_000_000)).toBe(2);
  });

  it('round-trips a file just over one chunk, and each ciphertext stays under 2 MiB', async () => {
    const plain = crypto.getRandomValues(new Uint8Array(65_536));
    const big = new Uint8Array(2_000_001);
    for (let at = 0; at < big.length; at += plain.length) big.set(plain.subarray(0, Math.min(plain.length, big.length - at)), at);
    const { ciphertexts, hashes } = await encryptAttachment(big, key, nonce);
    expect(ciphertexts.map(c => c.length)).toEqual([2_000_016, 17]);
    expect(Math.max(...ciphertexts.map(c => c.length))).toBeLessThan(2 * 1024 * 1024);
    const back = await decryptAttachment({ key, nonce, size: big.length, chunkSize: 2_000_000, chunks: hashes }, ciphertexts);
    expect(back).toEqual(big);
  });
});
