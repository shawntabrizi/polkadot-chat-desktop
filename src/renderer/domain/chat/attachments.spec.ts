/**
 * Spec 0012 (M15a) through the chat manager, against a hand-driven peer on
 * one in-memory statement store and a fake Bulletin chain (a map of chunks by
 * content hash). Why these tests exist:
 * - the efficiency rule: an attachment message costs one statement, however
 *   many Bulletin transactions it took, and none when the upload fails;
 * - the chunks must be in the chain before the message names them;
 * - a recipient never shows bytes that do not match the message.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { BulletinProgress } from '../../../shared/desktop-api';
import type { IdentityLookup } from '../identity/lookup';
import { sendChatRequest } from '../requests/gateway';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { contentHash } from './attachmentCrypto';
import {
  type PreparedFile,
  MAX_CONTENT_BYTES,
  addPicked,
  autoDownloads,
  buildAttachment,
  createAttachmentService,
  fitToBudget,
  gatewayFirst,
  getAttachmentRow,
  parseResendRequest,
  prepareFile,
  resendRequestText,
  wireFileName,
} from './attachments';
import { type AttachmentItem, fromWire, toWire } from './content';
import { createIdentityChannel } from './identityChannel';
import { type IdentityChannelEvent, attachmentContentLength } from './identityEvents';
import { type ChatManager, createChatManager } from './manager';
import { addMessage } from './messages';
import { createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, createPeerSession } from './peerSession';
import { MAX_VOICE_MS, prepareVoice } from './voice';

const GENESIS = '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59' as HexString;
const STORE = { genesis: GENESIS, mirror: null };

type Store = ReturnType<typeof createInMemoryStatementStore>;

const lookupOf = (peer: TestPeer): IdentityLookup => ({
  getPeerIdentity: async accountId =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId) ? { accountId, username: 'peer', chatPublicKey: peer.identity.identityChatPublicKey } : null,
});

const openPeerTransport = (store: Store, self: TestPeer, web: TestPeer) => {
  const events: IdentityChannelEvent[] = [];
  const received: IncomingChatMessage[] = [];
  const common = { prover: createSr25519Prover(self.device.statementAccountSeed), allocator: createExpiryAllocator(), statementStore: store };
  const channel = createIdentityChannel({
    ownIdentityAccountId: self.identity.identityAccountId,
    ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    ...common,
    onEvent: event => events.push(event),
  });
  const roster = createPeerRoster([]);
  const session = createPeerSession({
    identity: self.identity,
    deviceKeys: self.device,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    peerRoster: roster,
    ...common,
    onMessage: message => received.push(message),
    onSent: () => undefined,
    onDelivered: () => undefined,
    onBatchDelivered: () => undefined,
  });
  return {
    events,
    received,
    roster,
    session,
    dispose: () => {
      channel.dispose();
      session.dispose();
    },
  };
};

const establish = async (store: Store, web: TestPeer, peer: TestPeer, manager: ChatManager, transport: ReturnType<typeof openPeerTransport>) => {
  const { requestId } = await sendChatRequest({
    recipientAccountId: web.identity.identityAccountId,
    recipientChatPublicKey: web.identity.identityChatPublicKey,
    senderIdentityAccountId: peer.identity.identityAccountId,
    senderIdentityChatPrivateKey: peer.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: peer.device.encryptionPublicKey,
    senderDeviceSeed: peer.device.statementAccountSeed,
    welcomeMessage: 'hi',
    statementStore: store,
    allocator: createExpiryAllocator(),
  });
  await waitFor(() => db.requests.get(requestId));
  await manager.acceptRequest(requestId);
  const accepted = await waitFor(() => transport.events.find(event => event.tag === 'accepted'));
  if (accepted.tag === 'accepted') transport.roster.set([accepted.device]);
  return bytesToHex(peer.identity.identityAccountId) as HexString;
};

/** A Bulletin chain in memory: `store` keeps chunks by hash; `fail` makes the next stores reject. */
const fakeBulletin = () => {
  const chunks = new Map<string, Uint8Array>();
  const listeners = new Set<(progress: BulletinProgress) => void>();
  const log: string[] = [];
  /** Chunks per store call: an album's chunks go in one call (M15c). */
  const calls: number[] = [];
  let failing = 0;
  return {
    chunks,
    log,
    calls,
    failNext: (count: number) => {
      failing = count;
    },
    api: {
      store: async (uploadId: string, list: Uint8Array[]) => {
        if (failing > 0) {
          failing -= 1;
          throw new Error('Upload failed: a chunk did not reach the Bulletin chain.');
        }
        let submitted = 0;
        let submittedBytes = 0;
        list.forEach((chunk, i) => {
          const hash = bytesToHex(contentHash(chunk));
          // As main: a chunk the chain has already is not stored again (and costs nothing).
          if (!chunks.has(hash)) {
            submitted += 1;
            submittedBytes += chunk.length;
            log.push(`stored ${hash}`);
          }
          chunks.set(hash, chunk);
          for (const listener of listeners) listener({ uploadId, stored: i + 1, total: list.length, chunk: i });
        });
        calls.push(list.length);
        return { submitted, submittedBytes };
      },
      onProgress: (listener: (progress: BulletinProgress) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      fetch: async (_genesis: string, hash: string, _mirror: string | null, _only?: string, gatewayFirst?: boolean) => {
        const bytes = chunks.get(hash.toLowerCase());
        if (!bytes) throw new Error('No source had the chunk.');
        log.push(`fetched ${bytes.length} ${gatewayFirst ? 'gateway-first' : 'bitswap-first'}`);
        return { bytes, source: gatewayFirst ? 'gateway' : 'bitswap' };
      },
    },
  };
};

const photo = (size = 300_000): PreparedFile => ({
  bytes: fill(size),
  mime: 'image/png',
  name: null,
  media: { kind: 'image', width: 640, height: 480 },
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  thumbnail: null,
});
function fill(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let at = 0; at < size; at += 65_536) out.set(crypto.getRandomValues(new Uint8Array(Math.min(65_536, size - at))), at);
  return out;
}

