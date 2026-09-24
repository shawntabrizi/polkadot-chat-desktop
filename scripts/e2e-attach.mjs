#!/usr/bin/env node
// M15a/M15b e2e: encrypted attachments through the Bulletin chain (spec 0012) between
// two test identities of this repo (never the owner's), on devnet:
//   npm run e2e:attach -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdeceb] [--bot pcdguide.70]
//
// Each person is a child process (`--role a|b`) running this repo's modules
// (the renderer's domain code over fake-indexeddb, the main process's Bulletin
// service), as e2e-pay.mjs does. The parent orders the steps:
//  0. a and b have a chat (a request, b accepts);
//  1. a's Bulletin account has storage: on devnet a `//Eve` grant when it has
//     none (AUTH_OK);
//  2. a encrypts a 300 KB PNG this script draws (a red circle), stores its
//     chunks and waits for each `Stored` in a best block (STORED <cid>), then
//     sends one kind-250 message; the Diagnostics meter moved by one
//     statement (SENT);
//  3. b receives it, fetches each chunk by `bitswap_v1_get`, checks the hash,
//     decrypts, and compares the SHA-256 with a's (FETCH_OK); then again
//     through the devnet gateway only (GATEWAY_OK);
//  4. M15b: a sends a 2.3 MB file (two chunks: the 2 MB one is fetched from
//     the gateway first, the 300 KB one by bitswap first, spec 0012 source
//     order), an album of 4 images (one message, one statement, four
//     stores) and a 60 s voice note (duration, 32-bar waveform); b fetches
//     and verifies each (FILE_OK, ALBUM_OK, VOICE_OK). A voice note over
//     5 minutes is refused before anything is stored (in VOICE_SENT).
//  4b. M15c: a 900 KB video (media = video: size, duration, poster blurhash;
//     b checks them and the bytes: VIDEO_OK); the album's 4 items go in one
//     store call; "Ask to resend": b frees its decrypted copy of the image and
//     sends "Please resend …" (one text), a's client sees the request and
//     stores the same ciphertext again (the chain still has it on devnet, so
//     nothing is broadcast), b fetches again by the same CIDs (RESEND_OK).
//  5. the bot step (BOT_DESCRIBE_OK) runs only when the pca fleet already runs
//     the pca half of M15a; else BOT_DESCRIBE_SKIPPED with the reason. The
//     fleet is read (its REVISION file), never changed. M15b: the bot's first
//     text after the attachment message must talk about the image
//     (scripts/lib/botDescribe.mjs); a greeting fails it. M15c: when the bot's
//     reply says its tools are off (the fleet's tool policy is "none", an
//     operator decision, review M15b), the step is a warning
//     (BOT_DESCRIBE_PENDING_OPERATOR) and ATTACH_OK says bot=pending-operator.
// Exit 0 ATTACH_OK; 13 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any
// other failure. Prints no secret (keys stay in the processes).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describesImage, refusesToLook, repliesAfter, toolsOff } from './lib/botDescribe.mjs';
import { drawScene, drawTestImage, shrink } from './lib/testImage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const role = flag('role');
const TIMEOUT_EXIT = 13;
const BOT = flag('bot') ?? 'pcdguide.70';
const PCA_REPO = resolve(root, '..', 'polkadot-chat-agents');
const FLEET = 'root@100.85.56.36';

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const identityFile = (name) => join(root, '.agent-runs', `identity-${name}`, 'identity.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (role) await child(role);
else await parent();

// ── Is the bot half live? Read-only checks of the pca repo and the fleet ────

function botReadiness() {
  const log = spawnSync('git', ['-C', PCA_REPO, 'log', '--format=%h %s', 'origin/desktop/rfc-0003', '--grep', 'M15a', '-n', '1'], { encoding: 'utf8' });
  const commit = log.status === 0 ? log.stdout.trim() : '';
  if (!commit) return { ready: false, reason: 'no "M15a" commit on pca desktop/rfc-0003 yet' };
  const revision = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', FLEET, 'cat /root/pca-bots/demo/app/REVISION'], { encoding: 'utf8' });
  const running = revision.status === 0 ? revision.stdout.trim() : '';
  if (!running) return { ready: false, reason: 'the fleet REVISION could not be read' };
  const hash = commit.split(' ')[0];
  const contains = spawnSync('git', ['-C', PCA_REPO, 'merge-base', '--is-ancestor', hash, running]);
  if (contains.status !== 0) return { ready: false, reason: `the fleet runs ${running}, which does not contain ${commit}` };
  return { ready: true, reason: `the fleet runs ${running} (contains ${commit})` };
}

// ── The parent: the order of the steps, and the end ────────────────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 5 * 60_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdeceb' };
  const saved = {};
  for (const [name, identity] of Object.entries(identities)) {
    if (!existsSync(identityFile(identity))) {
      console.log(`NO_IDENTITY ${identityFile(identity)} (npm run identity:register -- <letters>)`);
      process.exit(1);
    }
    const { username, accountHex } = JSON.parse(readFileSync(identityFile(identity), 'utf8'));
    saved[name] = { username, accountHex };
  }
  const people = {};
  let failing = false;
  const stopAll = () => {
    for (const person of Object.values(people)) if (person.proc.exitCode === null) person.proc.kill('SIGTERM');
  };
  const fail = (code, line) => {
    if (failing) return;
    failing = true;
    console.log(line);
    stopAll();
    setTimeout(() => process.exit(code), 1_500);
  };

  for (const [name, identity] of Object.entries(identities)) {
    const other = saved[name === 'a' ? 'b' : 'a'];
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identity, '--profile', profile, '--other', other.accountHex, '--other-name', other.username, '--bot', BOT], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const person = { name, proc, lines: [], waiters: [] };
    people[name] = person;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      console.log(`[${name}] ${line}`);
      person.lines.push(line);
      for (const waiter of [...person.waiters]) waiter();
    });
    createInterface({ input: proc.stderr }).on('line', (line) => console.log(`[${name}:err] ${line}`));
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      const last = person.lines.at(-1) ?? '';
      fail(/^E2E_TIMEOUT/.test(last) ? TIMEOUT_EXIT : code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${last}"`);
    });
  }

  const send = (name, line) => people[name].proc.stdin.write(`${line}\n`);
  const expectLine = (name, pattern, timeoutMs, from = 0) =>
    new Promise((done) => {
      const person = people[name];
      const check = () => {
        const index = person.lines.findIndex((line, i) => i >= from && pattern.test(line));
        if (index < 0) return false;
        person.waiters = person.waiters.filter((w) => w !== check);
        clearTimeout(timer);
        done(person.lines[index]);
        return true;
      };
      const timer = setTimeout(() => {
        person.waiters = person.waiters.filter((w) => w !== check);
        done(null);
      }, timeoutMs);
      if (!check()) person.waiters.push(check);
    });
  const field = (line, key) => line.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? null;
  const step = async (name, command, ok, stage, timeoutMs = STEP_WAIT_MS) => {
    const from = people[name].lines.length;
    send(name, command);
    const line = await expectLine(name, new RegExp(`${ok.source}|^[A-Z_]+_FAILED `), timeoutMs, from);
    if (!line) return fail(TIMEOUT_EXIT, `E2E_TIMEOUT ${stage}`) ?? null;
    if (/^[A-Z_]+_FAILED /.test(line)) return fail(1, `${stage}: ${line}`) ?? null;
    return line;
  };

  const ready = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^READY /, READY_WAIT_MS)));
  if (ready.some((line) => line === null)) return fail(TIMEOUT_EXIT, 'E2E_TIMEOUT both people ready (connect)');
  console.log(`PEOPLE a=${saved.a.username} b=${saved.b.username} at=${at()}`);

  // 0. The chat between a and b.
  const requested = await step('a', 'REQUEST_OTHER', /^CHAT_REQUEST_SENT /, 'chat request');
  if (!requested) return;
  if (!(await step('b', `ACCEPT ${field(requested, 'id')}`, /^ACCEPTED /, 'accept'))) return;
  if (!(await step('a', 'WAIT_CONTACT', /^CONTACT /, 'contact on a'))) return;

  // 1–2. Authorize, store, send.
  if (!(await step('a', 'AUTH', /^AUTH_OK /, 'authorization'))) return;
  const sent = await step('a', 'SEND_IMAGE', /^SENT /, 'store and send');
  if (!sent) return;
  const messageId = field(sent, 'id');
  const sha = field(sent, 'sha256');

  // 3. Fetch on b: bitswap, then the gateway.
  if (!(await step('b', `FETCH ${messageId} ${sha}`, /^FETCH_OK /, 'fetch by bitswap_v1_get'))) return;
  if (!(await step('b', `GATEWAY ${messageId} ${sha}`, /^GATEWAY_OK /, 'fetch through the gateway'))) return;

  // 4. M15b: a file, an album, a voice note; b verifies each.
  const fileSent = await step('a', 'SEND_FILE', /^FILE_SENT /, 'store and send the file');
  if (!fileSent) return;
  if (!(await step('b', `FETCH_FILE ${field(fileSent, 'id')} ${field(fileSent, 'sha256')}`, /^FILE_OK /, 'fetch the file'))) return;
  const albumSent = await step('a', 'SEND_ALBUM', /^ALBUM_SENT /, 'store and send the album');
  if (!albumSent) return;
  if (!(await step('b', `FETCH_ALBUM ${field(albumSent, 'id')} ${field(albumSent, 'sha256')}`, /^ALBUM_OK /, 'fetch the album'))) return;
  const voiceSent = await step('a', 'SEND_VOICE', /^VOICE_SENT /, 'store and send the voice note');
  if (!voiceSent) return;
  if (!(await step('b', `FETCH_VOICE ${field(voiceSent, 'id')} ${field(voiceSent, 'sha256')}`, /^VOICE_OK /, 'fetch the voice note'))) return;

  // 4b. M15c: a video; then Ask to resend the image and the sender's re-store.
  const videoSent = await step('a', 'SEND_VIDEO', /^VIDEO_SENT /, 'store and send the video');
  if (!videoSent) return;
  if (!(await step('b', `FETCH_VIDEO ${field(videoSent, 'id')} ${field(videoSent, 'sha256')}`, /^VIDEO_OK /, 'fetch the video'))) return;
  if (!(await step('b', `ASK_RESEND ${messageId}`, /^RESEND_ASKED /, 'ask to resend'))) return;
  if (!(await step('a', `RESEND ${messageId}`, /^RESENT /, 'resend on request'))) return;
  if (!(await step('b', `REFETCH ${messageId} ${sha}`, /^RESEND_OK /, 'fetch again by the same CIDs'))) return;

  // 5. The bot, only when its half runs on the fleet.
  const bot = botReadiness();
  let botResult = 'skipped';
  if (!bot.ready) console.log(`BOT_DESCRIBE_SKIPPED ${bot.reason}`);
  else {
    const line = await step('a', `BOT ${BOT}`, /^BOT_DESCRIBE_OK |^BOT_DESCRIBE_PENDING_OPERATOR /, 'bot describes the image', 6 * 60_000);
    if (!line) return;
    botResult = line.startsWith('BOT_DESCRIBE_OK') ? 'ok' : 'pending-operator';
    // The owner has not yet allowed read tools on the fleet's guide bot (review M15b): a warning, not a failure.
    if (botResult === 'pending-operator') console.log(`WARNING BOT_DESCRIBE_FAILED treated as pending: the bot's tool policy is "none" (${BOT}); enable read tools on the fleet to pass it`);
  }

  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_000);
  stopAll();
  const botWord = botResult === 'ok' ? 'BOT_DESCRIBE_OK' : botResult === 'pending-operator' ? 'bot=pending-operator' : 'BOT_DESCRIBE_SKIPPED';
  console.log(`ATTACH_OK FILE_OK ALBUM_OK VOICE_OK VIDEO_OK RESEND_OK ${botWord} at=${at()}`);
  process.exit(0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child(name) {
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  register();
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const WAIT_MS = 150_000;
  const identityName = flag('identity');
  const otherHex = flag('other');
  const otherName = flag('other-name');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  const waitFor = async (probe, timeoutMs = WAIT_MS) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const value = await probe();
      if (value) return value;
      await delay(POLL_MS);
    }
    return null;
  };

  const { deriveIdentityKeys } = await load('src/main/identity/keys.ts');
  const { NETWORK_PROFILES } = await load('src/renderer/app/network.ts');
  const { db } = await load('src/renderer/app/database.ts');
  const { getPeopleConnection, disposePeopleConnection, setMetadataCache } = await load('src/renderer/app/statementStore.ts');
  const { metadataCache, setMetadataCacheDir } = await load('src/main/metadataCache.ts');
  const { awaitBestRuntime, retryOnNextEndpoint } = await load('src/shared/chainRead.ts');
  const { seedSelfIdentity } = await load('src/renderer/domain/identity/selfIdentity.ts');
  const { readUserIdentity } = await load('src/renderer/domain/identity/userIdentity.ts');
  const { getDeviceKeys } = await load('src/renderer/domain/device/repository.ts');
  const { createIdentityLookup } = await load('src/renderer/domain/identity/lookup.ts');
  const { searchUsernames } = await load('src/renderer/domain/identity/search.ts');
  const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
  const { listMessages } = await load('src/renderer/domain/chat/messages.ts');
  const { openBulletin, createBulletinService, bulletinSigner, cidOf } = await load('src/main/chain/bulletin.ts');
  const { createAttachmentService, getAttachmentRow, parseResendRequest } = await load('src/renderer/domain/chat/attachments.ts');
  const { freeLocalCopies } = await load('src/renderer/domain/chat/storageQuota.ts');
  const { storeResultOf } = await load('src/main/chain/bulletin.ts');
  const { encodeBlurhash } = await load('src/renderer/domain/chat/blurhash.ts');
  const { prepareFile, gatewayFirst } = await load('src/renderer/domain/chat/attachments.ts');
  const { prepareVoice, waveformOf, MAX_VOICE_MS, VOICE_MIME } = await load('src/renderer/domain/chat/voice.ts');

  setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
  setMetadataCache(metadataCache());

  let manager = null;
  let chain = null;
  let attachments = null;
  const finish = (code, line) => {
    if (line) console.log(line);
    for (const close of [() => attachments?.dispose(), () => manager?.dispose(), () => chain?.destroy()]) {
      try {
        close();
      } catch (error) {
        console.warn('close failed', error);
      }
    }
    disposePeopleConnection();
    process.exit(code);
  };

  // ── Identity, connections, the app's modules ──
  const file = identityFile(identityName);
  if (!existsSync(file)) finish(1, `NO_IDENTITY ${file}`);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
  const selfKeys = deriveIdentityKeys(saved.mnemonic);
  if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
  console.log(`SELF ${saved.username} ${saved.accountHex}`);

  const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(connection.lazyClient.getClient()), connection.switchEndpoint);
    chain = await openBulletin(profile);
  } catch (error) {
    finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  let bulletinTransactions = 0;
  const service = createBulletinService(chain, bulletinSigner(saved.mnemonic), {
    onTransaction: () => {
      bulletinTransactions += 1;
    },
    log: (line) => console.log(line),
  });
  const genesis = chain.genesis;

  // The renderer's `window.desktop.bulletin`, over the main-process service in this process.
  const progress = new Set();
  const sources = [];
  const orders = [];
  let storeCalls = 0;
  const bulletinApi = {
    store: async (uploadId, chunks) => {
      storeCalls += 1;
      const stored = await service.store(chunks, (step) => {
        for (const listener of progress) listener({ uploadId, ...step });
      });
      for (const entry of stored) console.log(`STORED ${cidOf(bytesOf(entry.hash))} block=${entry.block ?? (entry.submitted ? 'found-by-content-hash' : 'already-on-chain')} best=yes`);
      return storeResultOf(stored, chunks);
    },
    onProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    fetch: async (chainId, hash, mirror, only, preferGateway) => {
      if (chainId.toLowerCase() !== genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      const result = await service.fetchChunk(bytesOf(hash), mirror, only, preferGateway);
      sources.push(result.source);
      orders.push(preferGateway ? 'gateway-first' : 'bitswap-first');
      return result;
    },
  };

  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  // As App.tsx: the manager sends the text of an Ask to resend (M15c).
  attachments = createAttachmentService({ bulletin: bulletinApi, store: { genesis, mirror: null }, chat: manager });
  console.log(`READY username=${saved.username} bulletin=${service.address}`);

  const image = drawTestImage();
  const preparedImage = () => {
    const small = shrink(image.rgba, image.width, image.height);
    return {
      bytes: image.png,
      mime: 'image/png',
      name: null,
      media: { kind: 'image', width: image.width, height: image.height },
      blurhash: encodeBlurhash(small.pixels, small.w, small.h, 4, 3),
      thumbnail: null,
    };
  };
  // M15b payloads, seeded so every run sends the same plaintext (each send has a fresh key, so new chunks).
  const seeded = (size, seed) => {
    const out = new Uint8Array(size);
    let x = seed >>> 0;
    for (let i = 0; i < size; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out[i] = x >>> 24;
    }
    return out;
  };
  const FILE_BYTES = 2_300_000;
  const fileBytes = seeded(FILE_BYTES, 0x15b0f11e);
  const albumImages = [
    drawScene(320, 240, { top: [44, 62, 120], bottom: [247, 150, 92], sun: [255, 214, 140], sea: [40, 70, 110] }),
    drawScene(240, 240, { top: [120, 180, 230], bottom: [214, 234, 248], sun: [255, 246, 200], sea: [30, 110, 140] }),
    drawScene(320, 240, { top: [70, 40, 110], bottom: [230, 110, 120], sun: [255, 190, 150], sea: [50, 40, 90] }),
    drawScene(300, 225, { top: [90, 160, 220], bottom: [240, 220, 180], sun: [255, 240, 190], sea: [20, 120, 150] }),
  ];
  const sceneFile = (scene) => {
    const small = shrink(scene.rgba, scene.width, scene.height);
    return { bytes: scene.png, mime: 'image/png', name: null, media: { kind: 'image', width: scene.width, height: scene.height }, blurhash: encodeBlurhash(small.pixels, small.w, small.h, 4, 3), thumbnail: null };
  };
  // 60 s at 24 kbps. Not a real Opus stream (Node cannot record): the e2e checks the transport and the metadata;
  // recording and playback are checked in the app (docs/acceptance.md "## M15b").
  const VOICE_MS = 60_000;
  const voiceBytes = seeded((VOICE_MS / 1000) * 3_000, 0x15b0c0de);
  const voiceWaveform = waveformOf(Float32Array.from({ length: 4_800 }, (_, i) => Math.sin(i / 40) * (0.2 + 0.8 * Math.abs(Math.sin(i / 700)))));
  // M15c: 900 KB of seeded bytes as a WebM video (Node cannot encode one; playback is checked in the app by the
  // room-video screenshot). One chunk, over 512 KB: fetched gateway first.
  const VIDEO = { bytes: seeded(900_000, 0x15c0f11e), width: 640, height: 360, durationMs: 7_500, name: 'm15c-e2e-clip.webm' };
  const videoScene = drawScene(64, 36, { top: [20, 60, 110], bottom: [240, 170, 90], sun: [255, 220, 150], sea: [30, 70, 100] });
  /** Sends `files` and checks the one-statement rule; resolves with the sent row and the counts. */
  const sendCounted = async (files, caption) => {
    const before = manager.submissions.snapshot();
    const transactionsBefore = bulletinTransactions;
    const callsBefore = storeCalls;
    await attachments.send(manager, otherHex, files, caption);
    const row = (await listMessages(otherHex)).filter((r) => r.direction === 'outgoing' && r.content.type === 'attachment').at(-1);
    await waitFor(async () => manager.submissions.snapshot().submissions > before.submissions, 30_000);
    const statements = manager.submissions.snapshot().submissions - before.submissions;
    return { row, statements, transactions: bulletinTransactions - transactionsBefore, calls: storeCalls - callsBefore };
  };
  /** b: every item of `messageId` fetched, checked and compared with a's SHA-256 list. */
  const fetchAll = async (messageId, expected) => {
    const row = await incomingAttachment(otherHex, messageId);
    if (!row) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the attachment message`);
    sources.length = 0;
    orders.length = 0;
    const results = [];
    for (const [index, item] of row.content.items.entries()) {
      const status = await attachments.fetch(row.messageId, index, item);
      const local = await getAttachmentRow(row.messageId, index);
      results.push({ status, sha: local?.bytes ? sha256(local.bytes) : 'none', error: local?.error ?? null });
    }
    const same = results.length === expected.length && results.every((r, i) => r.status === 'ready' && r.sha === expected[i]);
    return { row, results, same };
  };

  const incomingAttachment = (peer, messageId) =>
    waitFor(async () => (await listMessages(peer)).find((row) => row.direction === 'incoming' && row.content.type === 'attachment' && (!messageId || row.messageId === messageId)) ?? null);
  const fetchAndCompare = async (messageId, expected, only) => {
    const row = await incomingAttachment(otherHex, messageId);
    if (!row) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the attachment message`);
    const item = row.content.items[0];
    sources.length = 0;
    const status = await attachments.fetch(row.messageId, 0, item, only ? { only } : {});
    const local = await getAttachmentRow(row.messageId, 0);
    const got = local?.bytes ? sha256(local.bytes) : 'none';
    return { row, item, status, got, same: status === 'ready' && got === expected, error: local?.error ?? null };
  };

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await lookup.getPeerIdentity(bytesOf(otherHex));
        if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${otherName}`);
        await manager.sendRequest(peer, 'M15b attachments e2e');
        const request = (await db.requests.toArray()).filter((row) => row.direction === 'outgoing' && row.peerAccountId === otherHex).sort((x, y) => y.createdAt - x.createdAt)[0];
        console.log(`CHAT_REQUEST_SENT id=${request.requestId} to=${peer.username}`);
      }
      if (command === 'ACCEPT') {
        const request = await waitFor(() => db.requests.get(rest[0]));
        if (!request) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the chat request`);
        await manager.acceptRequest(rest[0]);
        console.log(`ACCEPTED ${request.peerUsername}`);
      }
      if (command === 'WAIT_CONTACT') {
        const contact = await waitFor(async () => {
          const row = await db.contacts.get(otherHex);
          return row && row.devices.length > 0 ? row : null;
        });
        if (!contact) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: contact`);
        console.log(`CONTACT ${contact.username} devices=${contact.devices.length}`);
      }
      if (command === 'AUTH') {
        const before = await service.allowance();
        // One chunk of the test image: the grant (devnet only) runs when the account has too little.
        const allowance = await service.ensureBudget([image.png.length + 16]);
        console.log(
          `AUTH_OK account=${service.address} granted=${before === null || before.transactionsLeft < 1 ? 'yes (//Eve, devnet)' : 'no (had storage)'} transactions_left=${allowance.transactionsLeft} bytes_left=${allowance.bytesLeft} expires_block=${allowance.expiresAtBlock}`,
        );
      }
      if (command === 'SEND_IMAGE') {
        const before = manager.submissions.snapshot();
        const transactionsBefore = bulletinTransactions;
        console.log(`IMAGE bytes=${image.png.length} sha256=${sha256(image.png)}`);
        await attachments.send(manager, otherHex, [preparedImage()], 'M15a: a red circle');
        const row = (await listMessages(otherHex)).filter((r) => r.direction === 'outgoing' && r.content.type === 'attachment').at(-1);
        // The statement goes out after the store: wait for the meter to see it.
        await waitFor(async () => manager.submissions.snapshot().submissions > before.submissions, 30_000);
        const after = manager.submissions.snapshot();
        const statements = after.submissions - before.submissions;
        const line = `id=${row.messageId} sha256=${sha256(image.png)} statements_delta=${statements} messages_delta=${after.messages - before.messages} bulletin_tx_delta=${bulletinTransactions - transactionsBefore} status=${row.status}`;
        console.log(statements === 1 ? `SENT ${line}` : `SEND_FAILED ${line} (expected one statement)`);
      }
      if (command === 'FETCH') {
        const result = await fetchAndCompare(rest[0], rest[1]);
        const line = `id=${result.row.messageId} status=${result.status} sources=${sources.join(',')} sha256=${result.got} chunks=${result.item.chunks.length} cid0=${cidOf(result.item.chunks[0])}`;
        console.log(result.same && sources.every((source) => source === 'bitswap') ? `FETCH_OK ${line}` : `FETCH_FAILED ${line} error=${result.error}`);
      }
      if (command === 'GATEWAY') {
        const result = await fetchAndCompare(rest[0], rest[1], 'gateway');
        const line = `id=${result.row.messageId} status=${result.status} sources=${sources.join(',')} sha256=${result.got}`;
        console.log(result.same && sources.length > 0 && sources.every((source) => source === 'gateway') ? `GATEWAY_OK ${line}` : `GATEWAY_FAILED ${line} error=${result.error}`);
      }
      if (command === 'SEND_FILE') {
        const file = prepareFile({ bytes: fileBytes, name: 'm15b-e2e-archive.bin', type: '' });
        const { row, statements, transactions } = await sendCounted([file], null);
        const item = row.content.items[0];
        const line = `id=${row.messageId} sha256=${sha256(fileBytes)} size=${fileBytes.length} name=${item.name} mime=${item.mime} chunks=${item.chunks.length} statements_delta=${statements} bulletin_tx_delta=${transactions}`;
        console.log(statements === 1 && item.chunks.length === 2 && item.media.kind === 'file' ? `FILE_SENT ${line}` : `SEND_FILE_FAILED ${line}`);
      }
      if (command === 'FETCH_FILE') {
        const { row, results, same } = await fetchAll(rest[0], [rest[1]]);
        const item = row.content.items[0];
        // Spec 0012 source order: the 2 MB chunk asks the gateway first, the 300 KB one bitswap first.
        const expectedOrder = item.chunks.map((_hash, i) => (gatewayFirst(item, i) ? 'gateway-first' : 'bitswap-first'));
        const ordered = orders.join(',') === 'gateway-first,bitswap-first' && orders.join(',') === expectedOrder.join(',');
        const line = `id=${row.messageId} name=${item.name} media=${item.media.kind} size=${item.size} order=${orders.join(',')} sources=${sources.join(',')} sha256=${results[0].sha}`;
        console.log(same && ordered && item.name === 'm15b-e2e-archive.bin' && item.media.kind === 'file' ? `FILE_OK ${line}` : `FETCH_FILE_FAILED ${line} error=${results[0].error}`);
      }
      if (command === 'SEND_ALBUM') {
        const { row, statements, transactions, calls } = await sendCounted(albumImages.map(sceneFile), 'M15b: an album of four');
        const shas = albumImages.map((scene) => sha256(scene.png));
        const line = `id=${row.messageId} sha256=${shas.join(',')} items=${row.content.items.length} statements_delta=${statements} bulletin_tx_delta=${transactions} store_calls=${calls}`;
        // M15c: the 4 items' chunks go in one store call (in flight together; each item has its own key and nonce).
        console.log(statements === 1 && row.content.items.length === 4 && calls === 1 ? `ALBUM_SENT ${line}` : `SEND_ALBUM_FAILED ${line} (expected one statement and one store call for 4 items)`);
      }
      if (command === 'FETCH_ALBUM') {
        const expected = rest[1].split(',');
        const { row, results, same } = await fetchAll(rest[0], expected);
        const line = `id=${row.messageId} items=${row.content.items.length} kinds=${row.content.items.map((i) => i.media.kind).join(',')} caption="${row.content.caption}" sources=${sources.join(',')} ready=${results.filter((r) => r.status === 'ready').length}`;
        console.log(same && row.content.items.every((i) => i.media.kind === 'image') ? `ALBUM_OK ${line}` : `FETCH_ALBUM_FAILED ${line} errors=${results.map((r) => r.error).join('|')}`);
      }
      if (command === 'SEND_VOICE') {
        // Spec 0012: over 5 minutes is refused before anything is encrypted or stored.
        let refused = 'no';
        try {
          prepareVoice({ bytes: voiceBytes, durationMs: MAX_VOICE_MS + 1, waveform: voiceWaveform });
        } catch (error) {
          refused = /5 minutes/.test(error.message) ? 'yes' : error.message;
        }
        const { row, statements, transactions } = await sendCounted([prepareVoice({ bytes: voiceBytes, durationMs: VOICE_MS, waveform: voiceWaveform })], null);
        const item = row.content.items[0];
        const line = `id=${row.messageId} sha256=${sha256(voiceBytes)} size=${voiceBytes.length} duration_ms=${item.media.durationMs} bars=${item.media.waveform.length} mime="${item.mime}" over_5min_refused=${refused} statements_delta=${statements} bulletin_tx_delta=${transactions}`;
        console.log(statements === 1 && refused === 'yes' ? `VOICE_SENT ${line}` : `SEND_VOICE_FAILED ${line}`);
      }
      if (command === 'FETCH_VOICE') {
        const { row, results, same } = await fetchAll(rest[0], [rest[1]]);
        const item = row.content.items[0];
        const wave = item.media.kind === 'voice' ? item.media.waveform : [];
        const matches = item.media.kind === 'voice' && item.media.durationMs === VOICE_MS && wave.length === 32 && wave.join(',') === voiceWaveform.join(',') && item.mime === VOICE_MIME && item.name === null;
        const line = `id=${row.messageId} media=${item.media.kind} duration_ms=${item.media.durationMs} bars=${wave.length} mime="${item.mime}" sources=${sources.join(',')} sha256=${results[0].sha}`;
        console.log(same && matches ? `VOICE_OK ${line}` : `FETCH_VOICE_FAILED ${line} error=${results[0].error}`);
      }
      if (command === 'SEND_VIDEO') {
        const small = shrink(videoScene.rgba, videoScene.width, videoScene.height);
        const video = {
          bytes: VIDEO.bytes,
          mime: 'video/webm',
          name: VIDEO.name,
          media: { kind: 'video', width: VIDEO.width, height: VIDEO.height, durationMs: VIDEO.durationMs },
          blurhash: encodeBlurhash(small.pixels, small.w, small.h, 4, 3),
          thumbnail: null,
        };
        const { row, statements, transactions } = await sendCounted([video], 'M15c: a short clip');
        const item = row.content.items[0];
        const line = `id=${row.messageId} sha256=${sha256(VIDEO.bytes)} size=${VIDEO.bytes.length} media=${item.media.kind} ${item.media.width}x${item.media.height} duration_ms=${item.media.durationMs} chunks=${item.chunks.length} statements_delta=${statements} bulletin_tx_delta=${transactions}`;
        console.log(statements === 1 && item.media.kind === 'video' ? `VIDEO_SENT ${line}` : `SEND_VIDEO_FAILED ${line}`);
      }
      if (command === 'FETCH_VIDEO') {
        const { row, results, same } = await fetchAll(rest[0], [rest[1]]);
        const item = row.content.items[0];
        const matches = item.media.kind === 'video' && item.media.width === VIDEO.width && item.media.height === VIDEO.height && item.media.durationMs === VIDEO.durationMs && item.name === VIDEO.name && item.mime === 'video/webm' && typeof item.blurhash === 'string';
        const line = `id=${row.messageId} media=${item.media.kind} ${item.media.width}x${item.media.height} duration_ms=${item.media.durationMs} name=${item.name} poster=blurhash(${item.blurhash?.length ?? 0}) order=${orders.join(',')} sources=${sources.join(',')} sha256=${results[0].sha}`;
        console.log(same && matches ? `VIDEO_OK ${line}` : `FETCH_VIDEO_FAILED ${line} error=${results[0].error}`);
      }
      if (command === 'ASK_RESEND') {
        const row = await incomingAttachment(otherHex, rest[0]);
        if (!row) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the attachment message`);
        // "Free space" with 0 days: every decrypted copy of a received attachment goes (b's copy of the image too).
        const freed = await freeLocalCopies(0);
        const local = await getAttachmentRow(rest[0], 0);
        const before = manager.submissions.snapshot().submissions;
        await attachments.askResend(rest[0], 0);
        const asked = (await listMessages(otherHex)).filter((r) => r.direction === 'outgoing' && r.content.type === 'text').at(-1);
        await waitFor(async () => manager.submissions.snapshot().submissions > before, 30_000);
        const line = `id=${rest[0]} freed_files=${freed.files} freed_bytes=${freed.bytes} local=${local?.status}/${local?.bytes ? 'bytes' : 'no-bytes'} text="${asked?.content.text}" statements_delta=${manager.submissions.snapshot().submissions - before}`;
        console.log(local?.status === 'freed' && !local.bytes && parseResendRequest(asked?.content.text ?? '') === rest[0] ? `RESEND_ASKED ${line}` : `ASK_RESEND_FAILED ${line}`);
      }
      if (command === 'RESEND') {
        // a's client sees the request (an incoming text whose link names our message) and stores the same ciphertext again.
        const request = await waitFor(async () => (await listMessages(otherHex)).find((r) => r.direction === 'incoming' && r.content.type === 'text' && parseResendRequest(r.content.text) === rest[0]) ?? null);
        if (!request) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the resend request`);
        const own = await db.messages.get(rest[0]);
        const named = own.content.items.flatMap((item) => item.chunks.map((hash) => hexOf(hash)));
        const before = manager.submissions.snapshot().submissions;
        const result = await attachments.resend(rest[0]);
        const same = result.hashes.join(',') === named.join(',');
        const line = `id=${rest[0]} request="${request.content.text}" chunks=${result.chunks} submitted=${result.submitted} cids_same=${same ? 'yes' : 'no'} cid0=${cidOf(bytesOf(result.hashes[0]))} statements_delta=${manager.submissions.snapshot().submissions - before}`;
        console.log(same && manager.submissions.snapshot().submissions === before ? `RESENT ${line}` : `RESEND_FAILED ${line}`);
      }
      if (command === 'REFETCH') {
        const row = await incomingAttachment(otherHex, rest[0]);
        const item = row.content.items[0];
        sources.length = 0;
        const status = await attachments.fetch(row.messageId, 0, item);
        const local = await getAttachmentRow(row.messageId, 0);
        const got = local?.bytes ? sha256(local.bytes) : 'none';
        const line = `id=${row.messageId} status=${status} cid0=${cidOf(item.chunks[0])} sources=${sources.join(',')} sha256=${got}`;
        console.log(status === 'ready' && got === rest[1] ? `RESEND_OK ${line}` : `REFETCH_FAILED ${line} error=${local?.error}`);
      }
      if (command === 'BOT') {
        const username = rest[0];
        const [base] = username.split('.');
        const hit = (await searchUsernames(NETWORK_PROFILES[profile], base, selfKeys.accountId)).results.find((row) => row.username === username);
        if (!hit) {
          console.log(`BOT_FAILED ${username} not found`);
          continue;
        }
        const botHex = hexOf(hit.accountId);
        if (!(await db.contacts.get(botHex))) {
          const peer = await lookup.getPeerIdentity(hit.accountId);
          if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${username}`);
          await manager.sendRequest(peer, null);
          if (!(await waitFor(() => db.contacts.get(botHex)))) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the bot's accept`);
        }
        // A new contact's greeting arrives after the accept: let it land, so it is not taken for the reply.
        const greeted = await waitFor(async () => (await listMessages(botHex)).some((row) => row.direction === 'incoming'), 45_000);
        console.log(`BOT_CONTACT ${username} greeting_before_send=${greeted ? 'yes' : 'none in 45 s'}`);
        const before = new Set((await listMessages(botHex)).filter((row) => row.direction === 'incoming').map((row) => row.messageId));
        await attachments.send(manager, botHex, [preparedImage()], 'What is in this image? Answer in one short sentence.');
        const sent = (await listMessages(botHex)).filter((row) => row.direction === 'outgoing' && row.content.type === 'attachment').at(-1);
        // Only the bot's texts after the attachment message count; one must say what the image shows. A refusal
        // ends the wait at once; a greeting or a welcome does not count and the wait goes on.
        const size = { width: image.width, height: image.height };
        let after = [];
        const settled = await waitFor(async () => {
          after = repliesAfter(await listMessages(botHex), before);
          return after.find((row) => describesImage(row.content.text, size) || refusesToLook(row.content.text)) ?? null;
        }, 5 * 60_000);
        if (!settled && after.length === 0) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: no bot text after the attachment`);
        const reply = settled ?? after.at(-1);
        const text = reply.content.text.replace(/\s+/g, ' ').slice(0, 160);
        const ok = describesImage(reply.content.text, size);
        if (!ok) {
          for (const row of await listMessages(botHex)) {
            const body = row.content.type === 'text' || row.content.type === 'reply' ? row.content.text.replace(/\s+/g, ' ').slice(0, 100) : row.content.type;
            console.log(`BOT_ROW ${row.direction} at=${new Date(row.timestamp).toISOString()} id=${row.messageId}${before.has(row.messageId) ? ' (before)' : ''} "${body}"`);
          }
        }
        // M15c: a refusal that says the bot's tools are off is the fleet's tool policy "none" (an operator decision), not a desktop fault.
        const pending = !ok && toolsOff(reply.content.text);
        const verdict = ok ? 'BOT_DESCRIBE_OK' : pending ? 'BOT_DESCRIBE_PENDING_OPERATOR tool_policy=none' : 'BOT_DESCRIBE_FAILED';
        console.log(`${verdict} bot=${username} attachment=${sent?.messageId} reply=${reply.messageId} reply_type=${reply.content.type} text="${text}"`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
