/**
 * HOP receive in the attachment service, with a fake main process. Why
 * these tests exist:
 * - an ack removes the entry from the sender's node for good (the ticket key
 *   is its sole recipient), so nothing may be acked before the file is
 *   persisted here, and a file that failed to persist must stay claimable;
 * - NotFound (another device acked first, or the entry expired) is a final
 *   state the person can act on (ask to resend), not a retry loop;
 * - the claim ticket is key material: it is sealed at rest, never kept on
 *   the message row;
 * - RFC-0001: an entry gone from the pool may be in chain storage, so that
 *   case retries for a bounded window (24 h) before it is final, survives a
 *   restart, and never acks what came from the chain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { DesktopHopApi, HopFetchResult, HopProgress } from '../../../shared/desktop-api';

import { attachmentKeyId } from './attachmentKeyStore';
import { type AttachmentService, autoDownloads, createAttachmentService, getAttachmentRow, hopItemOf } from './attachments';
import type { Attachment } from './content';
import { addMessage } from './messages';
import { freeLocalCopies } from './storageQuota';

const PEER = `0x${'cd'.repeat(32)}` as HexString;
const TICKET = Uint8Array.from({ length: 32 }, (_v, i) => i + 1);
const IDENTIFIER = `0x${'ab'.repeat(32)}` as HexString;
const NODE = 'wss://paseo-hop-next-0.polkadot.io';
const FILE = new TextEncoder().encode('a photo from the phone');

const photo = (fileSize = FILE.length): Attachment => ({
  kind: 'image',
  mimeType: 'image/jpeg',
  fileSize,
  width: 3024,
  height: 4032,
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  hop: { identifier: IDENTIFIER, node: NODE, ticket: TICKET.slice() },
});

const receive = async (messageId: string, attachment: Attachment = photo()) => {
  await addMessage({ messageId, peerAccountId: PEER, timestamp: Date.now(), direction: 'incoming', status: 'received', content: { type: 'richText', text: null, attachments: [attachment] }, reactions: [], editedAt: null });
  return hopItemOf(attachment);
};

type FakeMain = { api: Pick<DesktopHopApi, 'fetch' | 'ack' | 'onProgress'>; log: string[]; tickets: string[] };

/** Main as the renderer sees it: `fetch` answers `result`, `ack` records what the local row held at that moment. */
const fakeMain = (result: HopFetchResult): FakeMain => {
  const log: string[] = [];
  const tickets: string[] = [];
  const listeners = new Set<(progress: HopProgress) => void>();
  return {
    log,
    tickets,
    api: {
      fetch: async (requestId, node, identifier, ticket) => {
        tickets.push(bytesToHex(ticket));
        log.push(`fetch ${node} ${identifier}`);
        for (const listener of listeners) listener({ requestId, done: 1, total: 1 });
        return result;
      },
      ack: async (_node, ticket, entries) => {
        tickets.push(bytesToHex(ticket));
        const rows = await db.attachments.toArray();
        log.push(`ack ${entries.length} while local=${rows.map(row => `${row.status}:${row.bytes?.length ?? 0}`).join(',')}`);
        return { acked: entries.length, notFound: 0, failed: 0 };
      },
      onProgress: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
};

const OK: HopFetchResult = { ok: true, bytes: FILE, entries: [IDENTIFIER, `0x${'01'.repeat(32)}`], fromChain: 0, cipher: 'chacha20-poly1305', layout: 'versioned' };

let service: AttachmentService | null = null;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  service?.dispose();
  service = null;
  vi.restoreAllMocks();
});