let manager: ChatManager | null = null;
let transport: ReturnType<typeof openPeerTransport> | null = null;

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

afterEach(() => {
  transport?.dispose();
  manager?.dispose();
  transport = null;
  manager = null;
});

const setup = async () => {
  const store = createInMemoryStatementStore();
  const web = makePeer();
  const peer = makePeer();
  manager = await createChatManager({ identity: web.identity, deviceKeys: web.device, statementStore: store, lookup: lookupOf(peer) });
  transport = openPeerTransport(store, peer, web);
  const peerKey = await establish(store, web, peer, manager, transport);
  const chain = fakeBulletin();
  const service = createAttachmentService({ bulletin: chain.api, store: STORE });
  return { manager, transport, peerKey, chain, service };
};

describe('sending an image', () => {
  it('stores the chunks first, then sends one statement that names them; the peer decrypts the same bytes', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    const file = photo();
    const before = manager.submissions.snapshot();
    await service.send(manager, peerKey, [file], 'Our cat');

    const received = await waitFor(() => transport.received.find(m => m.content.tag === 'attachment'));
    const after = manager.submissions.snapshot();
    expect(after.submissions - before.submissions).toBe(1);
    expect(after.messages - before.messages).toBe(1);

    const effect = fromWire(received.content);
    if (effect.kind !== 'message' || effect.content.type !== 'attachment') throw new Error('not an attachment');
    const [item] = effect.content.items as [AttachmentItem];
    expect(effect.content.caption).toBe('Our cat');
    // Every chunk the message names is on the chain.
    for (const hash of item.chunks) expect(chain.chunks.has(bytesToHex(hash))).toBe(true);

    // The sender's own bubble reads its local copy.
    const own = await db.messages.get(received.messageId);
    expect(own?.status).not.toBe('failed');
    expect((await getAttachmentRow(received.messageId, 0))?.bytes).toEqual(file.bytes);

    // The recipient side, on a fresh row: fetched by hash, checked, decrypted.
    const recipient = createAttachmentService({ bulletin: chain.api, store: STORE });
    await db.attachments.clear();
    expect(await recipient.fetch('received-1', 0, item)).toBe('ready');
    expect((await getAttachmentRow('received-1', 0))?.bytes).toEqual(file.bytes);
  });

  it('sends nothing when the upload fails, and the retry stores the same chunks and sends the message once', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    chain.failNext(1);
    const before = manager.submissions.snapshot();
    await expect(service.send(manager, peerKey, [photo(1000)], null)).rejects.toThrow(/Upload failed/);
    const row = (await db.messages.toArray()).find(r => r.content.type === 'attachment');
    expect(row?.status).toBe('failed');
    expect((await getAttachmentRow(row?.messageId ?? '', 0))?.status).toBe('uploadFailed');
    expect(manager.submissions.snapshot().submissions - before.submissions).toBe(0);
    expect(transport.received.some(m => m.content.tag === 'attachment')).toBe(false);

    await service.reupload(manager, peerKey, row?.messageId ?? '');
    const received = await waitFor(() => transport.received.find(m => m.content.tag === 'attachment'));
    expect(received.messageId).toBe(row?.messageId);
    const effect = fromWire(received.content);
    if (effect.kind !== 'message' || effect.content.type !== 'attachment') throw new Error('not an attachment');
    // Same key, nonce and file: the chunks stored now are the ones the message names.
    expect(chain.chunks.has(bytesToHex(effect.content.items[0]?.chunks[0] as Uint8Array))).toBe(true);
    // M15c: the row holds no key (sealed in `keys`), yet the resent message carries the real one: the peer can decrypt.
    const recipient = createAttachmentService({ bulletin: chain.api, store: STORE });
    expect(await recipient.fetch('retried', 0, effect.content.items[0] as AttachmentItem)).toBe('ready');
    recipient.dispose();
    expect(manager.submissions.snapshot().submissions - before.submissions).toBe(1);
  });
});

