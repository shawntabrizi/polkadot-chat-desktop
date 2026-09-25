import crypto from 'node:crypto';

import { blake2b } from '@noble/hashes/blake2.js';
import { getPublicKey, secretFromSeed, sign, verify } from '@scure/sr25519';
import { describe, expect, it } from 'vitest';

import {
  HOP_NOT_FOUND,
  type HopRpc,
  ackHopEntries,
  ackPayload,
  chunkedRoot,
  claimPayload,
  decodeRoot,
  fetchHopFile,
  hopAck,
  hopFetch,
  hopSend,
  inlineRoot,
  openEntry,
  resolveHopNode,
  submitHopFile,
  submitPayload,
  ticketKeys,
} from './hop';
import { cidOf } from './bulletin';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text.replace(/^0x/, ''), 'hex'));
const b2 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 32 });
const equal = (a: Uint8Array, b: Uint8Array): boolean => hex(a) === hex(b);

/** The fixed ticket of every vector: bytes 0..31. */
const TICKET = Uint8Array.from({ length: 32 }, (_v, i) => i);

// Vectors made outside this code: the keyed BLAKE2b values and payloads with
// Python's hashlib, the public key with `subkey inspect --scheme sr25519`
// (schnorrkel, what the HOP node verifies with), the ciphertexts with
// OpenSSL through node:crypto (2026-09-24).
const VECTORS = {
  signerSeed: 'b700eba5c9ac529b2ecd32d2c9583976f728a6b12177a305feaebad9362f7b98',
  publicKey: 'ec1b28f10d79f482bcab7b54be1da5631bd610cae55cf4b636a8b4032fa88473',
  encryptionKey: '780d195b37b816da293d2296d160a8e0afcb428f8054fa22c01d3960e14c82f1',
  claimOfAb: 'ff41f63e275d0119a947a8719754cac1250365ceb4db45348faa48aefb27daac',
  ackOfAb: '940aceeb4edf2e202f5683933aef7f9c249de5d49ba51782323b7cc0e8964298',
  // The phones: ChaCha20-Poly1305, root `V1(Inline("hello from the phone"))`.
  phoneRoot:
    '000102030405060708090a0be96b49c77622480ab9fbec49352f177e35d0438c600196b1bbee98a87e5d9fe7d96afc0292a3c7',
  phoneId: '749ecb663fe485a31050eb6944d751c3b4a44cf198ec9ae166f17c639be8916b',
  // The spec: AES-256-GCM, plain root `UploadedFile { 10, [chunk] }`, chunk "spec chunk".
  specRoot:
    '18191a1b1c1d1e1f20212223576563b67f40bd169c1573b19f425c0727200f80e78b20e6181af77eca94f68205540aa9aaf3716bbe01759c0d30948e62aeb6336c3316ee1308',
  specId: '11055b87d60e97565567cba7da02902e42bc13506115a865972185558835649c',
  specChunk: '0c0d0e0f10111213141516177365ea1a63502cfca277c0e003c909f78d3c5656cf68bcdc2a2b',
  specChunkHash: '16dbc3e95185de25374f30fe33cd95527e5b40813ace066129cdda1f52602523',
};

type Pool = HopRpc & { entries: Map<string, Uint8Array>; chain: Map<string, Uint8Array>; calls: { method: string; params: unknown[] }[]; acked: string[] };

/**
 * A HOP pool as the node behaves (substrate/client/hop): positional params,
 * `NotFound` (1004) for a missing entry, a claim or ack only with an sr25519
 * signature of the right payload by the entry's recipient, and an ack removes
 * the entry (the ticket key is the sole recipient). RFC-0001: the same node
 * serves promoted entries (`chain`, keyed by CID) over `bitswap_v1_get`,
 * `NotFound` -32810 otherwise, with no signature and no integrity check.
 */
