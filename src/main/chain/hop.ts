/**
 * HOP receive (base spec "Message Attachments", "HOP Protocol", "HOP File
 * Loading"): a phone app's `RichText` attachment names a HOP node, a pool
 * entry (`identifier`) and a 32-byte `claimTicket`. This module derives the
 * ticket's keys, claims the root entry and the chunks it lists, checks and
 * decrypts them, and acks the entries once the caller has persisted the file.
 * Main process only; it never sends HOP.
 *
 * Two dialects are live (docs/reference/bulletin-and-media.md 5 and 6):
 * - cipher: the phone apps and pca seal every entry with ChaCha20-Poly1305;
 *   the spec (and t3ams standalone) with AES-256-GCM. Both are
 *   `nonce(12) ‖ ciphertext ‖ tag(16)` under the same ticket-derived key, so
 *   the root entry is opened with ChaCha20-Poly1305 first, then AES-256-GCM,
 *   and the chunks with the one that worked.
 * - root layout: the phone apps wrap the root in chat RFC 0001's
 *   `VersionedUploadedFile::V1(Inline(bytes) | Chunked { totalSize, chunks })`
 *   (a small file sits inline in the root); the spec and pca send the plain
 *   `UploadedFile { totalSize, chunks }`. The two parse to different lengths,
 *   so only one reads the whole root (`decodeRoot`).
 *
 * The ticket is key material: never log it or anything derived from it.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { getPublicKey, secretFromSeed, sign } from '@scure/sr25519';

import { HOP_MAX_FILE_BYTES, type HopAckResult, type HopCipher, type HopFetchResult, type HopLayout } from '../../shared/desktop-api';
import { NETWORK_PROFILES } from '../../shared/network';

/** The apps' 2,000,000-byte chunks plus the AEAD's 28 bytes and some slack. */
export const HOP_MAX_ENTRY_BYTES = 2_000_000 + 64;
/** One RPC answer: an entry as 0x-hex inside JSON. */
const MAX_FRAME_BYTES = 2 * HOP_MAX_ENTRY_BYTES + 4_096;
/** A root may not list more chunks than a 32 MiB file of 64 KiB chunks needs. */
const MAX_CHUNKS = Math.ceil(HOP_MAX_FILE_BYTES / (64 * 1024));
const HASH_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/**
 * One claim answers up to 2 MB as 4 MB of hex. bullet.sik.rocks sent a 1 MB
 * entry in 17 s (2026-09-24), so a full chunk takes over 30 s there (pca's
 * 30 s timeout fails on it too).
 */
export const HOP_RPC_TIMEOUT_MS = 120_000;
export const HOP_CONNECT_TIMEOUT_MS = 10_000;

/** Base spec "Errors". */
export const HOP_NOT_FOUND = 1004;
const HOP_REFUSED = new Set([1007, 1008]);

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const CLAIM_CONTEXT = utf8('hop-claim-v1:');
const ACK_CONTEXT = utf8('hop-ack-v1:');

const blake2b256 = (data: Uint8Array, key?: Uint8Array): Uint8Array => blake2b(data, { dkLen: 32, ...(key ? { key } : {}) });
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const toHex = (bytes: Uint8Array): string => `0x${Buffer.from(bytes).toString('hex')}`;
const fromHex = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new HopFailure('damaged', 'The node sent bytes that are not hex.');
  return Uint8Array.from(Buffer.from(clean, 'hex'));
};
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

type FailureReason = Extract<HopFetchResult, { ok: false }>['reason'];

/** A fetch that stopped; `reason` decides what the bubble says. */
export class HopFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
  }
}

// ── Keys (base spec "Ticket Key Derivation") ────────────────────────────────

export type TicketKeys = { secret: Uint8Array; publicKey: Uint8Array; encryptionKey: Uint8Array };

/** `seed = khash(ticket, "signer")` → sr25519 keypair; `key = khash(ticket, "encryption")`. */
export const ticketKeys = (ticket: Uint8Array): TicketKeys => {
  if (ticket.length !== HASH_BYTES) throw new HopFailure('damaged', 'The claim ticket is not 32 bytes.');
  const secret = secretFromSeed(blake2b256(utf8('signer'), ticket));
  return { secret, publicKey: getPublicKey(secret), encryptionKey: blake2b256(utf8('encryption'), ticket) };
};

/** `blake2b_256("hop-claim-v1:" ‖ hash)`: what a claim signs. */
export const claimPayload = (hash: Uint8Array): Uint8Array => blake2b256(concat(CLAIM_CONTEXT, hash));
/** `blake2b_256("hop-ack-v1:" ‖ hash)`: what an ack signs. */
export const ackPayload = (hash: Uint8Array): Uint8Array => blake2b256(concat(ACK_CONTEXT, hash));
/** SCALE `MultiSignature::Sr25519` (index 1) of `payload`. */
export const proof = (secret: Uint8Array, payload: Uint8Array): Uint8Array => concat(Uint8Array.of(1), sign(secret, payload));

