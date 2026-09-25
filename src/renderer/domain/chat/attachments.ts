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

import type { AttachmentRow, AttachmentStatus, PeerId } from '../../app/database';
import { appDatabase, db, isGroupPeer, isLocalPeer } from '../../app/database';
import { type HexString, bytesToHex } from '../../app/bytes';

import { type BulletinProgress, type BulletinStoreResult, type DesktopBulletinApi, type DesktopHopApi, HOP_MAX_FILE_BYTES, type HopFetchResult, type HopProgress } from '../../../shared/desktop-api';

import { hopTicket, itemWithKey, setHopLocation } from './attachmentKeyStore';
import { SENDER_CHUNK_SIZE, decryptChunk, encryptAttachment, freshKeyAndNonce, isAttachmentError } from './attachmentCrypto';
import { type Attachment, type AttachmentItem, type AttachmentMedia, attachmentItemWire } from './content';
import { ATTACHMENT_BOUNDS, attachmentContentLength } from './identityEvents';
import type { ChatManager } from './manager';
import { recordUploads } from './storageQuota';

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
/** Images the app prepares (re-encodes, blurhash, thumbnail) and shows inline; up to 4 make an album. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** A file whose type the browser does not know, or whose type is longer than the wire allows. */
export const OCTET_STREAM = 'application/octet-stream';
/** Spec 0012 "Source order": a chunk whose ciphertext is larger than this is fetched from the gateway first. */
export const GATEWAY_FIRST_ABOVE = 512 * 1024;
/** AES-GCM tag appended to every chunk. */
const TAG_BYTES = 16;
/** A HOP node keeps an entry 24 hours (base spec "HOP Protocol"). */
export const HOP_RETENTION_MS = 24 * 60 * 60 * 1000;
/** The detail line of a file this app sent over HOP (M20b). */
export const HOP_SENT_LINE = 'Sent over HOP; available for 24 hours';
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

export const isImageType = (type: string): boolean => (IMAGE_TYPES as readonly string[]).includes(type);

type Pickable = { type: string; size: number };

/**
 * M15b: what waits in the composer after a pick, paste or drop. One message
 * is either one file (any type) or an album of 1 to 4 images (spec 0012
 * "Items per message": 4), at most 25 MiB in total. Images add to images
 * already waiting; a file replaces what waits, and images replace a file.
 * `problem` says why the pick was refused; `files` is then what waited before.
 */
export const addPicked = <T extends Pickable>(waiting: readonly T[], picked: readonly T[]): { files: T[]; problem: string | null } => {
  const refuse = (problem: string) => ({ files: [...waiting], problem });
  if (picked.length === 0) return { files: [...waiting], problem: null };
  if (picked.some(file => file.size < 1)) return refuse('This file is empty.');
  // M20: one file may be up to 32 MB (over 25 MB it goes over HOP); several together stay within 25 MB.
  if (picked.some(file => file.size > HOP_MAX_FILE_BYTES)) return refuse('An attachment is at most 32 MB.');
  const images = picked.every(file => isImageType(file.type));
  if (!images && picked.length > 1) return refuse('Send one file at a time, or up to 4 images together.');
  const next = images && waiting.every(file => isImageType(file.type)) ? [...waiting, ...picked] : [...picked];
  if (next.length > MAX_ITEMS) return refuse('An album holds at most 4 images.');
  if (next.length > 1 && next.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) return refuse('One message carries at most 25 MB.');
  return { files: next, problem: null };
};

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** At most `max` UTF-8 bytes of `text`, whole characters only. */
const clipBytes = (text: string, max: number): string => {
  let out = '';
  for (const char of text) {
    if (utf8Length(out + char) > max) break;
    out += char;
  }
  return out;
};

/**
 * A file's name for the wire: at most 128 bytes (the receiver's decoder
 * drops a longer one, and the whole message with it), keeping the extension
 * when it is short. Null for no name.
 */
export const wireFileName = (name: string): string | null => {
  const base = (name.split(/[/\\]/).pop() ?? '').trim();
  if (base === '') return null;
  if (utf8Length(base) <= ATTACHMENT_BOUNDS.name) return base;
  const extension = /\.[\w-]{1,10}$/.exec(base)?.[0] ?? '';
  return `${clipBytes(base.slice(0, base.length - extension.length), ATTACHMENT_BOUNDS.name - utf8Length(`…${extension}`))}…${extension}`;
};