describe('fetching', () => {
  it('never shows a tampered chunk: the row ends failed, with no bytes', async () => {
    const chain = fakeBulletin();
    const built = await buildAttachment([photo(1000)], null, STORE, Date.now());
    const [item] = built.items as [AttachmentItem];
    const chunk = (built.ciphertexts[0]?.[0] as Uint8Array).slice();
    chunk[5] = (chunk[5] as number) ^ 0xff;
    chain.chunks.set(bytesToHex(item.chunks[0] as Uint8Array), chunk);
    const service = createAttachmentService({ bulletin: chain.api, store: STORE });
    expect(await service.fetch('m1', 0, item)).toBe('failed');
    const row = await getAttachmentRow('m1', 0);
    expect(row?.bytes).toBeNull();
    service.dispose();
  });

  it('says "expired" when no source has it after the sender\'s expiry', async () => {
    const built = await buildAttachment([photo(1000)], null, STORE, Date.now() - 15 * 24 * 60 * 60 * 1000);
    const service = createAttachmentService({ bulletin: fakeBulletin().api, store: STORE });
    expect(await service.fetch('m2', 0, built.items[0] as AttachmentItem)).toBe('expired');
    service.dispose();
  });

  it('refuses an attachment of another Bulletin chain', async () => {
    const built = await buildAttachment([photo(1000)], null, { genesis: `0x${'00'.repeat(32)}`, mirror: null }, Date.now());
    const service = createAttachmentService({ bulletin: fakeBulletin().api, store: STORE });
    await service.fetch('m3', 0, built.items[0] as AttachmentItem);
    expect((await getAttachmentRow('m3', 0))?.error).toBe('This attachment is on another network.');
    service.dispose();
  });
});

describe('the 4 KB message budget', () => {
  it('keeps a thumbnail of at most 2 KB, and drops thumbnails until the content fits 3,584 bytes', async () => {
    const built = await buildAttachment([{ ...photo(1000), thumbnail: new Uint8Array(2_048) }], 'x'.repeat(100), STORE, Date.now());
    expect(built.items[0]?.thumbnail?.length).toBe(2_048);
    const over = await buildAttachment([{ ...photo(1000), thumbnail: new Uint8Array(2_049) }], null, STORE, Date.now());
    expect(over.items[0]?.thumbnail).toBeNull();

    const items = built.items.flatMap(item => [item, item]) as AttachmentItem[];
    const fitted = fitToBudget(items, null) as AttachmentItem[];
    expect(fitted.filter(item => item.thumbnail !== null)).toHaveLength(1);
    expect(fitted.every(item => item.blurhash !== null)).toBe(true);
    const length = attachmentContentLength(toWire({ type: 'attachment', items: fitted, caption: null }).value as never);
    expect(length).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
  });

});