describe('a phone app photo over HOP', () => {
  it('keeps the claim ticket sealed in `keys`, not on the message row, and fetches with the real one', async () => {
    const main = fakeMain(OK);
    const item = await receive('p1');
    const stored = await db.messages.get('p1');
    const attachment = stored?.content.type === 'richText' ? stored.content.attachments[0] : undefined;
    expect(attachment?.hop?.ticket.length).toBe(0);
    expect(await db.attachmentKeys.get(attachmentKeyId('p1', 0))).toBeDefined();

    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    expect(await service.fetch('p1', 0, item)).toBe('ready');
    expect(main.tickets).toEqual([bytesToHex(TICKET), bytesToHex(TICKET)]);
  });

  it('acks only after the decrypted file is persisted, and records the dialect it came in', async () => {
    const main = fakeMain(OK);
    const item = await receive('p2');
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    expect(await service.fetch('p2', 0, item)).toBe('ready');
    expect(main.log).toEqual([`fetch ${NODE} ${IDENTIFIER}`, `ack 2 while local=ready:${FILE.length}`]);
    const row = await getAttachmentRow('p2', 0);
    expect(row?.bytes).toEqual(FILE);
    expect(row?.hop).toEqual({ cipher: 'chacha20-poly1305', layout: 'versioned' });
  });

  it('never acks a file it could not persist: the entry stays claimable for the next try', async () => {
    const main = fakeMain(OK);
    const item = await receive('p3');
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    const put = db.attachments.put.bind(db.attachments);
    vi.spyOn(db.attachments, 'put').mockImplementation(((row, key) => (row.status === 'ready' ? Promise.reject(new Error('disk full')) : put(row, key))) as typeof db.attachments.put);
    expect(await service.fetch('p3', 0, item)).toBe('failed');
    expect(main.log.some(line => line.startsWith('ack'))).toBe(false);
    expect((await getAttachmentRow('p3', 0))?.error).toBe('disk full');
  });

  it('shows NotFound as "no longer available", does not retry, and asks for a new message with plain text', async () => {
    const main = fakeMain({ ok: false, reason: 'notFound', message: "No longer available from the sender's node." });
    const sent: { peer: string; text: string }[] = [];
    const chat = { sendMessage: async (peer: string, content: { type: string; text: string }) => void sent.push({ peer, text: content.text }) };
    const item = await receive('p4');
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api, chat: chat as never });
    expect(await service.fetch('p4', 0, item)).toBe('unavailable');
    expect(main.log.filter(line => line.startsWith('ack'))).toEqual([]);

    await service.askResend('p4', 0);
    // A phone cannot store it again under the same id: a plain request, no `#resend` link.
    expect(sent).toEqual([{ peer: PEER, text: 'Please resend the photo' }]);
    const row = await getAttachmentRow('p4', 0);
    expect(row?.status).toBe('unavailable');
    expect(row?.resendAskedAt).toBeTypeOf('number');
  });

  it('refuses a file over 32 MiB without asking the node', async () => {
    const main = fakeMain(OK);
    const item = await receive('p5', photo(33 * 1024 * 1024));
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    expect(await service.fetch('p5', 0, item)).toBe('tooLarge');
    expect(main.log).toEqual([]);
  });

  it('marks a damaged file damaged and an untrusted node failed, without a retry', async () => {
    for (const [id, reason, status] of [
      ['p6', 'damaged', 'damaged'],
      ['p7', 'untrusted', 'failed'],
    ] as const) {
      const main = fakeMain({ ok: false, reason, message: 'x' });
      const item = await receive(id);
      service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
      expect(await service.fetch(id, 0, item)).toBe(status);
      expect((await getAttachmentRow(id, 0))?.bytes).toBeNull();
      service.dispose();
    }
  });

  it('keeps a HOP copy on Free space: the ack removed the only other copy', async () => {
    const item = await receive('p8');
    service = createAttachmentService({ bulletin: null, store: null, hop: fakeMain(OK).api });
    await service.fetch('p8', 0, item);
    expect(await freeLocalCopies(0, Date.now() + 1)).toEqual({ files: 0, bytes: 0 });
    expect((await getAttachmentRow('p8', 0))?.status).toBe('ready');
  });

  it('a file read from chain storage (RFC-0001) is ready and nothing is acked', async () => {
    const main = fakeMain({ ...OK, entries: [], fromChain: 2 });
    const item = await receive('c1');
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    expect(await service.fetch('c1', 0, item)).toBe('ready');
    expect(main.log).toEqual([`fetch ${NODE} ${IDENTIFIER}`]);
    expect(await getAttachmentRow('c1', 0)).toMatchObject({ status: 'ready', bytes: FILE, done: 2, total: 2 });
  });

  it('not yet in chain storage: `fetchingChain` with backoff retries, then `unavailable` with Ask to resend 24 h after the first failure', async () => {
    const main = fakeMain({ ok: false, reason: 'chainPending', message: 'not found in chain storage yet' });
    const sent: string[] = [];
    const chat = { sendMessage: async (_peer: string, content: { text: string }) => void sent.push(content.text) };
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms !== undefined && ms >= 10_000) delays.push(ms);
      return real(fn, ms);
    }) as typeof setTimeout);
    const start = 1_800_000_000_000;
    let clock = start;
    const item = await receive('c2');
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api, chat: chat as never, now: () => clock });
    expect(await service.fetch('c2', 0, item)).toBe('fetchingChain');
    clock = start + 23 * 60 * 60 * 1000;
    expect(await service.fetch('c2', 0, item)).toBe('fetchingChain');
    expect(delays).toEqual([10_000, 20_000]);
    expect(await getAttachmentRow('c2', 0)).toMatchObject({ status: 'fetchingChain', firstFailedAt: start, attempts: 2 });

    clock = start + 24 * 60 * 60 * 1000;
    expect(await service.fetch('c2', 0, item)).toBe('unavailable');
    expect(delays).toHaveLength(2);
    expect(main.log.filter(line => line.startsWith('ack'))).toEqual([]);
    await service.askResend('c2', 0);
    expect(sent).toEqual(['Please resend the photo']);
  });

  it('a restart picks the chain retries up again', async () => {
    const item = await receive('c3');
    service = createAttachmentService({ bulletin: null, store: null, hop: fakeMain({ ok: false, reason: 'chainPending', message: 'x' }).api });
    expect(await service.fetch('c3', 0, item)).toBe('fetchingChain');
    service.dispose();
    const main = fakeMain({ ...OK, entries: [], fromChain: 1 });
    const scheduled: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 10_000) {
        scheduled.push(ms);
        return real(fn, 0);
      }
      return real(fn, ms);
    }) as typeof setTimeout);
    service = createAttachmentService({ bulletin: null, store: null, hop: main.api });
    await vi.waitFor(async () => expect((await getAttachmentRow('c3', 0))?.status).toBe('ready'));
    expect(scheduled).toEqual([10_000]);
  });
});