/** The MIME type for the wire: the browser's, or `application/octet-stream` when it has none or it is over 64 bytes. */
export const wireMime = (type: string): string => {
  const trimmed = type.trim();
  return trimmed === '' || utf8Length(trimmed) > ATTACHMENT_BOUNDS.mime ? OCTET_STREAM : trimmed;
};

/** Spec 0012 "Other files: sent as they are, `media = file`", with the file's name. */
export const prepareFile = (file: { bytes: Uint8Array; name: string; type: string }): PreparedFile => ({
  bytes: file.bytes,
  mime: wireMime(file.type),
  name: wireFileName(file.name),
  media: { kind: 'file' },
  blurhash: null,
  thumbnail: null,
});

/** The ciphertext length of chunk `index` (plaintext part plus the tag). */
export const cipherChunkLength = (item: Pick<AttachmentItem, 'size' | 'chunkSize'>, index: number): number =>
  Math.max(0, Math.min(item.chunkSize, item.size - index * item.chunkSize)) + TAG_BYTES;

/** Spec 0012 "Source order": chunks over 512 KB go to the gateway first. */
export const gatewayFirst = (item: Pick<AttachmentItem, 'size' | 'chunkSize'>, index: number): boolean => cipherChunkLength(item, index) > GATEWAY_FIRST_ABOVE;

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

export type AttachmentDeps = {
  bulletin: Pick<DesktopBulletinApi, 'store' | 'onProgress' | 'fetch'> | null;
  /** The profile's Bulletin chain (genesis, gateway mirror to name in messages). */
  store: { genesis: HexString; mirror: string | null } | null;
  /** M15c: sends the "Please resend" text of Ask to resend. */
  chat?: Pick<ChatManager, 'sendMessage'> | null;
  /** Base spec HOP receive (a phone app's `richText` attachment) and, since M20b, send; null where there is no main process. */
  hop?: (Pick<DesktopHopApi, 'fetch' | 'ack' | 'onProgress'> & Partial<Pick<DesktopHopApi, 'send'>>) | null;
  now?: () => number;
};

/** M15c: what a resend stored again (chunks the chain still had cost nothing and keep their CIDs). */
export type ResendResult = { chunks: number; submitted: number; hashes: HexString[] };

type SendingManager = Pick<ChatManager, 'sendAttachment' | 'attachmentRail' | 'sendHopFile'>;