const receivedAttachment = async (transport: ReturnType<typeof openPeerTransport>) => {
  const received = await waitFor(() => transport.received.find(m => m.content.tag === 'attachment'));
  const effect = fromWire(received.content);
  if (effect.kind !== 'message' || effect.content.type !== 'attachment') throw new Error('not an attachment');
  return { messageId: received.messageId, content: effect.content };
};

describe('files (M15b)', () => {
  it('sends any file as `media = file` with its name, and the peer decrypts the same bytes', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    const bytes = fill(4_000);
    await service.send(manager, peerKey, [prepareFile({ bytes, name: 'minutes 2026-09.pdf', type: 'application/pdf' })], null);
    const { content } = await receivedAttachment(transport);
    const [item] = content.items as [AttachmentItem];
    expect(item.media).toEqual({ kind: 'file' });
    expect(item.name).toBe('minutes 2026-09.pdf');
    expect(item.mime).toBe('application/pdf');
    const recipient = createAttachmentService({ bulletin: chain.api, store: STORE });
    await db.attachments.clear();
    expect(await recipient.fetch('file-1', 0, item)).toBe('ready');
    expect((await getAttachmentRow('file-1', 0))?.bytes).toEqual(bytes);
  });

  it('keeps a long name within the 128 bytes a receiver accepts (a longer one would drop the whole message), extension kept', () => {
    const name = wireFileName(`${'Überweisung-'.repeat(20)}.xlsx`) as string;
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(128);
    expect(name.endsWith('….xlsx')).toBe(true);
    expect(wireFileName('C:\\Users\\me\\secret\\plan.txt')).toBe('plan.txt');
    // An unknown or over-long type goes out as octet-stream, never over the 64-byte bound.
    expect(prepareFile({ bytes: fill(1), name: 'x', type: '' }).mime).toBe('application/octet-stream');
    expect(prepareFile({ bytes: fill(1), name: 'x', type: `application/${'x'.repeat(80)}` }).mime).toBe('application/octet-stream');
  });

  it('fetches a chunk over 512 KB from the gateway first and a small last chunk by bitswap (spec 0012 source order)', async () => {
    const chain = fakeBulletin();
    const built = await buildAttachment([prepareFile({ bytes: fill(2_300_000), name: 'big.bin', type: '' })], null, STORE, Date.now());
    const [item] = built.items as [AttachmentItem];
    built.ciphertexts[0]?.forEach((chunk, i) => chain.chunks.set(bytesToHex(item.chunks[i] as Uint8Array), chunk));
    expect([gatewayFirst(item, 0), gatewayFirst(item, 1)]).toEqual([true, false]);
    const service = createAttachmentService({ bulletin: chain.api, store: STORE });
    expect(await service.fetch('big', 0, item)).toBe('ready');
    expect(chain.log.filter(line => line.startsWith('fetched'))).toEqual(['fetched 2000016 gateway-first', 'fetched 300016 bitswap-first']);
    service.dispose();
  });
});

