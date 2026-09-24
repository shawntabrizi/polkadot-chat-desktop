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
import { type PreparedFile, MAX_CONTENT_BYTES, buildAttachment, createAttachmentService, fitToBudget, getAttachmentRow, pickProblem } from './attachments';
import { type AttachmentItem, fromWire, toWire } from './content';
import { createIdentityChannel } from './identityChannel';
import { type IdentityChannelEvent, attachmentContentLength } from './identityEvents';
import { type ChatManager, createChatManager } from './manager';
import { createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, createPeerSession } from './peerSession';

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
  let failing = 0;
  return {
    chunks,
    log,
    failNext: (count: number) => {
      failing = count;
    },
    api: {
      store: async (uploadId: string, list: Uint8Array[]) => {
        if (failing > 0) {
          failing -= 1;
          throw new Error('Upload failed: a chunk did not reach the Bulletin chain.');
        }
        list.forEach((chunk, i) => {
          chunks.set(bytesToHex(contentHash(chunk)), chunk);
          log.push(`stored ${bytesToHex(contentHash(chunk))}`);
          for (const listener of listeners) listener({ uploadId, stored: i + 1, total: list.length });
        });
      },
      onProgress: (listener: (progress: BulletinProgress) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      fetch: async (_genesis: string, hash: string) => {
        const bytes = chunks.get(hash.toLowerCase());
        if (!bytes) throw new Error('No source had the chunk.');
        return { bytes, source: 'bitswap' };
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

  it('accepts only images of at most 25 MiB in M15a', () => {
    expect(pickProblem({ type: 'image/png', size: 300_000 })).toBeNull();
    expect(pickProblem({ type: 'application/pdf', size: 10 })).toMatch(/Only images/);
    expect(pickProblem({ type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 })).toMatch(/at most 25 MB/);
  });
});