export type AttachmentService = {
  /**
   * Sends `files` to `peer` with `caption` on the rail the peer's devices
   * all read (spec 0013/0014): on Bulletin (encrypt, store, one message), or
   * for a peer with a baseline device over HOP, one message per file as the
   * phones send (the caption with the first).
   */
  send: (manager: SendingManager, peer: HexString, files: readonly PreparedFile[], caption: string | null) => Promise<void>;
  /** A failed upload: store the same chunks again from the local copy (or put a HOP file on a node again), then `manager.retry` sends the same message. */
  reupload: (manager: Pick<ChatManager, 'retry'>, peer: HexString, messageId: string) => Promise<void>;
  /**
   * M15c "Resend" (spec 0012 "Re-upload on request"): the sender stores the
   * same ciphertext of its own message `messageId` again, from its local
   * copy with the same key and nonce, so the CIDs the message names work
   * again. No message is sent.
   */
  resend: (messageId: string) => Promise<ResendResult>;
  /**
   * M15c "Ask to resend": item `index` of the received `messageId` is
   * expired or missing. Sends the peer "Please resend <name>" (one text
   * message; the link carries the message id for the sender's client) and
   * retries the download for 24 h.
   */
  askResend: (messageId: string, index: number) => Promise<void>;
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

/** "Please resend [photo](#resend/<id>)": the link's target is the message id; any client shows the words. */
const RESEND_LINK = /\]\(#resend\/([\w-]{1,64})\)/;

/** The name an Ask to resend uses: the file's name, else what it is. */
export const resendName = (item: Pick<AttachmentItem, 'name' | 'media'>): string => {
  if (item.name) return item.name.replace(/[[\]()]/g, '');
  switch (item.media.kind) {
    case 'image':
      return 'the photo';
    case 'video':
      return 'the video';
    case 'voice':
      return 'the voice message';
    case 'file':
      return 'the file';
  }
};

/** M15c: the text of an Ask to resend: a plain request with the original message id in a local link. */
export const resendRequestText = (messageId: string, item: Pick<AttachmentItem, 'name' | 'media'>): string => `Please resend [${resendName(item)}](#resend/${messageId})`;

/** The message id an Ask to resend names, or null. */
export const parseResendRequest = (text: string): string | null => RESEND_LINK.exec(text)?.[1] ?? null;

export const createAttachmentService = ({ bulletin, store, chat = null, hop = null, now = Date.now }: AttachmentDeps): AttachmentService => {
  const uploads = new Map<string, { messageId: string; itemOf: number[]; done: number[] }>();
  const stopProgress =
    bulletin?.onProgress(({ uploadId, chunk }: BulletinProgress) => {
      const target = uploads.get(uploadId);
      if (!target || chunk === undefined) return;
      const index = target.itemOf[chunk];
      if (index === undefined) return;
      target.done[index] = (target.done[index] ?? 0) + 1;
      void patchRow(target.messageId, index, { done: target.done[index] });
    }) ?? (() => undefined);
  const hopRequests = new Map<string, { messageId: string; index: number }>();
  const stopHopProgress =
    hop?.onProgress(({ requestId, done, total }: HopProgress) => {
      const target = hopRequests.get(requestId);
      if (target) void patchRow(target.messageId, target.index, { done, total });
    }) ?? (() => undefined);
  const inFlight = new Map<string, Promise<AttachmentStatus>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const requireBulletin = () => {
    if (!bulletin || !store) throw new Error('Attachments need the Bulletin chain, which this network does not have in the app.');
    return { bulletin, store };
  };

  /**
   * Every chunk of every item in one store call (review M15b answer 5): main
   * gives them nonces in sequence and keeps them in flight together, and
   * the budget is checked once for the message. Each item keeps its own key
   * and nonce, so the chunks of two items never share an AEAD nonce.
   */
  const storeItems = async (messageId: string, ciphertexts: readonly Uint8Array[][]): Promise<BulletinStoreResult> => {
    const { bulletin: chain } = requireBulletin();
    const uploadId = `${messageId}-all`;
    const itemOf = ciphertexts.flatMap((chunks, index) => chunks.map(() => index));
    uploads.set(uploadId, { messageId, itemOf, done: ciphertexts.map(() => 0) });
    try {
      for (const index of ciphertexts.keys()) await patchRow(messageId, index, { status: 'uploading', done: 0, error: null });
      const result = await chain.store(uploadId, ciphertexts.flat());
      for (const [index, chunks] of ciphertexts.entries()) await patchRow(messageId, index, { status: 'ready', done: chunks.length });
      await recordUploads(result, now());
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await db.attachments.where('messageId').equals(messageId).modify(row => {
        if (row.status === 'uploading') Object.assign(row, { status: 'uploadFailed', error: text, updatedAt: Date.now() });
      });
      throw error;
    } finally {
      uploads.delete(uploadId);
    }
  };

  /** M20b: a file on a HOP node of this network; the row learns where once it is there. */
  const uploadHop = async (messageId: string, bytes: Uint8Array): Promise<NonNullable<Attachment['hop']>> => {
    if (!hop?.send) throw new Error('This app cannot send files over HOP here.');
    await patchRow(messageId, 0, { status: 'uploading', done: 0, total: 1, error: null });
    const result = await hop.send(bytes).catch((error: unknown) => ({ ok: false as const, reason: 'network' as const, message: error instanceof Error ? error.message : String(error) }));
    if (!result.ok) {
      await patchRow(messageId, 0, { status: 'uploadFailed', error: result.message });
      throw new Error(result.message);
    }
    await patchRow(messageId, 0, { status: 'ready', done: 1, total: 1, hop: { cipher: 'chacha20-poly1305', layout: 'versioned' } });
    return { identifier: result.identifier as HexString, node: result.node, ticket: result.ticket };
  };

  const sendHop = async (manager: SendingManager, peer: HexString, files: readonly PreparedFile[], caption: string | null): Promise<void> => {
    for (const [index, file] of files.entries()) {
      const attachment = hopAttachmentOf(file);
      await manager.sendHopFile(peer, { text: index === 0 ? caption : null, attachment }, async messageId => {
        // The sender's copy first: the bubble shows it at once, and it is the source of a retry.
        await db.attachments.put({ ...blankRow(messageId, 0, hopItemOf(attachment), 'uploading', now()), total: 1, expiresAt: now() + HOP_RETENTION_MS, bytes: file.bytes });
        return uploadHop(messageId, file.bytes);
      });
    }
  };

  const send: AttachmentService['send'] = async (manager, peer, files, caption) => {
    // Spec 0013: the rail every device of the peer reads; HOP for a baseline device or a file over 25 MiB.
    const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
    if ((await manager.attachmentRail(peer, total)) === 'hop') return sendHop(manager, peer, files, caption);
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

  /** The ciphertext of each item of our own `messageId`, again, from the local copy; checked against the CIDs the message names. */
  const ciphertextsAgain = async (messageId: string): Promise<{ ciphertexts: Uint8Array[][]; hashes: HexString[] }> => {
    const row = await db.messages.get(messageId);
    if (!row || row.content.type !== 'attachment') throw new Error('This message has no attachment.');
    const ciphertexts: Uint8Array[][] = [];
    const hashes: HexString[] = [];
    for (const [index, stored] of row.content.items.entries()) {
      const local = await getAttachmentRow(messageId, index);
      if (!local?.bytes) throw new Error('The file is no longer on this computer.');
      const item = await itemWithKey(messageId, index, stored);
      // Same key, nonce and file: the same chunks and CIDs, so the message stays valid (spec 0012).
      const encrypted = await encryptAttachment(local.bytes, item.key, item.nonce, item.chunkSize);
      if (encrypted.hashes.some((hash, i) => bytesToHex(hash) !== bytesToHex(item.chunks[i] as Uint8Array))) throw new Error('The file on this computer changed.');
      ciphertexts.push(encrypted.ciphertexts);
      hashes.push(...item.chunks.map(hash => bytesToHex(hash)));
    }
    return { ciphertexts, hashes };
  };

  const reupload: AttachmentService['reupload'] = async (manager, peer, messageId) => {
    const row = await db.messages.get(messageId);
    if (row?.content.type === 'richText') {
      // M20b: a HOP file whose upload failed goes on a node again from the local copy; one that is there is only sent again.
      const [attachment] = row.content.attachments;
      if (attachment && !attachment.hop?.node) {
        const local = await getAttachmentRow(messageId, 0);
        if (!local?.bytes) throw new Error('The file is no longer on this computer.');
        await setHopLocation(messageId, 0, { ...attachment, hop: await uploadHop(messageId, local.bytes) });
      }
      return manager.retry(peer, messageId);
    }
    const { ciphertexts } = await ciphertextsAgain(messageId);
    await storeItems(messageId, ciphertexts);
    await manager.retry(peer, messageId);
  };

  const resend: AttachmentService['resend'] = async messageId => {
    const row = await db.messages.get(messageId);
    if (!row || row.direction !== 'outgoing') throw new Error('Only your own attachment can be resent.');
    const { ciphertexts, hashes } = await ciphertextsAgain(messageId);
    const result = await storeItems(messageId, ciphertexts);
    return { chunks: hashes.length, submitted: result.submitted, hashes };
  };

  const askResend: AttachmentService['askResend'] = async (messageId, index) => {
    if (!chat) throw new Error('Chat is not running.');
    const row = await db.messages.get(messageId);
    if (row?.content.type === 'richText') return askHopResend(row.messageId, row.peerAccountId, row.direction, row.content.attachments, index);
    const item = row?.content.type === 'attachment' ? row.content.items[index] : undefined;
    if (!row || row.direction !== 'incoming' || !item || isGroupPeer(row.peerAccountId) || isLocalPeer(row.peerAccountId)) throw new Error('Only an attachment a contact sent you can be asked for again.');
    await chat.sendMessage(row.peerAccountId, { type: 'text', text: resendRequestText(messageId, item) });
    // Spec 0012: the asking client retries for 24 h, expired or not.
    const at = now();
    const existing = await getAttachmentRow(messageId, index);
    await db.attachments.put({ ...(existing ?? blankRow(messageId, index, item, 'failed', at)), status: 'failed', attempts: 0, firstFailedAt: at, resendAskedAt: at, error: null, updatedAt: at });
    schedule(messageId, index, item, 1);
  };

  /**
   * HOP receive: the sender's node no longer holds it, and a phone cannot
   * store it again under the same id, so the ask is a plain request for a
   * new message (no `#resend` link, which only this app's sender side reads)
   * and nothing retries.
   */
  const askHopResend = async (messageId: string, peer: PeerId, direction: string, attachments: readonly Attachment[], index: number): Promise<void> => {
    const attachment = attachments[index];
    if (!chat || direction !== 'incoming' || !attachment || isGroupPeer(peer) || isLocalPeer(peer)) throw new Error('Only an attachment a contact sent you can be asked for again.');
    const item = hopItemOf(attachment);
    await chat.sendMessage(peer, { type: 'text', text: `Please resend ${resendName(item)}` });
    const at = now();
    const existing = await getAttachmentRow(messageId, index);
    await db.attachments.put({ ...(existing ?? blankRow(messageId, index, item, 'unavailable', at)), status: 'unavailable', resendAskedAt: at, updatedAt: at });
  };

  const HOP_STATUS: Record<Extract<HopFetchResult, { ok: false }>['reason'], AttachmentStatus> = {
    notFound: 'unavailable',
    chainPending: 'fetchingChain',
    tooLarge: 'tooLarge',
    damaged: 'damaged',
    refused: 'failed',
    untrusted: 'failed',
    network: 'failed',
  };

  /**
   * HOP receive (base spec "Download Flow"): main claims and decrypts; the
   * file is persisted here; only then are its entries acked, since the ack
   * removes them from the sender's node for good. A network failure retries
   * with the same backoff as a Bulletin fetch; the rest are final.
   * RFC-0001: an entry gone from the pool is read from chain storage by main
   * and never acked; while no source has it (`chainPending`) the row stays
   * `fetchingChain` and retries with the same backoff for 24 h after the
   * first failure, then ends `unavailable` (Ask to resend).
   */
  const runHopFetch = async (messageId: string, index: number, item: AttachmentItem): Promise<AttachmentStatus> => {
    const existing = await getAttachmentRow(messageId, index);
    if (existing?.status === 'ready' && existing.bytes) return 'ready';
    const message = await db.messages.get(messageId);
    // M20b: never claim our own upload. The peer's ticket key is its only recipient, so our ack would remove it for them.
    if (message?.direction === 'outgoing') return existing?.status ?? 'failed';
    const attachment = message?.content.type === 'richText' ? message.content.attachments[index] : undefined;
    const base = existing ?? blankRow(messageId, index, item, 'downloading', now());
    const settle = async (status: AttachmentStatus, error: string) => {
      const attempts = base.attempts + 1;
      const firstFailedAt = base.firstFailedAt ?? now();
      await db.attachments.put({ ...base, status, attempts, firstFailedAt, error, updatedAt: now() });
      return { attempts, firstFailedAt };
    };
    if (!attachment?.hop || !hop) {
      await settle('failed', 'This app cannot download it.');
      return 'failed';
    }
    if (attachment.fileSize > HOP_MAX_FILE_BYTES) {
      await settle('tooLarge', `Larger than ${HOP_MAX_FILE_BYTES / (1024 * 1024)} MB.`);
      return 'tooLarge';
    }
    await db.attachments.put({ ...base, status: 'downloading', done: 0, total: 1, error: null, updatedAt: now() });
    const requestId = `hop-${index}-${messageId}`.slice(0, 64);
    hopRequests.set(requestId, { messageId, index });
    let result: HopFetchResult;
    let ticket: Uint8Array = new Uint8Array(0);
    try {
      ticket = await hopTicket(messageId, index, attachment);
      result = await hop.fetch(requestId, attachment.hop.node, attachment.hop.identifier, ticket);
    } catch (error) {
      result = { ok: false, reason: 'network', message: error instanceof Error ? error.message : String(error) };
    } finally {
      hopRequests.delete(requestId);
    }
    if (!result.ok) {
      const within = now() - (base.firstFailedAt ?? now()) < RETRY_FOR_MS;
      const gone = result.reason === 'chainPending' && !within;
      const status = gone ? 'unavailable' : HOP_STATUS[result.reason];
      const { attempts } = await settle(status, gone ? "No longer available from the sender's node or chain storage." : result.message);
      if ((result.reason === 'network' || result.reason === 'chainPending') && within) schedule(messageId, index, item, attempts);
      return status;
    }
    // Persisted first: after the ack the node deletes the entries. Not persisted: not acked, still claimable.
    const ready: AttachmentRow = {
      ...base,
      status: 'ready',
      bytes: result.bytes,
      mime: attachment.mimeType,
      done: result.entries.length + result.fromChain,
      total: result.entries.length + result.fromChain,
      attempts: 0,
      firstFailedAt: null,
      error: null,
      hop: { cipher: result.cipher, layout: result.layout },
      updatedAt: now(),
    };
    try {
      await db.attachments.put(ready);
    } catch (error) {
      await settle('failed', error instanceof Error ? error.message : String(error));
      return 'failed';
    }
    // RFC-0001: entries read from chain storage are not in the pool; only the pool's are acked.
    if (result.entries.length === 0) return 'ready';
    try {
      await hop.ack(attachment.hop.node, ticket, result.entries);
    } catch (error) {
      // Not fatal: an entry left unacked expires on the node (24 h) or is promoted on chain.
      console.warn('[attachments] HOP ack failed', error instanceof Error ? error.message : error);
    }
    return 'ready';
  };

  const classify = (error: unknown, item: AttachmentItem, local: AttachmentRow): AttachmentStatus => {
    if (isAttachmentError(error) && error.reason !== 'hash') return 'damaged';
    const asked = local.resendAskedAt !== undefined && now() - local.resendAskedAt < RETRY_FOR_MS;
    return now() > item.expiresAt && !asked ? 'expired' : 'failed';
  };

  const schedule = (messageId: string, index: number, item: AttachmentItem, attempts: number) => {
    const delay = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (attempts - 1));
    const timer = setTimeout(() => {
      timers.delete(timer);
      void fetch(messageId, index, item);
    }, delay);
    timers.add(timer);
  };

  const runFetch = async (messageId: string, index: number, stored: AttachmentItem, only?: 'bitswap' | 'mirror' | 'gateway'): Promise<AttachmentStatus> => {
    const existing = await getAttachmentRow(messageId, index);
    if (existing?.status === 'ready' && existing.bytes && !only) return 'ready';
    const base = existing ?? blankRow(messageId, index, stored, 'downloading', now());
    await db.attachments.put({ ...base, status: 'downloading', done: 0, total: stored.chunks.length, error: null, updatedAt: now() });
    try {
      const target = requireBulletin();
      // Spec 0012: `store.genesis` names the chain; a client on another network refuses.
      if (stored.store.genesis.toLowerCase() !== target.store.genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      // M15c: the key and nonce come from the sealed `keys` table.
      const item = await itemWithKey(messageId, index, stored);
      const out = new Uint8Array(item.size);
      let offset = 0;
      for (const [i, hash] of item.chunks.entries()) {
        const { bytes } = await target.bulletin.fetch(item.store.genesis, bytesToHex(hash), item.store.mirror, only, gatewayFirst(item, i));
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
      const status = classify(error, stored, base);
      const attempts = base.attempts + 1;
      const firstFailedAt = base.firstFailedAt ?? now();
      const text = status === 'damaged' ? 'Attachment is damaged.' : error instanceof Error ? error.message : String(error);
      await patchRow(messageId, index, { status, attempts, firstFailedAt, error: text });
      // Before expiry (or within a day of an Ask to resend), try again later with backoff, for a day (spec 0012 "Download flow" 6).
      if (status === 'failed' && now() - firstFailedAt < RETRY_FOR_MS && !only) schedule(messageId, index, stored, attempts);
      return status;
    }
  };

  const fetch: AttachmentService['fetch'] = (messageId, index, item, options = {}) => {
    const key = `${messageId}:${index}:${options.only ?? ''}`;
    const running = inFlight.get(key);
    if (running) return running;
    const work = (item.via === 'hop' ? runHopFetch(messageId, index, item) : runFetch(messageId, index, item, options.only)).finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  };

  // RFC-0001: the chain retries outlive a restart; the row keeps `fetchingChain` and when the first failure was.
  let disposed = false;
  const resumeChainFetches = async () => {
    const rows = await db.attachments.filter(row => row.status === 'fetchingChain').toArray();
    for (const row of rows) {
      const message = await db.messages.get(row.messageId);
      const attachment = message?.content.type === 'richText' ? message.content.attachments[row.index] : undefined;
      if (attachment?.hop && !disposed) schedule(row.messageId, row.index, hopItemOf(attachment), 1);
    }
  };
  if (hop) void resumeChainFetches().catch(() => undefined);

  return {
    send,
    reupload,
    resend,
    askResend,
    fetch,
    dispose: () => {
      disposed = true;
      stopProgress();
      stopHopProgress();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
};

/**
 * Whether a received item downloads without a tap: images and voice notes
 * up to 5 MiB (spec 0012); over HOP also files up to 5 MiB, since the
 * sender's node keeps them only a day.
 */
export const autoDownloads = (item: AttachmentItem): boolean =>
  (item.media.kind === 'image' || item.media.kind === 'voice' || (item.via === 'hop' && item.media.kind === 'file')) && item.size <= AUTO_DOWNLOAD_BYTES;

/** A frame's shape when the sender gave none: 4:3 for a photo, 16:9 for a video. */
const PHOTO_SHAPE = { width: 4, height: 3 };
const VIDEO_SHAPE = { width: 16, height: 9 };

/**
 * HOP receive: a phone app's attachment as the item the M15 bubbles draw
 * (`via: 'hop'`; no key, chunks or store: those come from the message's
 * ticket and node). A `general` file with an image type is shown as a photo.
 */
export const hopItemOf = (attachment: Attachment): AttachmentItem => {
  const photo = attachment.kind === 'image' || (attachment.kind === 'general' && isImageType(attachment.mimeType));
  const shape = attachment.width && attachment.height ? { width: attachment.width, height: attachment.height } : null;
  const media: AttachmentMedia = photo
    ? { kind: 'image', ...(shape ?? PHOTO_SHAPE) }
    : attachment.kind === 'video'
      ? { kind: 'video', ...VIDEO_SHAPE, durationMs: (attachment.durationSecs ?? 0) * 1000 }
      : { kind: 'file' };
  return {
    mime: attachment.mimeType,
    name: null,
    size: attachment.fileSize,
    media,
    blurhash: attachment.blurhash ?? null,
    thumbnail: null,
    key: new Uint8Array(0),
    nonce: new Uint8Array(0),
    chunkSize: 0,
    chunks: [],
    store: { genesis: '0x', mirror: null },
    expiresAt: 0,
    via: 'hop',
  };
};

/**
 * M20b: a prepared file as a base spec HOP attachment (`FileMeta`): an image
 * with its size and blurhash, a video with whole seconds and its blurhash,
 * anything else (a voice note too: the base has no audio meta) as `general`.
 * The file name has no place in `P2PMixnetFile`.
 */
export const hopAttachmentOf = (file: PreparedFile): Attachment => {
  const base = { mimeType: file.mime, fileSize: file.bytes.length };
  switch (file.media.kind) {
    case 'image':
      return { kind: 'image', ...base, width: file.media.width, height: file.media.height, blurhash: file.blurhash };
    case 'video':
      return { kind: 'video', ...base, durationSecs: Math.ceil(file.media.durationMs / 1000), blurhash: file.blurhash };
    default:
      return { kind: 'general', ...base };
  }
};

/** "1.2 MB", "340 KB", "12 bytes". */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