describe('albums (M15b)', () => {
  it('sends up to 4 images as one message and one statement, one caption for all', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    const photos = [photo(2_000), photo(3_000), photo(4_000), photo(5_000)];
    const before = manager.submissions.snapshot();
    await service.send(manager, peerKey, photos, 'The island');
    const { messageId, content } = await receivedAttachment(transport);
    expect(manager.submissions.snapshot().submissions - before.submissions).toBe(1);
    expect(transport.received.filter(m => m.content.tag === 'attachment')).toHaveLength(1);
    expect(content.items).toHaveLength(4);
    expect(content.caption).toBe('The island');
    // Four stores (one chunk each), each item its own key.
    expect(chain.log.filter(line => line.startsWith('stored'))).toHaveLength(4);
    expect(new Set(content.items.map(item => bytesToHex(item.key))).size).toBe(4);
    // M15c (review M15b answer 5): all four in one store call, in flight together; safe because no two
    // items share a key and nonce, so no AEAD nonce repeats under one key.
    expect(chain.calls).toEqual([4]);
    expect(new Set(content.items.map(item => bytesToHex(item.nonce))).size).toBe(4);
    for (const [index, file] of photos.entries()) expect((await getAttachmentRow(messageId, index))?.bytes).toEqual(file.bytes);
  });

  it('refuses a fifth image and a mixed pick, keeping what already waits', async () => {
    const image = { type: 'image/png', size: 10 };
    const pdf = { type: 'application/pdf', size: 10 };
    const four = addPicked([image, image], [image, image]);
    expect(four).toEqual({ files: [image, image, image, image], problem: null });
    expect(addPicked(four.files, [image]).problem).toMatch(/at most 4 images/);
    expect(addPicked(four.files, [image]).files).toHaveLength(4);
    expect(addPicked([], [image, pdf]).problem).toMatch(/one file at a time/);
    // A file replaces an album in waiting, and images replace a file.
    expect(addPicked([image, image], [pdf])).toEqual({ files: [pdf], problem: null });
    expect(addPicked([pdf], [image])).toEqual({ files: [image], problem: null });
    expect(addPicked([], [{ type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 }]).problem).toMatch(/at most 25 MB/);
    expect(addPicked([], [{ type: 'text/plain', size: 0 }]).problem).toMatch(/empty/);
    // 25 MiB is the limit per message, not per item.
    expect(addPicked([{ type: 'image/png', size: 20 * 1024 * 1024 }], [{ type: 'image/png', size: 6 * 1024 * 1024 }]).problem).toMatch(/at most 25 MB/);
    await expect(buildAttachment([photo(10), photo(10), photo(10), photo(10), photo(10)], null, STORE, Date.now())).rejects.toThrow(/1 to 4/);
  });
});

describe('voice notes (M15b)', () => {
  const voice = (durationMs: number) => ({ bytes: fill(1_000), durationMs, waveform: Array.from({ length: 32 }, (_, i) => i * 8) });

  it('refuses a recording over 5 minutes (spec 0012: one chunk at 24 kbps), and a 5:00 one goes', () => {
    expect(() => prepareVoice(voice(MAX_VOICE_MS + 1))).toThrow(/at most 5 minutes/);
    expect(prepareVoice(voice(MAX_VOICE_MS)).media).toEqual({ kind: 'voice', durationMs: MAX_VOICE_MS, waveform: voice(0).waveform });
  });

  it('goes out with its duration and 32-bar waveform, no name, and auto-downloads on the other side', async () => {
    const { manager, transport, peerKey, service } = await setup();
    await service.send(manager, peerKey, [prepareVoice(voice(42_000))], null);
    const { content } = await receivedAttachment(transport);
    const [item] = content.items as [AttachmentItem];
    expect(item.mime).toBe('audio/webm; codecs=opus');
    expect(item.name).toBeNull();
    expect(item.media).toEqual({ kind: 'voice', durationMs: 42_000, waveform: voice(0).waveform });
  });
});