describe('how a HOP attachment shows', () => {
  it('draws a phone photo in the image bubble with its size and blurhash, and downloads images and files up to 5 MB on its own', () => {
    const image = hopItemOf(photo());
    expect(image).toMatchObject({ via: 'hop', media: { kind: 'image', width: 3024, height: 4032 }, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', thumbnail: null });
    expect(autoDownloads(image)).toBe(true);
    // The sender's node keeps it a day: small files go without a tap too (Bulletin files never do).
    expect(autoDownloads(hopItemOf({ kind: 'general', mimeType: 'application/pdf', fileSize: 4 * 1024 * 1024 }))).toBe(true);
    expect(autoDownloads(hopItemOf({ kind: 'general', mimeType: 'application/pdf', fileSize: 6 * 1024 * 1024 }))).toBe(false);
    expect(autoDownloads(hopItemOf({ kind: 'video', mimeType: 'video/mp4', fileSize: 1024, durationSecs: 3 }))).toBe(false);
  });

  it('shows a `general` file with an image type (what pca sends) as a photo, and a video with its duration', () => {
    expect(hopItemOf({ kind: 'general', mimeType: 'image/png', fileSize: 10 }).media).toEqual({ kind: 'image', width: 4, height: 3 });
    expect(hopItemOf({ kind: 'video', mimeType: 'video/mp4', fileSize: 10, durationSecs: 7 }).media).toEqual({ kind: 'video', width: 16, height: 9, durationMs: 7000 });
    expect(hopItemOf({ kind: 'general', mimeType: 'application/zip', fileSize: 10 }).media).toEqual({ kind: 'file' });
  });
});
