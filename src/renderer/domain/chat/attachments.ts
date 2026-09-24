/**
 * Spec 0012 (M15a): sending and fetching attachments. The renderer encrypts,
 * checks and decrypts (attachmentCrypto.ts); the main process stores and
 * fetches chunks on the Bulletin chain (`window.desktop.bulletin`). The
 * message itself goes out through the chat manager as one statement, after
 * every chunk is in a best block.
 *
 * Browser-safe and DOM-free (image preparation is attachmentImage.ts), so
 * the tests and the Node e2e run it as is.
 */

import type { AttachmentRow, AttachmentStatus } from '../../app/database';
import { appDatabase, db } from '../../app/database';
import { type HexString, bytesToHex } from '../../app/bytes';

import type { BulletinProgress, DesktopBulletinApi } from '../../../shared/desktop-api';

import { SENDER_CHUNK_SIZE, decryptChunk, encryptAttachment, freshKeyAndNonce, isAttachmentError } from './attachmentCrypto';
import { type AttachmentItem, type AttachmentMedia, attachmentItemWire } from './content';
import { attachmentContentLength } from './identityEvents';
import type { ChatManager } from './manager';

/** Spec 0012 "Limits". */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ITEMS = 4;
export const MAX_CONTENT_BYTES = 3_584;
export const MAX_THUMBNAIL_BYTES = 2_048;
export const MAX_CAPTION_BYTES = 1_024;
/** Images and voice notes up to this size download without a tap. */
export const AUTO_DOWNLOAD_BYTES = 5 * 1024 * 1024;
/** Bulletin keeps a chunk 14 days; the sender's estimate is an hour short of it. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
/** M15a sends images only (files, albums and voice notes are M15b). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** Download retries: 10 s doubling to 10 min, for 24 h after the first failure. */
const RETRY_FIRST_MS = 10_000;
const RETRY_MAX_MS = 10 * 60_000;
const RETRY_FOR_MS = 24 * 60 * 60_000;

/** A file ready to encrypt: the bytes that will be sent, and what the message says about them. */
export type PreparedFile = {
  bytes: Uint8Array;
  mime: string;
  name: string | null;
  media: AttachmentMedia;
  blurhash: string | null;
  thumbnail: Uint8Array | null;
};

/** Why a picked file cannot be sent (M15a: images of at most 25 MiB); null when it can. */
export const pickProblem = (file: { type: string; size: number }): string | null => {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Only images (PNG, JPEG, WebP, GIF) can be sent yet.';
  if (file.size < 1) return 'This file is empty.';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'An attachment is at most 25 MB.';
  return null;
};

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

const contentLength = (items: readonly AttachmentItem[], caption: string | null): number =>
  attachmentContentLength({ items: items.map(attachmentItemWire), caption: caption ?? undefined });

/**
 * Spec 0012: the encoded content must stay within 3,584 bytes. Thumbnails
 * go first, the largest first; blurhashes stay. Null when even without
 * thumbnails it is too large (a long caption).
 */
export const fitToBudget = (items: readonly AttachmentItem[], caption: string | null): AttachmentItem[] | null => {
  const out = items.map(item => ({ ...item, thumbnail: item.thumbnail && item.thumbnail.length <= MAX_THUMBNAIL_BYTES ? item.thumbnail : null }));
  while (contentLength(out, caption) > MAX_CONTENT_BYTES) {
    const largest = out.reduce<number>((at, item, i) => ((item.thumbnail?.length ?? 0) > (out[at]?.thumbnail?.length ?? 0) ? i : at), 0);
    const target = out[largest];
    if (!target?.thumbnail) return null;
    out[largest] = { ...target, thumbnail: null };
  }
  return out;
};

export type BuiltAttachment = { items: AttachmentItem[]; ciphertexts: Uint8Array[][]; plaintexts: Uint8Array[] };