// ── Entries ─────────────────────────────────────────────────────────────────

const CIPHERS: Record<HopCipher, (key: Uint8Array, nonce: Uint8Array) => { decrypt: (data: Uint8Array) => Uint8Array }> = {
  'chacha20-poly1305': chacha20poly1305,
  'aes-256-gcm': gcm,
};

/** Opens `nonce ‖ ciphertext ‖ tag` with `cipher`; null when the tag fails. */
const openWith = (cipher: HopCipher, key: Uint8Array, entry: Uint8Array): Uint8Array | null => {
  if (entry.length < NONCE_BYTES + TAG_BYTES) return null;
  try {
    return CIPHERS[cipher](key, entry.subarray(0, NONCE_BYTES)).decrypt(entry.subarray(NONCE_BYTES));
  } catch {
    return null;
  }
};

/** The phones' cipher first, then the spec's; which one opened the entry. */
export const openEntry = (key: Uint8Array, entry: Uint8Array): { plain: Uint8Array; cipher: HopCipher } => {
  for (const cipher of ['chacha20-poly1305', 'aes-256-gcm'] as const) {
    const plain = openWith(cipher, key, entry);
    if (plain) return { plain, cipher };
  }
  throw new HopFailure('damaged', 'The file does not open with its key.');
};

/** A SCALE compact length at `offset`, or null past the end. */
const compactAt = (bytes: Uint8Array, offset: number): { value: number; next: number } | null => {
  const first = bytes[offset];
  if (first === undefined) return null;
  switch (first & 3) {
    case 0:
      return { value: first >> 2, next: offset + 1 };
    case 1:
      return offset + 2 <= bytes.length ? { value: (first | ((bytes[offset + 1] as number) << 8)) >> 2, next: offset + 2 } : null;
    case 2:
      return offset + 4 <= bytes.length
        ? { value: (first | ((bytes[offset + 1] as number) << 8) | ((bytes[offset + 2] as number) << 16) | ((bytes[offset + 3] as number) << 24)) >>> 2, next: offset + 4 }
        : null;
    default:
      return null;
  }
};

/** `{ totalSize: u64, chunks: Vec<[u8]> }` from `offset` to the very end, 32-byte hashes only; null otherwise. */
const chunkedAt = (bytes: Uint8Array, offset: number): { totalSize: bigint; chunks: Uint8Array[] } | null => {
  if (offset + 8 > bytes.length) return null;
  let totalSize = 0n;
  for (let i = 7; i >= 0; i -= 1) totalSize = (totalSize << 8n) | BigInt(bytes[offset + i] as number);
  const count = compactAt(bytes, offset + 8);
  if (!count || count.value > MAX_CHUNKS) return null;
  const chunks: Uint8Array[] = [];
  let at = count.next;
  for (let i = 0; i < count.value; i += 1) {
    const length = compactAt(bytes, at);
    if (!length || length.value !== HASH_BYTES || length.next + HASH_BYTES > bytes.length) return null;
    chunks.push(bytes.slice(length.next, length.next + HASH_BYTES));
    at = length.next + HASH_BYTES;
  }
  return at === bytes.length ? { totalSize, chunks } : null;
};

export type HopRoot = { layout: HopLayout } & ({ inline: Uint8Array } | { totalSize: bigint; chunks: Uint8Array[] });

/** A chunk list can hold its size: no chunk decrypts to more than an entry holds. */
const holds = (root: { totalSize: bigint; chunks: Uint8Array[] }): boolean => root.totalSize <= BigInt(root.chunks.length * HOP_MAX_ENTRY_BYTES);

/**
 * The decrypted root entry: the phones' versioned envelope or the spec's
 * plain `UploadedFile`, whichever reads to the very end with a chunk list
 * that can hold its size. The byte layouts make both reading at once
 * impossible below 32 MiB; if it ever happens, the root is refused, not guessed.
 */
export const decodeRoot = (plain: Uint8Array): HopRoot => {
  const reads: HopRoot[] = [];
  if (plain[0] === 0 && plain[1] === 0) {
    const length = compactAt(plain, 2);
    if (length && length.next + length.value === plain.length) reads.push({ layout: 'versioned', inline: plain.slice(length.next) });
  }
  const versioned = plain[0] === 0 && plain[1] === 1 ? chunkedAt(plain, 2) : null;
  if (versioned && holds(versioned)) reads.push({ layout: 'versioned', ...versioned });
  const flat = chunkedAt(plain, 0);
  if (flat && holds(flat)) reads.push({ layout: 'plain', ...flat });
  const [chosen, other] = reads;
  if (!chosen || other) throw new HopFailure('damaged', 'The file list from the sender is not readable.');
  return chosen;
};