const pool = (entries: Record<string, Uint8Array>, recipient: Uint8Array = ticketKeys(TICKET).publicKey): Pool => {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.replace(/^0x/, ''), value]));
  const chain = new Map<string, Uint8Array>();
  const calls: Pool['calls'] = [];
  const acked: string[] = [];
  const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
  return {
    entries: map,
    chain,
    calls,
    acked,
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === 'bitswap_v1_get') {
        const found = chain.get(params[0] as string);
        if (!found) throw fail(-32810, 'Not found');
        return `0x${hex(found)}`;
      }
      const [hash, signature] = params as [string, string];
      const entry = map.get(hash.replace(/^0x/, ''));
      if (!entry) throw fail(HOP_NOT_FOUND, 'Data not found');
      const proofBytes = bytes(signature);
      const payload = method === 'hop_claim' ? claimPayload(bytes(hash)) : ackPayload(bytes(hash));
      if (proofBytes[0] !== 1 || proofBytes.length !== 65 || !verify(payload, proofBytes.subarray(1), recipient)) throw fail(1007, 'Invalid signature');
      if (method === 'hop_claim') return `0x${hex(entry)}`;
      map.delete(hash.replace(/^0x/, ''));
      acked.push(hash);
      return null;
    },
    close: () => undefined,
  };
};

const encryptionKey = bytes(VECTORS.encryptionKey);
const seal = (algorithm: 'chacha20-poly1305' | 'aes-256-gcm', plain: Uint8Array): Uint8Array => {
  const nonce = crypto.randomBytes(12);
  const cipher = algorithm === 'aes-256-gcm' ? crypto.createCipheriv(algorithm, encryptionKey, nonce) : crypto.createCipheriv(algorithm, encryptionKey, nonce, { authTagLength: 16 });
  return new Uint8Array(Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
};
const u64 = (value: number): Uint8Array => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
};
/** pca's `encodeUploadedFile` (and the spec's): `u64 totalSize ‖ compact(n) ‖ (compact(32) ‖ hash)*` for n < 64. */
const plainRoot = (size: number, hashes: Uint8Array[]): Uint8Array => Buffer.concat([u64(size), Buffer.from([hashes.length << 2]), ...hashes.map(h => Buffer.concat([Buffer.from([32 << 2]), h]))]);
/** A file as a sender puts it in the pool: chunks sealed with `algorithm`, then the root. */
const upload = (file: Uint8Array, chunkSize: number, algorithm: 'chacha20-poly1305' | 'aes-256-gcm', versioned: boolean) => {
  const entries: Record<string, Uint8Array> = {};
  const hashes: Uint8Array[] = [];
  for (let at = 0; at < file.length; at += chunkSize) {
    const entry = seal(algorithm, file.subarray(at, at + chunkSize));
    entries[hex(b2(entry))] = entry;
    hashes.push(b2(entry));
  }
  const root = plainRoot(file.length, hashes);
  const rootEntry = seal(algorithm, versioned ? Buffer.concat([Buffer.from([0, 1]), root]) : root);
  entries[hex(b2(rootEntry))] = rootEntry;
  return { entries, identifier: b2(rootEntry), hashes };
};