/** Encrypts each file with a fresh key and nonce and builds its `Attachment`. */
export async function buildAttachment(files: readonly PreparedFile[], caption: string | null, store: { genesis: HexString; mirror: string | null }, now: number): Promise<BuiltAttachment> {
  if (files.length < 1 || files.length > MAX_ITEMS) throw new Error('A message carries 1 to 4 attachments.');
  if (caption !== null && utf8Length(caption) > MAX_CAPTION_BYTES) throw new Error('The caption is too long (at most 1,024 bytes).');
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new Error('An attachment is at most 25 MB.');
  const items: AttachmentItem[] = [];
  const ciphertexts: Uint8Array[][] = [];
  for (const file of files) {
    const { key, nonce } = freshKeyAndNonce();
    const encrypted = await encryptAttachment(file.bytes, key, nonce, SENDER_CHUNK_SIZE);
    ciphertexts.push(encrypted.ciphertexts);
    items.push({
      mime: file.mime,
      name: file.name,
      size: file.bytes.length,
      media: file.media,
      blurhash: file.blurhash,
      thumbnail: file.thumbnail,
      key,
      nonce,
      chunkSize: SENDER_CHUNK_SIZE,
      chunks: encrypted.hashes,
      store,
      expiresAt: now + RETENTION_MS,
    });
  }
  const fitted = fitToBudget(items, caption);
  if (!fitted) throw new Error('The caption is too long for an attachment message.');
  return { items: fitted, ciphertexts, plaintexts: files.map(file => file.bytes) };
}

// ── Local rows ──────────────────────────────────────────────────────────────

export const getAttachmentRow = (messageId: string, index: number): Promise<AttachmentRow | undefined> => db.attachments.get([messageId, index]);

const patchRow = (messageId: string, index: number, patch: Partial<AttachmentRow>): Promise<number> =>
  db.attachments.update([messageId, index], { ...patch, updatedAt: Date.now() });

const uploadIdOf = (messageId: string, index: number): string => `${messageId}-${index}`;

export type AttachmentDeps = {
  bulletin: Pick<DesktopBulletinApi, 'store' | 'onProgress' | 'fetch'> | null;
  /** The profile's Bulletin chain (genesis, gateway mirror to name in messages). */
  store: { genesis: HexString; mirror: string | null } | null;
  now?: () => number;
};

export type AttachmentService = {
  /** Encrypts, stores and sends `files` to `peer` with `caption`: one message. */
  send: (manager: Pick<ChatManager, 'sendAttachment'>, peer: HexString, files: readonly PreparedFile[], caption: string | null) => Promise<void>;
  /** A failed upload: store the same chunks again from the local copy, then `manager.retry` sends the same message. */
  reupload: (manager: Pick<ChatManager, 'retry'>, peer: HexString, messageId: string) => Promise<void>;
  /** Fetches, checks and decrypts item `index` of `messageId` into the local store (at most once at a time). */
  fetch: (messageId: string, index: number, item: AttachmentItem, options?: { only?: 'bitswap' | 'mirror' | 'gateway' }) => Promise<AttachmentStatus>;
  dispose: () => void;
};

const blankRow = (messageId: string, index: number, item: AttachmentItem, status: AttachmentStatus, now: number): AttachmentRow => ({
  messageId,
  index,
  status,
  done: 0,
  total: item.chunks.length,
  bytes: null,
  mime: item.mime,
  expiresAt: item.expiresAt,
  attempts: 0,
  firstFailedAt: null,
  error: null,
  updatedAt: now,
});