// ── Node ────────────────────────────────────────────────────────────────────

/** Every HOP host of the app's networks (the phones also take only allowlisted nodes). */
export const TRUSTED_HOP_HOSTS: readonly string[] = [...new Set(Object.values(NETWORK_PROFILES).flatMap(profile => profile.hopNodes.map(node => new URL(node).hostname)))];

/**
 * The message's `NodeEndpoint.wssUrl` as the URL to open. A peer chose it,
 * so: wss only, no credentials, and a host of this app's networks; opening
 * any other host would show the peer's server this computer's address.
 */
export const resolveHopNode = (node: string, trusted: readonly string[] = TRUSTED_HOP_HOSTS): string => {
  let url: URL;
  try {
    url = new URL(node);
  } catch {
    throw new HopFailure('untrusted', 'The message names no valid node.');
  }
  if (url.protocol !== 'wss:' || url.username || url.password) throw new HopFailure('untrusted', 'The message names a node without a secure connection.');
  if (!trusted.includes(url.hostname.toLowerCase())) throw new HopFailure('untrusted', `The sender's node ${url.hostname} is not one this app trusts.`);
  return url.toString();
};

// ── JSON-RPC ────────────────────────────────────────────────────────────────

export type HopRpc = { call: (method: string, params: unknown[]) => Promise<unknown>; close: () => void };
type RpcError = Error & { code?: number };

/** One WebSocket to `url` with positional JSON-RPC 2.0 calls (what the spec and the phones send). */
export const openHopRpc = (url: string, { connectTimeoutMs = HOP_CONNECT_TIMEOUT_MS, rpcTimeoutMs = HOP_RPC_TIMEOUT_MS } = {}): Promise<HopRpc> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let nextId = 1;
    const failAll = (message: string) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(message));
      }
      pending.clear();
    };
    const opening = setTimeout(() => {
      socket.close();
      reject(new HopFailure('network', "The sender's node did not answer."));
    }, connectTimeoutMs);
    socket.addEventListener('error', () => {
      clearTimeout(opening);
      failAll('The connection to the node failed.');
      reject(new HopFailure('network', "The sender's node could not be reached."));
    });
    socket.addEventListener('close', () => failAll('The connection to the node closed.'));
    socket.addEventListener('message', event => {
      const data: unknown = event.data;
      const size = typeof data === 'string' ? data.length : data instanceof ArrayBuffer ? data.byteLength : Infinity;
      if (size > MAX_FRAME_BYTES) {
        failAll('The node sent too much.');
        socket.close();
        return;
      }
      let message: { id?: number; result?: unknown; error?: { code?: number; message?: string } };
      try {
        message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8'));
      } catch {
        return;
      }
      const entry = message.id === undefined ? undefined : pending.get(message.id);
      if (!entry || message.id === undefined) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error(String(message.error.message ?? 'error').slice(0, 200)), { code: message.error.code }));
      else entry.resolve(message.result);
    });
    socket.addEventListener('open', () => {
      clearTimeout(opening);
      resolve({
        call: (method, params) =>
          new Promise((done, fail) => {
            const id = nextId++;
            const timer = setTimeout(() => {
              pending.delete(id);
              fail(new Error(`${method} timed out`));
            }, rpcTimeoutMs);
            pending.set(id, { resolve: done, reject: fail, timer });
            socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
          }),
        close: () => socket.close(),
      });
    });
  });

// ── Fetch and ack (base spec "Download Flow") ───────────────────────────────

export type HopFetched = { bytes: Uint8Array; entries: Uint8Array[]; cipher: HopCipher; layout: HopLayout };

const failureOf = (error: unknown): HopFailure => {
  if (error instanceof HopFailure) return error;
  const code = (error as RpcError | undefined)?.code;
  if (code === HOP_NOT_FOUND) return new HopFailure('notFound', "No longer available from the sender's node.");
  if (code !== undefined && HOP_REFUSED.has(code)) return new HopFailure('refused', "The sender's node refused this download.");
  return new HopFailure('network', error instanceof Error ? error.message : String(error));
};

/**
 * Claims the root entry `identifier` and every chunk it lists, checks each
 * entry's blake2b-256 against its hash before decrypting, and returns the
 * file with the entries to ack. Claims are read-only: nothing is acked here.
 */