describe('resend on request (M15c)', () => {
  it('stores the same ciphertext again from the local copy: the CIDs the message names work again, and no message is sent', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    const file = photo(3_000);
    await service.send(manager, peerKey, [file], null);
    const { messageId, content } = await receivedAttachment(transport);
    const [item] = content.items as [AttachmentItem];
    // 14 days later the chain dropped the chunks: the recipient cannot fetch.
    chain.chunks.clear();
    const recipient = createAttachmentService({ bulletin: chain.api, store: STORE });
    expect(await recipient.fetch('copy-1', 0, item)).toBe('failed');
    recipient.dispose();

    const before = manager.submissions.snapshot();
    const result = await service.resend(messageId);
    // Same key, nonce and file: the same chunk hashes as the message (spec 0012: a re-store yields the same CIDs).
    expect(result.hashes).toEqual(item.chunks.map(hash => bytesToHex(hash)));
    expect(result.submitted).toBe(1);
    expect(manager.submissions.snapshot().submissions).toBe(before.submissions);
    expect(transport.received.filter(m => m.content.tag === 'attachment')).toHaveLength(1);

    const again = createAttachmentService({ bulletin: chain.api, store: STORE });
    await db.attachments.delete(['copy-1', 0]);
    expect(await again.fetch('copy-1', 0, item)).toBe('ready');
    expect((await getAttachmentRow('copy-1', 0))?.bytes).toEqual(file.bytes);
    again.dispose();
  });

  it('broadcasts nothing when the chain still has every chunk, and refuses when the local file changed', async () => {
    const { manager, peerKey, service } = await setup();
    await service.send(manager, peerKey, [photo(2_000)], null);
    const own = (await db.messages.toArray()).find(r => r.content.type === 'attachment' && r.direction === 'outgoing');
    expect((await service.resend(own!.messageId)).submitted).toBe(0);
    // A changed copy would give other CIDs than the message names: never store those.
    await db.attachments.update([own!.messageId, 0], { bytes: fill(2_000) });
    await expect(service.resend(own!.messageId)).rejects.toThrow(/changed/);
  });

  it('asks with one text that names the message in a local link, then keeps retrying past the expiry for a day', async () => {
    const sent: { peer: string; text: string }[] = [];
    const chat = { sendMessage: async (peer: string, content: { type: string; text: string }) => void sent.push({ peer, text: content.text }) };
    const chain = fakeBulletin();
    const built = await buildAttachment([prepareFile({ bytes: fill(500), name: 'plan [v2].pdf', type: 'application/pdf' })], null, STORE, Date.now() - 15 * 24 * 60 * 60 * 1000);
    const [item] = built.items as [AttachmentItem];
    const peer = `0x${'cd'.repeat(32)}` as HexString;
    await addMessage({ messageId: 'old-file', peerAccountId: peer, timestamp: 1, direction: 'incoming', status: 'received', content: { type: 'attachment', items: [item], caption: null }, reactions: [], editedAt: null });
    const service = createAttachmentService({ bulletin: chain.api, store: STORE, chat: chat as never });
    expect(await service.fetch('old-file', 0, item)).toBe('expired');

    await service.askResend('old-file', 0);
    expect(sent).toEqual([{ peer, text: 'Please resend [plan v2.pdf](#resend/old-file)' }]);
    expect(parseResendRequest(sent[0]!.text)).toBe('old-file');
    expect(resendRequestText('m-1', { name: null, media: { kind: 'video', width: 1, height: 1, durationMs: 1 } })).toBe('Please resend [the video](#resend/m-1)');
    // Still missing: after the ask it is "failed" (retried), not "expired" (given up).
    expect(await service.fetch('old-file', 0, item)).toBe('failed');
    // The sender stores it again; the next retry gets it.
    built.ciphertexts[0]?.forEach((chunk, i) => chain.chunks.set(bytesToHex(item.chunks[i] as Uint8Array), chunk));
    expect(await service.fetch('old-file', 0, item)).toBe('ready');
    service.dispose();
  });
});

describe('video (M15c)', () => {
  it('goes out as a file with its poster, size and duration; the peer gets the same bytes', async () => {
    const { manager, transport, peerKey, chain, service } = await setup();
    const bytes = fill(90_000);
    const video: PreparedFile = { bytes, mime: 'video/webm', name: 'ferry.webm', media: { kind: 'video', width: 640, height: 360, durationMs: 12_345 }, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', thumbnail: fill(1_500) };
    await service.send(manager, peerKey, [video], null);
    const { content } = await receivedAttachment(transport);
    const [item] = content.items as [AttachmentItem];
    expect(item.media).toEqual({ kind: 'video', width: 640, height: 360, durationMs: 12_345 });
    expect(item.name).toBe('ferry.webm');
    expect(item.thumbnail?.length).toBe(1_500);
    // Spec 0012: only images and voice notes download on their own; a video waits for a tap.
    expect(autoDownloads(item)).toBe(false);
    const recipient = createAttachmentService({ bulletin: chain.api, store: STORE });
    await db.attachments.clear();
    expect(await recipient.fetch('video-1', 0, item)).toBe('ready');
    expect((await getAttachmentRow('video-1', 0))?.bytes).toEqual(bytes);
    recipient.dispose();
  });
});