export const createAttachmentService = ({ bulletin, store, now = Date.now }: AttachmentDeps): AttachmentService => {
  const uploads = new Map<string, [string, number]>();
  const stopProgress =
    bulletin?.onProgress(({ uploadId, stored }: BulletinProgress) => {
      const target = uploads.get(uploadId);
      if (target) void patchRow(target[0], target[1], { done: stored });
    }) ?? (() => undefined);
  const inFlight = new Map<string, Promise<AttachmentStatus>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const requireBulletin = () => {
    if (!bulletin || !store) throw new Error('Attachments need the Bulletin chain, which this network does not have in the app.');
    return { bulletin, store };
  };

  const storeItems = async (messageId: string, ciphertexts: readonly Uint8Array[][]): Promise<void> => {
    const { bulletin: chain } = requireBulletin();
    try {
      for (const [index, chunks] of ciphertexts.entries()) {
        const uploadId = uploadIdOf(messageId, index);
        uploads.set(uploadId, [messageId, index]);
        await patchRow(messageId, index, { status: 'uploading', done: 0, error: null });
        try {
          await chain.store(uploadId, [...chunks]);
        } finally {
          uploads.delete(uploadId);
        }
        await patchRow(messageId, index, { status: 'ready', done: chunks.length });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await db.attachments.where('messageId').equals(messageId).modify(row => {
        if (row.status === 'uploading') Object.assign(row, { status: 'uploadFailed', error: text, updatedAt: Date.now() });
      });
      throw error;
    }
  };

  const send: AttachmentService['send'] = async (manager, peer, files, caption) => {
    const target = requireBulletin();
    const built = await buildAttachment(files, caption, target.store, now());
    await manager.sendAttachment(peer, { items: built.items, caption }, async messageId => {
      // The sender's copy first: the bubble shows the image at once, and it is the source of any re-store.
      await appDatabase.transaction('rw', db.attachments, async () => {
        for (const [index, item] of built.items.entries()) {
          await db.attachments.put({ ...blankRow(messageId, index, item, 'uploading', now()), bytes: built.plaintexts[index] ?? null });
        }
      });
      await storeItems(messageId, built.ciphertexts);
    });
  };

  const reupload: AttachmentService['reupload'] = async (manager, peer, messageId) => {
    const row = await db.messages.get(messageId);
    if (!row || row.content.type !== 'attachment') throw new Error('This message has no attachment.');
    const ciphertexts: Uint8Array[][] = [];
    for (const [index, item] of row.content.items.entries()) {
      const local = await getAttachmentRow(messageId, index);
      if (!local?.bytes) throw new Error('The file is no longer on this computer.');
      // Same key, nonce and file: the same chunks and CIDs, so the message stays valid (spec 0012).
      const encrypted = await encryptAttachment(local.bytes, item.key, item.nonce, item.chunkSize);
      if (encrypted.hashes.some((hash, i) => bytesToHex(hash) !== bytesToHex(item.chunks[i] as Uint8Array))) throw new Error('The file on this computer changed.');
      ciphertexts.push(encrypted.ciphertexts);
    }
    await storeItems(messageId, ciphertexts);
    await manager.retry(peer, messageId);
  };

  const classify = (error: unknown, item: AttachmentItem): AttachmentStatus => {
    if (isAttachmentError(error) && error.reason !== 'hash') return 'damaged';
    return now() > item.expiresAt ? 'expired' : 'failed';
  };

  const runFetch = async (messageId: string, index: number, item: AttachmentItem, only?: 'bitswap' | 'mirror' | 'gateway'): Promise<AttachmentStatus> => {
    const existing = await getAttachmentRow(messageId, index);
    if (existing?.status === 'ready' && existing.bytes && !only) return 'ready';
    const base = existing ?? blankRow(messageId, index, item, 'downloading', now());
    await db.attachments.put({ ...base, status: 'downloading', done: 0, total: item.chunks.length, error: null, updatedAt: now() });
    try {
      const target = requireBulletin();
      // Spec 0012: `store.genesis` names the chain; a client on another network refuses.
      if (item.store.genesis.toLowerCase() !== target.store.genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      const out = new Uint8Array(item.size);
      let offset = 0;
      for (const [i, hash] of item.chunks.entries()) {
        const { bytes } = await target.bulletin.fetch(item.store.genesis, bytesToHex(hash), item.store.mirror, only);
        // The hash is checked before the cipher sees a byte (decryptChunk).
        const plain = await decryptChunk(item, i, bytes);
        out.set(plain, offset);
        offset += plain.length;
        await patchRow(messageId, index, { done: i + 1 });
      }
      if (offset !== item.size) throw Object.assign(new Error('Attachment is damaged.'), { reason: 'length' });
      await patchRow(messageId, index, { status: 'ready', bytes: out, attempts: 0, firstFailedAt: null, error: null });
      return 'ready';
    } catch (error) {
      const status = classify(error, item);
      const attempts = base.attempts + 1;
      const firstFailedAt = base.firstFailedAt ?? now();
      const text = status === 'damaged' ? 'Attachment is damaged.' : error instanceof Error ? error.message : String(error);
      await patchRow(messageId, index, { status, attempts, firstFailedAt, error: text });
      // Before expiry, try again later with backoff, for a day (spec 0012 "Download flow" 6).
      if (status === 'failed' && now() - firstFailedAt < RETRY_FOR_MS && !only) {
        const delay = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (attempts - 1));
        const timer = setTimeout(() => {
          timers.delete(timer);
          void fetch(messageId, index, item);
        }, delay);
        timers.add(timer);
      }
      return status;
    }
  };

  const fetch: AttachmentService['fetch'] = (messageId, index, item, options = {}) => {
    const key = `${messageId}:${index}:${options.only ?? ''}`;
    const running = inFlight.get(key);
    if (running) return running;
    const work = runFetch(messageId, index, item, options.only).finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  };

  return {
    send,
    reupload,
    fetch,
    dispose: () => {
      stopProgress();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
};

/** Whether a received item downloads without a tap (images and voice notes up to 5 MiB). */
export const autoDownloads = (item: AttachmentItem): boolean => (item.media.kind === 'image' || item.media.kind === 'voice') && item.size <= AUTO_DOWNLOAD_BYTES;

/** "1.2 MB", "340 KB", "12 bytes". */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