export async function fetchHopFile({
  rpc,
  identifier,
  ticket,
  maxBytes = HOP_MAX_FILE_BYTES,
  onProgress = () => undefined,
}: {
  rpc: HopRpc;
  identifier: Uint8Array;
  ticket: Uint8Array;
  maxBytes?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<HopFetched> {
  if (identifier.length !== HASH_BYTES) throw new HopFailure('damaged', 'The file id is not 32 bytes.');
  const keys = ticketKeys(ticket);
  const claim = async (hash: Uint8Array): Promise<Uint8Array> => {
    let result: unknown;
    try {
      result = await rpc.call('hop_claim', [toHex(hash), toHex(proof(keys.secret, claimPayload(hash)))]);
    } catch (error) {
      throw failureOf(error);
    }
    if (typeof result !== 'string') throw new HopFailure('damaged', 'The node sent no file.');
    const entry = fromHex(result);
    if (entry.length > HOP_MAX_ENTRY_BYTES) throw new HopFailure('damaged', 'The node sent a part that is too large.');
    if (!equal(blake2b256(entry), hash)) throw new HopFailure('damaged', 'A part of the file does not match its hash.');
    return entry;
  };

  const opened = openEntry(keys.encryptionKey, await claim(identifier));
  const root = decodeRoot(opened.plain);
  if ('inline' in root) {
    if (root.inline.length > maxBytes) throw new HopFailure('tooLarge', `The file is larger than ${maxBytes / (1024 * 1024)} MB.`);
    onProgress(1, 1);
    return { bytes: root.inline, entries: [identifier], cipher: opened.cipher, layout: root.layout };
  }
  if (root.totalSize > BigInt(maxBytes)) throw new HopFailure('tooLarge', `The file is larger than ${maxBytes / (1024 * 1024)} MB.`);
  const total = Number(root.totalSize);
  const out = new Uint8Array(total);
  let offset = 0;
  onProgress(0, root.chunks.length);
  for (const [index, hash] of root.chunks.entries()) {
    const plain = openWith(opened.cipher, keys.encryptionKey, await claim(hash));
    if (!plain) throw new HopFailure('damaged', 'A part of the file does not open with its key.');
    if (offset + plain.length > total) throw new HopFailure('damaged', 'The file is longer than the sender said.');
    out.set(plain, offset);
    offset += plain.length;
    onProgress(index + 1, root.chunks.length);
  }
  if (offset !== total) throw new HopFailure('damaged', 'The file is shorter than the sender said.');
  return { bytes: out, entries: [identifier, ...root.chunks], cipher: opened.cipher, layout: root.layout };
}

/**
 * Acks each entry. Call only after the file is persisted: the ticket key is
 * the sole recipient, so an ack removes the entry for good. `NotFound` is a
 * benign end (acked already, or expired); other failures are counted, never thrown.
 */
export async function ackHopEntries({ rpc, ticket, entries }: { rpc: HopRpc; ticket: Uint8Array; entries: readonly Uint8Array[] }): Promise<HopAckResult> {
  const keys = ticketKeys(ticket);
  const result: HopAckResult = { acked: 0, notFound: 0, failed: 0 };
  for (const hash of entries) {
    try {
      await rpc.call('hop_ack', [toHex(hash), toHex(proof(keys.secret, ackPayload(hash)))]);
      result.acked += 1;
    } catch (error) {
      if ((error as RpcError).code === HOP_NOT_FOUND) result.notFound += 1;
      else result.failed += 1;
    }
  }
  return result;
}

/** The IPC form of a fetch: one connection to the message's node, a result instead of a throw. */
export async function hopFetch(
  node: string,
  identifier: Uint8Array,
  ticket: Uint8Array,
  onProgress: (done: number, total: number) => void,
  open: (url: string) => Promise<HopRpc> = url => openHopRpc(url),
): Promise<HopFetchResult> {
  let rpc: HopRpc | null = null;
  try {
    const url = resolveHopNode(node);
    rpc = await open(url);
    const fetched = await fetchHopFile({ rpc, identifier, ticket, onProgress });
    return { ok: true, bytes: fetched.bytes, entries: fetched.entries.map(toHex), cipher: fetched.cipher, layout: fetched.layout };
  } catch (error) {
    const failure = failureOf(error);
    return { ok: false, reason: failure.reason, message: failure.message };
  } finally {
    rpc?.close();
  }
}

/** The IPC form of an ack: its own connection (the fetch's closed when it returned). */
export async function hopAck(node: string, ticket: Uint8Array, entries: readonly string[], open: (url: string) => Promise<HopRpc> = url => openHopRpc(url)): Promise<HopAckResult> {
  const rpc = await open(resolveHopNode(node));
  try {
    return await ackHopEntries({ rpc, ticket, entries: entries.map(fromHex) });
  } finally {
    rpc.close();
  }
}