describe('ticket keys (base spec "Ticket Key Derivation")', () => {
  it('derives the sr25519 recipient and the AEAD key from the ticket as the phones and the node do', () => {
    const keys = ticketKeys(TICKET);
    // The recipient a sender lists in hop_submit: a wrong key here and every claim is NotRecipient.
    expect(hex(keys.publicKey)).toBe(VECTORS.publicKey);
    expect(hex(keys.encryptionKey)).toBe(VECTORS.encryptionKey);
    expect(hex(blake2b(new TextEncoder().encode('signer'), { dkLen: 32, key: TICKET }))).toBe(VECTORS.signerSeed);
  });

  it('refuses a ticket that is not 32 bytes', () => {
    expect(() => ticketKeys(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('claim and ack signatures', () => {
  it('sign blake2b_256("hop-claim-v1:" ‖ hash) and blake2b_256("hop-ack-v1:" ‖ hash), domain-separated', () => {
    const hash = new Uint8Array(32).fill(0xab);
    expect(hex(claimPayload(hash))).toBe(VECTORS.claimOfAb);
    expect(hex(ackPayload(hash))).toBe(VECTORS.ackOfAb);
    // A claim proof is useless as an ack: the node would reject a replay.
    expect(hex(claimPayload(hash))).not.toBe(hex(ackPayload(hash)));
  });

  it('claims with positional [hash, MultiSignature::Sr25519] that the node verifies against the ticket key', async () => {
    const rpc = pool({ [VECTORS.phoneId]: bytes(VECTORS.phoneRoot) });
    await fetchHopFile({ rpc, identifier: bytes(VECTORS.phoneId), ticket: TICKET });
    const [first] = rpc.calls;
    expect(first?.method).toBe('hop_claim');
    expect(first?.params[0]).toBe(`0x${VECTORS.phoneId}`);
    const signature = bytes(first?.params[1] as string);
    expect(signature[0]).toBe(1);
    expect(verify(claimPayload(bytes(VECTORS.phoneId)), signature.subarray(1), bytes(VECTORS.publicKey))).toBe(true);
  });

  it('a pool that lists another recipient refuses the claim', async () => {
    const rpc = pool({ [VECTORS.phoneId]: bytes(VECTORS.phoneRoot) }, ticketKeys(new Uint8Array(32).fill(1)).publicKey);
    const result = await hopFetch('wss://bullet.sik.rocks', bytes(VECTORS.phoneId), TICKET, () => undefined, async () => rpc);
    expect(result).toMatchObject({ ok: false, reason: 'refused' });
  });
});

describe('both dialects', () => {
  it('opens the phones\' vector: ChaCha20-Poly1305 and the versioned root with the file inline', async () => {
    const rpc = pool({ [VECTORS.phoneId]: bytes(VECTORS.phoneRoot) });
    const fetched = await fetchHopFile({ rpc, identifier: bytes(VECTORS.phoneId), ticket: TICKET });
    expect(new TextDecoder().decode(fetched.bytes)).toBe('hello from the phone');
    expect(fetched).toMatchObject({ cipher: 'chacha20-poly1305', layout: 'versioned' });
    expect(fetched.entries.map(hex)).toEqual([VECTORS.phoneId]);
    // Claims are read-only: nothing acked yet.
    expect(rpc.calls.every(call => call.method === 'hop_claim')).toBe(true);
  });

  it('opens the spec\'s vector: AES-256-GCM and the plain UploadedFile root', async () => {
    const rpc = pool({ [VECTORS.specId]: bytes(VECTORS.specRoot), [VECTORS.specChunkHash]: bytes(VECTORS.specChunk) });
    const fetched = await fetchHopFile({ rpc, identifier: bytes(VECTORS.specId), ticket: TICKET });
    expect(new TextDecoder().decode(fetched.bytes)).toBe('spec chunk');
    expect(fetched).toMatchObject({ cipher: 'aes-256-gcm', layout: 'plain' });
    expect(fetched.entries.map(hex)).toEqual([VECTORS.specId, VECTORS.specChunkHash]);
  });

  it('reads what pca sends (ChaCha20-Poly1305, plain root) and a phone\'s chunked file, in order', async () => {
    const file = crypto.randomBytes(300_001);
    for (const [algorithm, versioned] of [
      ['chacha20-poly1305', false],
      ['chacha20-poly1305', true],
      ['aes-256-gcm', true],
    ] as const) {
      const sent = upload(file, 100_000, algorithm, versioned);
      const progress: string[] = [];
      const fetched = await fetchHopFile({ rpc: pool(sent.entries), identifier: sent.identifier, ticket: TICKET, onProgress: (done, total) => progress.push(`${done}/${total}`) });
      expect(Buffer.from(fetched.bytes).equals(file)).toBe(true);
      expect(fetched.cipher).toBe(algorithm);
      expect(fetched.layout).toBe(versioned ? 'versioned' : 'plain');
      expect(fetched.entries.map(hex)).toEqual([hex(sent.identifier), ...sent.hashes.map(hex)]);
      expect(progress).toEqual(['0/4', '1/4', '2/4', '3/4', '4/4']);
    }
  });

  it('matches the iOS envelope vectors (RFC 0001): inline and chunked', () => {
    expect(decodeRoot(Uint8Array.from([0x00, 0x00, 0x08, 0xde, 0xad]))).toEqual({ layout: 'versioned', inline: Uint8Array.from([0xde, 0xad]) });
    const legacy = new Uint8Array(plainRoot(300, [new Uint8Array(32).fill(0xab)]));
    expect(decodeRoot(Uint8Array.from([0x00, 0x01, ...legacy]))).toEqual({ layout: 'versioned', totalSize: 300n, chunks: [new Uint8Array(32).fill(0xab)] });
    expect(decodeRoot(legacy)).toEqual({ layout: 'plain', totalSize: 300n, chunks: [new Uint8Array(32).fill(0xab)] });
  });

  it('refuses a root that reads neither way', () => {
    expect(() => decodeRoot(Uint8Array.from([0x07, 0x07]))).toThrow(/not readable/);
    // A plain root listing one chunk for 10 MB cannot be: a chunk holds at most ~2 MB.
    expect(() => decodeRoot(plainRoot(10_000_000, [new Uint8Array(32)]))).toThrow(/not readable/);
  });

  it('fails as damaged when neither cipher opens the entry', () => {
    expect(() => openEntry(new Uint8Array(32).fill(3), bytes(VECTORS.phoneRoot))).toThrow(/does not open/);
  });
});

describe('what goes wrong', () => {
  it('NotFound without a chain source is its own outcome, not a network error', async () => {
    await expect(fetchHopFile({ rpc: pool({}), identifier: bytes(VECTORS.phoneId), ticket: TICKET })).rejects.toMatchObject({ reason: 'notFound', message: "No longer available from the sender's node." });
  });

  it('NotFound with nothing in chain storage yet is `chainPending` (retry later), not final and not a network error', async () => {
    const result = await hopFetch('wss://bullet.sik.rocks', bytes(VECTORS.phoneId), TICKET, () => undefined, async () => pool({}));
    expect(result).toMatchObject({ ok: false, reason: 'chainPending' });
  });

  it('a chunk that disappears between claims (a race with another ack) and is on no chain is `chainPending` too', async () => {
    const sent = upload(crypto.randomBytes(250_000), 100_000, 'chacha20-poly1305', true);
    const rpc = pool(sent.entries);
    rpc.entries.delete(hex(sent.hashes[1] as Uint8Array));
    const result = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc);
    expect(result).toMatchObject({ ok: false, reason: 'chainPending' });
  });

  it('an entry whose bytes do not hash to its id is damaged before any decryption', async () => {
    const tampered = bytes(VECTORS.phoneRoot);
    tampered[20] = (tampered[20] as number) ^ 1;
    const result = await hopFetch('wss://bullet.sik.rocks', bytes(VECTORS.phoneId), TICKET, () => undefined, async () => pool({ [VECTORS.phoneId]: tampered }));
    expect(result).toMatchObject({ ok: false, reason: 'damaged' });
  });

  it('a root over 32 MiB is refused before a single chunk is claimed', async () => {
    const rootEntry = seal('chacha20-poly1305', plainRoot(33 * 1024 * 1024, Array.from({ length: 18 }, (_v, i) => new Uint8Array(32).fill(i))));
    const rpc = pool({ [hex(b2(rootEntry))]: rootEntry });
    const result = await hopFetch('wss://bullet.sik.rocks', b2(rootEntry), TICKET, () => undefined, async () => rpc);
    expect(result).toMatchObject({ ok: false, reason: 'tooLarge' });
    expect(rpc.calls).toHaveLength(1);
  });

  it('a file longer than its root says is damaged', async () => {
    const sent = upload(crypto.randomBytes(200_000), 100_000, 'chacha20-poly1305', false);
    // Re-point the root at a size one byte short.
    const rootEntry = seal('chacha20-poly1305', plainRoot(199_999, sent.hashes));
    const rpc = pool({ ...sent.entries, [hex(b2(rootEntry))]: rootEntry });
    const result = await hopFetch('wss://bullet.sik.rocks', b2(rootEntry), TICKET, () => undefined, async () => rpc);
    expect(result).toMatchObject({ ok: false, reason: 'damaged' });
  });
});

describe('ack', () => {
  it('acks every entry with an ack proof; NotFound is a benign end, not a failure', async () => {
    const sent = upload(crypto.randomBytes(150_000), 100_000, 'chacha20-poly1305', true);
    const rpc = pool(sent.entries);
    const fetched = await fetchHopFile({ rpc, identifier: sent.identifier, ticket: TICKET });
    rpc.entries.delete(hex(sent.hashes[0] as Uint8Array)); // acked by another device meanwhile
    const result = await ackHopEntries({ rpc, ticket: TICKET, entries: fetched.entries });
    expect(result).toEqual({ acked: 2, notFound: 1, failed: 0 });
    expect(rpc.entries.size).toBe(0);
  });

  it('hopAck opens the same node and never throws for an entry already gone', async () => {
    const rpc = pool({});
    await expect(hopAck('wss://bullet.sik.rocks', TICKET, [`0x${VECTORS.phoneId}`], async () => rpc)).resolves.toEqual({ acked: 0, notFound: 1, failed: 0 });
  });
});

/**
 * RFC-0001 "On-chain fallback". Why these tests exist: an entry the pool
 * lost may sit in chain storage under the same hash, so NotFound must not
 * end the download; the bitswap path has no integrity check of its own, so
 * the client's hash check is the only thing between a node and the
 * decryption; and an ack of a chain-read entry is meaningless at best, so
 * only pool entries go back to the caller to ack.
 */
describe('chain fallback (RFC-0001)', () => {
  const promote = (rpc: Pool, hash: Uint8Array) => {
    const entry = rpc.entries.get(hex(hash)) as Uint8Array;
    rpc.chain.set(cidOf(hash), entry);
    rpc.entries.delete(hex(hash));
  };

  it('a file gone from the pool arrives from chain storage, claim first for every entry, and nothing is offered for an ack', async () => {
    const file = crypto.randomBytes(250_000);
    const sent = upload(file, 100_000, 'chacha20-poly1305', true);
    const rpc = pool(sent.entries);
    for (const hash of [sent.identifier, ...sent.hashes]) promote(rpc, hash);
    const result = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc);
    expect(result.ok && Buffer.from(result.bytes).equals(file)).toBe(true);
    expect(result).toMatchObject({ ok: true, entries: [], fromChain: 4 });
    // Every entry: hop_claim, then bitswap_v1_get on its CID; never an ack.
    expect(rpc.calls.map(call => call.method)).toEqual(Array.from({ length: 4 }, () => ['hop_claim', 'bitswap_v1_get']).flat());
    expect(rpc.calls.filter(call => call.method === 'bitswap_v1_get').map(call => call.params[0])).toEqual([sent.identifier, ...sent.hashes].map(cidOf));
  });

  it('mixes sources per entry: only the pool\'s entries are returned to ack', async () => {
    const sent = upload(crypto.randomBytes(250_000), 100_000, 'chacha20-poly1305', false);
    const rpc = pool(sent.entries);
    promote(rpc, sent.hashes[1] as Uint8Array);
    const result = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc);
    expect(result).toMatchObject({ ok: true, fromChain: 1, entries: [sent.identifier, sent.hashes[0], sent.hashes[2]].map(hash => `0x${hex(hash as Uint8Array)}`) });
  });

  it('bytes that do not hash to the entry are dropped, the next source is asked, and none opens without a match', async () => {
    const file = crypto.randomBytes(1_000);
    const sent = upload(file, 100_000, 'chacha20-poly1305', true);
    const rpc = pool(sent.entries);
    const good = { root: rpc.entries.get(hex(sent.identifier)) as Uint8Array, chunk: rpc.entries.get(hex(sent.hashes[0] as Uint8Array)) as Uint8Array };
    rpc.entries.clear();
    // The node's bitswap answers with other bytes (a lagging or lying node): never decrypted.
    const wrong = seal('chacha20-poly1305', new Uint8Array(40));
    rpc.chain.set(cidOf(sent.identifier), wrong);
    rpc.chain.set(cidOf(sent.hashes[0] as Uint8Array), wrong);
    const asked: string[] = [];
    const bulletin = async (hash: Uint8Array) => {
      asked.push(hex(hash));
      return equal(hash, sent.identifier) ? good.root : good.chunk;
    };
    const result = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc, [bulletin]);
    expect(result.ok && Buffer.from(result.bytes).equals(file)).toBe(true);
    expect(asked).toEqual([hex(sent.identifier), hex(sent.hashes[0] as Uint8Array)]);

    // Every source wrong: not damaged (a node may lag), a retry later.
    const again = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc, [async () => wrong]);
    expect(again).toMatchObject({ ok: false, reason: 'chainPending' });
  });

  it('a chunk over 512 KB asks the Bulletin source gateway-first, the root never', async () => {
    const sent = upload(crypto.randomBytes(1_200_000), 600_000, 'chacha20-poly1305', true);
    const rpc = pool(sent.entries);
    const store = new Map([sent.identifier, ...sent.hashes].map(hash => [hex(hash), rpc.entries.get(hex(hash)) as Uint8Array]));
    rpc.entries.clear();
    const large: boolean[] = [];
    const result = await hopFetch('wss://bullet.sik.rocks', sent.identifier, TICKET, () => undefined, async () => rpc, [
      async (hash, isLarge) => {
        large.push(isLarge);
        return store.get(hex(hash)) as Uint8Array;
      },
    ]);
    expect(result).toMatchObject({ ok: true, fromChain: 3 });
    expect(large).toEqual([false, true, true]);
  });
});

describe('the node a message names', () => {
  it('opens only wss hosts of this app\'s networks', () => {
    expect(resolveHopNode('wss://bullet.sik.rocks')).toBe('wss://bullet.sik.rocks/');
    expect(resolveHopNode('wss://paseo-hop-next-1.polkadot.io')).toBe('wss://paseo-hop-next-1.polkadot.io/');
    // A peer's own server would learn this computer's address.
    expect(() => resolveHopNode('wss://evil.example')).toThrow(/not one this app trusts/);
    expect(() => resolveHopNode('ws://bullet.sik.rocks')).toThrow(/secure/);
    expect(() => resolveHopNode('wss://user:pw@bullet.sik.rocks')).toThrow(/secure/);
  });

  it('an untrusted node is an outcome, and nothing is opened', async () => {
    let opened = false;
    const result = await hopFetch('wss://evil.example', bytes(VECTORS.phoneId), TICKET, () => undefined, async () => {
      opened = true;
      return pool({});
    });
    expect(result).toMatchObject({ ok: false, reason: 'untrusted' });
    expect(opened).toBe(false);
  });
});

describe('HOP send (M20b: the phones\' dialect)', () => {
  const signerSecret = secretFromSeed(new Uint8Array(32).fill(7));
  const signer = { publicKey: getPublicKey(signerSecret), sign: (message: Uint8Array) => sign(signerSecret, message) };

  /**
   * A pool that takes `hop_submit` as the node does: positional [data,
   * recipients, signature, signer, submitTimestamp], the signature checked
   * over the submit payload against the signer; claims then go to `pool`.
   */
  const submitPool = () => {
    const stored: Record<string, Uint8Array> = {};
    const submits: { recipients: string[]; signer: string; timestamp: number; size: number }[] = [];
    const rpc: HopRpc = {
      call: async (method, params) => {
        if (method !== 'hop_submit') throw new Error(`unexpected ${method}`);
        const [data, recipients, signature, signerHex, timestamp] = params as [string, string[], string, string, number];
        const entry = bytes(data);
        const proofBytes = bytes(signature);
        const signerBytes = bytes(signerHex);
        if (signerBytes[0] !== 1 || proofBytes[0] !== 1 || !verify(submitPayload(entry, timestamp), proofBytes.subarray(1), signerBytes.subarray(1))) {
          throw Object.assign(new Error('Invalid signature'), { code: 1007 });
        }
        stored[hex(b2(entry))] = entry;
        submits.push({ recipients, signer: signerHex, timestamp, size: entry.length });
        return { poolStatus: { entryCount: 1, totalBytes: entry.length, maxBytes: 1 } };
      },
      close: () => undefined,
    };
    return { rpc, stored, submits };
  };
  /** Opens a pool entry with node:crypto (OpenSSL), as pca's legacy dialect does: not this module's own decrypt. */
  const openWithOpenSsl = (key: Uint8Array, entry: Uint8Array): Uint8Array => {
    const decipher = crypto.createDecipheriv('chacha20-poly1305', key, entry.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(entry.subarray(entry.length - 16));
    return new Uint8Array(Buffer.concat([decipher.update(entry.subarray(12, entry.length - 16)), decipher.final()]));
  };

  it('a small file sits inline in a versioned root, one entry, the ticket key the only recipient, signed by our key', async () => {
    const { rpc, stored, submits } = submitPool();
    const file = new TextEncoder().encode('a photo from the desktop');
    const sent = await submitHopFile({ rpc, bytes: file, signer, ticket: TICKET, now: () => 1_720_000_000_000 });
    expect(sent.entries).toBe(1);
    expect(submits).toHaveLength(1);
    // Base spec: recipients are MultiSigner::Sr25519 of the ticket key; every device of the peer gets the same ticket.
    expect(submits[0]?.recipients).toEqual([`0x01${VECTORS.publicKey}`]);
    expect(submits[0]?.signer).toBe(`0x01${hex(signer.publicKey)}`);
    const root = openWithOpenSsl(encryptionKey, stored[hex(sent.identifier)] as Uint8Array);
    // RFC 0001 `V1(Inline(bytes))`, as the phones write it (iOS vector: 00 00 compact(len) bytes).
    expect(hex(root.subarray(0, 3))).toBe(`0000${(file.length << 2).toString(16).padStart(2, '0')}`);
    expect(decodeRoot(root)).toEqual({ layout: 'versioned', inline: file });
    // And this client's receive path reads it back through a pool that checks every claim.
    const fetched = await fetchHopFile({ rpc: pool(stored), identifier: sent.identifier, ticket: TICKET });
    expect(fetched).toMatchObject({ bytes: file, cipher: 'chacha20-poly1305', layout: 'versioned' });
  });

  it('a large file goes in 2,000,000-byte ChaCha20-Poly1305 chunks and a chunked versioned root', async () => {
    const { rpc, stored, submits } = submitPool();
    const file = Uint8Array.from({ length: 4_100_000 }, (_v, i) => (i * 7) & 0xff);
    const sent = await submitHopFile({ rpc, bytes: file, signer, ticket: TICKET });
    expect(sent.entries).toBe(4);
    expect(submits.map(entry => entry.size)).toEqual([2_000_028, 2_000_028, 100_028, 2 + 8 + 1 + 3 * 33 + 28]);
    const root = decodeRoot(openWithOpenSsl(encryptionKey, stored[hex(sent.identifier)] as Uint8Array));
    expect(root).toMatchObject({ layout: 'versioned', totalSize: 4_100_000n });
    const first = 'chunks' in root ? root.chunks[0] : undefined;
    // A chunk is sealed bare (no envelope), as Android's `uploadChunks` sends it.
    expect(openWithOpenSsl(encryptionKey, stored[hex(first as Uint8Array)] as Uint8Array)).toEqual(file.subarray(0, 2_000_000));
    const fetched = await fetchHopFile({ rpc: pool(stored), identifier: sent.identifier, ticket: TICKET });
    expect(fetched.bytes).toEqual(file);
    expect(fetched.entries).toHaveLength(4);
    // 8 MB of hex and AEAD in pure JS: slower than the default 5 s on a busy machine.
  }, 30_000);

  it('builds the iOS envelope vectors byte for byte', () => {
    expect([...inlineRoot(Uint8Array.from([0xde, 0xad]))]).toEqual([0x00, 0x00, 0x08, 0xde, 0xad]);
    const chunked = chunkedRoot(300, [new Uint8Array(32).fill(0xab)]);
    expect(decodeRoot(chunked)).toEqual({ layout: 'versioned', totalSize: 300n, chunks: [new Uint8Array(32).fill(0xab)] });
  });

  it('tries the next node when one cannot be reached; a refusal is final and in words', async () => {
    const { rpc } = submitPool();
    const opened: string[] = [];
    const result = await hopSend(['wss://bullet.sik.rocks', 'wss://bullet.tunastaking.eu'], new Uint8Array([1, 2, 3]), signer, async url => {
      opened.push(url);
      if (url.includes('sik')) throw new Error('connect failed');
      return rpc;
    });
    expect(result).toMatchObject({ ok: true, node: 'wss://bullet.tunastaking.eu', entries: 1 });
    expect(opened).toHaveLength(2);
    const refusing: HopRpc = { call: async () => Promise.reject(Object.assign(new Error('NotAuthorized'), { code: 1012 })), close: () => undefined };
    const tried: string[] = [];
    const refused = await hopSend(['wss://bullet.sik.rocks', 'wss://bullet.tunastaking.eu'], new Uint8Array([1]), signer, async url => {
      tried.push(url);
      return refusing;
    });
    expect(refused).toEqual({ ok: false, reason: 'refused', message: 'This account has no Bulletin storage authorization, which a HOP node asks for.' });
    expect(tried).toHaveLength(1);
  });
});
