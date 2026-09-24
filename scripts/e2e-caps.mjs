#!/usr/bin/env node
// M20 e2e (specs 0013 capabilities, 0014 Bulletin FileVariant, HOP send) on devnet,
// through this repo's domain code and main-process chain code (never the owner's
// identity, never the fleet):
//   npm run e2e:caps -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdbenchqmwk] [--pca <polkadot-chat-agents checkout>]
//
// Each person is a child process (`--role a|b`), as in e2e-attach.mjs. Every
// message each child encodes and decodes is recorded (a spy on the app's
// `ChatMessageCodec`), so the checks read the wire, not the rows.
//  (a) desktop a ↔ desktop b: a chat; b says hello and its `capabilities`
//      ride that text; a answers and its own ride along (CAPS_EXCHANGED, one
//      set each way, no extra statement). a sends a photo: on b's wire it is
//      `RichText` + `FileVariant.bulletin` (variant 1), b fetches it from
//      Bulletin and the SHA-256 matches (RAIL_BULLETIN_OK). b reads it; its
//      `seen` reaches a (SEEN_OK).
//  (b) desktop a → a baseline peer: a throwaway pca echo bot in a scratch
//      PCA_BOTS_DIR, run with BOT_PROTOCOL_EXTENSIONS=none (no botInfo, no
//      capabilities). a says hello (its set rides, once), reads the echo, and
//      sends a photo: it goes over HOP (`RichText` + `P2PMixnet`, the phones'
//      ChaCha20-Poly1305 and versioned root, signed by a's Bulletin key). The
//      entry is claimed read-only from the node and matches (HOP_SEND_OK). A
//      keyboard goes as text. Nothing a encoded for the bot is `seen`,
//      `typing` or `buttons`; submissions are counted; the bot's log is shown
//      (BASELINE_OK).
//  (c) multi-device: a second device cannot be registered for a test
//      identity on devnet (the statement allowance comes only from the
//      identity backend's attestation, docs/spec/efficiency.md), so the
//      domain test of the real manager and attachment service with a
//      two-device roster runs here (MULTI_DEVICE_DOMAIN_OK; not live).
// Exit 0 CAPS_OK; 13 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any other
// failure. Prints no secret (tickets and keys stay in the processes).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { drawTestImage, shrink } from './lib/testImage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const role = flag('role');
const TIMEOUT_EXIT = 13;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const identityFile = (name) => join(root, '.agent-runs', `identity-${name}`, 'identity.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (role) await child(role);
else await parent();

// ── The parent ─────────────────────────────────────────────────────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 5 * 60_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdbenchqmwk' };
  const saved = {};
  for (const [name, identity] of Object.entries(identities)) {
    if (!existsSync(identityFile(identity))) {
      console.log(`NO_IDENTITY ${identityFile(identity)} (npm run identity:register -- <letters>)`);
      process.exit(1);
    }
    const { username, accountHex, profile: saidProfile } = JSON.parse(readFileSync(identityFile(identity), 'utf8'));
    if (saidProfile !== profile) {
      console.log(`IDENTITY_PROFILE_MISMATCH ${identity} file=${saidProfile} run=${profile}`);
      process.exit(1);
    }
    saved[name] = { username, accountHex };
  }
  const pcaRoot = resolve(flag('pca') ?? join(root, '..', 'polkadot-chat-agents'));
  const pcaCli = join(pcaRoot, 'bot-core', 'cli.mjs');
  if (!existsSync(pcaCli)) {
    console.log(`NO_PCA ${pcaCli} (pass --pca <polkadot-chat-agents checkout>)`);
    process.exit(1);
  }

  const people = {};
  let failing = false;
  let botProc = null;
  const botsDir = mkdtempSync(join(tmpdir(), 'pcd-e2e-caps-bots-'));
  const stopAll = () => {
    for (const person of Object.values(people)) if (person.proc.exitCode === null) person.proc.kill('SIGTERM');
    if (botProc && botProc.exitCode === null) {
      try {
        process.kill(-botProc.pid, 'SIGTERM');
      } catch {
        botProc.kill('SIGTERM');
      }
    }
    rmSync(botsDir, { recursive: true, force: true });
  };
  const fail = (code, line) => {
    if (failing) return new Promise(() => undefined);
    failing = true;
    console.log(line);
    stopAll();
    setTimeout(() => process.exit(code), 1_500);
    return new Promise(() => undefined);
  };
  process.on('SIGINT', () => void fail(130, 'INTERRUPTED'));

  for (const [name, identity] of Object.entries(identities)) {
    const other = saved[name === 'a' ? 'b' : 'a'];
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identity, '--profile', profile, '--other', other.accountHex, '--other-name', other.username], {
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
    createInterface({ input: proc.stderr }).on('line', (line) => {
      if (!/ExperimentalWarning|--trace-warnings/.test(line)) console.log(`[${name}:err] ${line.slice(0, 300)}`);
    });
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      const last = person.lines.at(-1) ?? '';
      void fail(/^E2E_TIMEOUT/.test(last) ? TIMEOUT_EXIT : code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${last}"`);
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
    if (!line) return fail(TIMEOUT_EXIT, `E2E_TIMEOUT ${stage}`);
    if (/^[A-Z_]+_FAILED /.test(line)) return fail(1, `${stage}: ${line}`);
    return line;
  };

  const ready = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^READY /, READY_WAIT_MS)));
  if (ready.some((line) => line === null)) await fail(TIMEOUT_EXIT, 'E2E_TIMEOUT both people ready (connect)');
  console.log(`PEOPLE a=${saved.a.username} b=${saved.b.username} at=${at()}`);

  // (a) Two desktops.
  const requested = await step('a', 'REQUEST_OTHER', /^CHAT_REQUEST_SENT /, 'chat request');
  await step('b', `ACCEPT ${field(requested, 'id')}`, /^ACCEPTED /, 'accept');
  await step('a', 'WAIT_CONTACT', /^CONTACT /, 'contact on a');
  await step('b', 'SAY hello from b', /^SAID /, 'b says hello');
  await step('a', 'WAIT_CAPS', /^CAPS_KNOWN rail=bulletin/, "b's capabilities on a");
  await step('a', 'SAY hello from a', /^SAID /, 'a answers');
  await step('b', 'WAIT_CAPS', /^CAPS_KNOWN rail=bulletin/, "a's capabilities on b");
  const exchangedA = await step('a', 'CAPS_SENT', /^CAPS_SENT /, 'a counts its sets');
  const exchangedB = await step('b', 'CAPS_SENT', /^CAPS_SENT /, 'b counts its sets');
  if (field(exchangedA, 'sets') !== '1' || field(exchangedB, 'sets') !== '1') await fail(1, `CAPS_FAILED each side sends its set once: a=${field(exchangedA, 'sets')} b=${field(exchangedB, 'sets')}`);
  console.log(`CAPS_EXCHANGED a→b sets=1 b→a sets=1 a_statements_for_hello=${field(exchangedA, 'hello_statements')} at=${at()}`);
  await step('a', 'AUTH', /^AUTH_OK /, 'Bulletin authorization');
  const sent = await step('a', 'SEND_PHOTO', /^PHOTO_SENT /, 'photo to b');
  await step('b', `FETCH_PHOTO ${field(sent, 'id')} ${field(sent, 'sha256')}`, /^RAIL_BULLETIN_OK /, 'b fetches the variant-1 photo');
  await step('b', 'READ', /^READ /, 'b reads');
  await step('a', `WAIT_SEEN ${field(sent, 'id')}`, /^SEEN_OK /, "b's seen on a", 60_000);

  // (b) A baseline peer: a pca echo bot with every extension off.
  const botName = `pcdcaps${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir };
  console.log(`BOT_CREATE ${botName} (scratch PCA_BOTS_DIR, brain echo, allow ${saved.a.username}) at=${at()}`);
  const created = spawnSync(process.execPath, [pcaCli, 'create', botName, '--brain', 'echo', '--allow', saved.a.accountHex, '--network', profile, '--wait', '180'], {
    cwd: pcaRoot,
    env: pcaEnv,
    encoding: 'utf8',
    timeout: 6 * 60_000,
  });
  const botConfigFile = join(botsDir, botName, 'config.json');
  const botConfig = existsSync(botConfigFile) ? JSON.parse(readFileSync(botConfigFile, 'utf8')) : null;
  if (created.status !== 0 || !botConfig?.registered) {
    for (const line of `${created.stdout ?? ''}${created.stderr ?? ''}`.trim().split('\n').slice(-8)) console.log(`[pca] ${line}`);
    await fail(1, `BOT_CREATE_FAILED status=${created.status}`);
  }
  const botHex = `0x${String(botConfig.account).replace(/^0x/, '')}`;
  console.log(`BOT_REGISTERED ${botConfig.username} ${botHex} at=${at()}`);
  // Every extension off: no botInfo, no seen, no buttons, no capabilities (pca today sends none anyway).
  botProc = spawn(process.execPath, [pcaCli, 'run', botName], { cwd: pcaRoot, env: { ...pcaEnv, BOT_PROTOCOL_EXTENSIONS: 'none' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const botLines = [];
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const onBotLine = (line) => botLines.push(line.replace(ANSI, ''));
  createInterface({ input: botProc.stdout }).on('line', onBotLine);
  createInterface({ input: botProc.stderr }).on('line', onBotLine);
  const until = Date.now() + 60_000;
  while (!botLines.some((line) => /BOT_STARTING/.test(line)) && Date.now() < until) await delay(250);
  if (!botLines.some((line) => /BOT_STARTING/.test(line))) await fail(TIMEOUT_EXIT, 'E2E_TIMEOUT the scratch bot starts');
  const botFrom = botLines.length;
  const baseline = await step('a', `BASELINE ${botHex}`, /^BASELINE_OK /, 'a and the baseline bot', 8 * 60_000);
  const seenByBot = botLines.slice(botFrom).filter((line) => /unsupported|attach|HOP|richText|file|p2p|capabilit|kind|RECEIVED|MESSAGE/i.test(line));
  for (const line of seenByBot.slice(0, 30)) console.log(`[bot] ${line.slice(0, 240)}`);
  console.log(`BOT_LOG lines=${botLines.length - botFrom} shown=${Math.min(30, seenByBot.length)}`);

  // (c) Multi-device: the domain test (not live; see the header).
  const domain = spawnSync('npx', ['vitest', 'run', 'src/renderer/domain/chat/attachments.spec.ts', '-t', 'silent phone'], { cwd: root, encoding: 'utf8', timeout: 5 * 60_000 });
  const passed = /Tests\s+1 passed/.test(domain.stdout ?? '') && domain.status === 0;
  if (!passed) await fail(1, `MULTI_DEVICE_FAILED ${(domain.stdout ?? '').split('\n').filter((line) => /Tests|×|FAIL/.test(line)).join(' | ')}`);
  console.log('MULTI_DEVICE_DOMAIN_OK a peer with a capable desktop and a silent phone gets HOP on both devices; after deviceRemoved, the Bulletin variant (domain test, not live)');

  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_000);
  stopAll();
  console.log(`CAPS_OK CAPS_EXCHANGED RAIL_BULLETIN_OK SEEN_OK HOP_SEND_OK BASELINE_OK MULTI_DEVICE_DOMAIN_OK ${baseline.replace(/^BASELINE_OK /, '')} at=${at()}`);
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

  const { ChatMessageCodec } = await load('src/renderer/domain/chat/identityEvents.ts');
  // The wire, as this process writes and reads it: one entry per message id.
  const wireOut = new Map();
  const wireIn = new Map();
  const describe = (message) => {
    const content = message.versioned.value;
    const files = content.tag === 'richText' ? (content.value.attachments ?? []).map((file) => file.tag) : [];
    return { id: message.messageId, tag: content.tag, files, at: Date.now() };
  };
  const encode = ChatMessageCodec.enc;
  const decode = ChatMessageCodec.dec;
  ChatMessageCodec.enc = (message) => {
    if (!wireOut.has(message.messageId)) wireOut.set(message.messageId, describe(message));
    return encode(message);
  };
  ChatMessageCodec.dec = (bytes) => {
    const message = decode(bytes);
    if (!wireIn.has(message.messageId)) wireIn.set(message.messageId, describe(message));
    return message;
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
  const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
  const { listMessages } = await load('src/renderer/domain/chat/messages.ts');
  const { openBulletin, createBulletinService, bulletinSigner } = await load('src/main/chain/bulletin.ts');
  const { createAttachmentService, getAttachmentRow } = await load('src/renderer/domain/chat/attachments.ts');
  const { hopTicket } = await load('src/renderer/domain/chat/attachmentKeyStore.ts');
  const { openHopRpc, fetchHopFile, resolveHopNode } = await load('src/main/chain/hop.ts');
  const { encodeBlurhash } = await load('src/renderer/domain/chat/blurhash.ts');

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

  const file = identityFile(identityName);
  if (!existsSync(file)) finish(1, `NO_IDENTITY ${file}`);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
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
  const service = createBulletinService(chain, bulletinSigner(saved.mnemonic), { log: (line) => console.log(line) });
  const genesis = chain.genesis;
  const progress = new Set();
  const bulletinApi = {
    store: async (uploadId, chunks) => {
      const { storeResultOf } = await load('src/main/chain/bulletin.ts');
      const stored = await service.store(chunks, (step) => {
        for (const listener of progress) listener({ uploadId, ...step });
      });
      return storeResultOf(stored, chunks);
    },
    onProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    fetch: async (chainId, hash, mirror, only, preferGateway) => {
      if (chainId.toLowerCase() !== genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      return service.fetchChunk(bytesOf(hash), mirror, only, preferGateway);
    },
  };
  // Main's HOP client as the IPC seam: send signs with this identity's Bulletin key.
  const hopApi = {
    send: (bytes) => service.sendHop(bytes),
    fetch: async () => ({ ok: false, reason: 'network', message: 'not used here' }),
    ack: async () => ({ acked: 0, notFound: 0, failed: 0 }),
    onProgress: () => () => undefined,
  };

  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  attachments = createAttachmentService({ bulletin: bulletinApi, store: { genesis, mirror: null }, chat: manager, hop: hopApi });
  console.log(`READY username=${saved.username} bulletin=${service.address}`);

  const image = drawTestImage();
  const preparedImage = () => {
    const small = shrink(image.rgba, image.width, image.height);
    return { bytes: image.png, mime: 'image/png', name: null, media: { kind: 'image', width: image.width, height: image.height }, blurhash: encodeBlurhash(small.pixels, small.w, small.h, 4, 3), thumbnail: null };
  };
  const sentTags = (from) => [...wireOut.values()].filter((entry) => entry.at >= from);
  const capsSets = () => [...wireOut.values()].filter((entry) => entry.tag === 'capabilities').length;
  const counts = () => manager.submissions.snapshot().submissions;
  const settle = async (before) => {
    await waitFor(async () => counts() > before, 30_000);
    await delay(1_500);
    return counts() - before;
  };

  let helloStatements = 0;
  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await lookup.getPeerIdentity(bytesOf(otherHex));
        if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${otherName}`);
        await manager.sendRequest(peer, null);
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
      if (command === 'SAY') {
        const before = counts();
        await manager.sendMessage(otherHex, { type: 'text', text: rest.join(' ') });
        helloStatements = await settle(before);
        console.log(`SAID ${rest.join(' ')} statements=${helloStatements}`);
      }
      if (command === 'WAIT_CAPS') {
        const rail = await waitFor(async () => ((await db.peerCapabilities.where('peer').equals(otherHex).count()) > 0 ? manager.attachmentRail(otherHex) : null));
        if (!rail) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the peer's capabilities`);
        const row = (await db.peerCapabilities.where('peer').equals(otherHex).toArray())[0];
        console.log(`CAPS_KNOWN rail=${rail} device=${row.device.slice(0, 10)}… variants=${row.caps.fileVariants.join(',')} dialects=${row.caps.hopDialects.join(',')} features=${row.caps.features}`);
      }
      if (command === 'CAPS_SENT') console.log(`CAPS_SENT sets=${capsSets()} hello_statements=${helloStatements}`);
      if (command === 'AUTH') {
        const allowance = await service.ensureBudget([image.png.length + 16]);
        console.log(`AUTH_OK account=${service.address} transactions_left=${allowance.transactionsLeft} bytes_left=${allowance.bytesLeft}`);
      }
      if (command === 'SEND_PHOTO') {
        const before = counts();
        const from = Date.now();
        await attachments.send(manager, otherHex, [preparedImage()], 'M20: a photo, as the Bulletin variant');
        const statements = await settle(before);
        const row = (await listMessages(otherHex)).filter((r) => r.direction === 'outgoing' && r.content.type === 'attachment').at(-1);
        const wire = wireOut.get(row.messageId);
        const line = `id=${row.messageId} sha256=${sha256(image.png)} wire=${wire?.tag}/${wire?.files.join(',')} statements=${statements} others=${sentTags(from).filter((e) => e.id !== row.messageId).map((e) => e.tag).join(',') || 'none'}`;
        console.log(wire?.tag === 'richText' && wire.files.join(',') === 'bulletin' && statements === 1 ? `PHOTO_SENT ${line}` : `SEND_PHOTO_FAILED ${line}`);
      }
      if (command === 'FETCH_PHOTO') {
        const row = await waitFor(async () => (await listMessages(otherHex)).find((r) => r.direction === 'incoming' && r.messageId === rest[0]) ?? null);
        if (!row) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the photo`);
        const wire = wireIn.get(rest[0]);
        const status = await attachments.fetch(row.messageId, 0, row.content.items[0]);
        const local = await getAttachmentRow(row.messageId, 0);
        const got = local?.bytes ? sha256(local.bytes) : 'none';
        const line = `id=${row.messageId} wire=${wire?.tag}/${wire?.files.join(',')} row=${row.content.type} status=${status} sha256=${got}`;
        console.log(wire?.tag === 'richText' && wire.files.join(',') === 'bulletin' && row.content.type === 'attachment' && got === rest[1] ? `RAIL_BULLETIN_OK ${line}` : `FETCH_PHOTO_FAILED ${line} error=${local?.error}`);
      }
      if (command === 'READ') {
        await manager.markRead(otherHex);
        console.log('READ the room is read; the seen goes when the 5 s window ends');
      }
      if (command === 'WAIT_SEEN') {
        const seen = await waitFor(async () => (await db.messages.get(rest[0]))?.seenAt, 45_000);
        const seenWire = [...wireIn.values()].some((entry) => entry.tag === 'seen');
        console.log(seen && seenWire ? `SEEN_OK id=${rest[0]} seen_at=${new Date(seen).toISOString()}` : `SEEN_FAILED seen=${seen ?? 'none'} seen_on_wire=${seenWire}`);
      }
      if (command === 'BASELINE') {
        const botHex = rest[0];
        const from = Date.now();
        const setsBefore = capsSets();
        const peer = await waitFor(() => lookup.getPeerIdentity(bytesOf(botHex)).catch(() => null), 60_000);
        if (!peer) finish(3, 'PEER_KEY_UNSUPPORTED the scratch bot');
        await manager.sendRequest(peer, null);
        const contact = await waitFor(() => db.contacts.get(botHex), 3 * 60_000);
        if (!contact) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the bot's accept`);
        await delay(8_000);
        const info = await db.peerInfo.get(botHex);
        const rail = await manager.attachmentRail(botHex);
        console.log(`BOT_CONTACT ${contact.username} botInfo=${info?.botInfo ? 'yes' : 'none'} rail=${rail}`);
        if (rail !== 'hop') finish(1, `BASELINE_FAILED the bot is not a baseline peer (rail=${rail})`);
        // A text: our set rides it, once.
        let before = counts();
        await manager.sendMessage(botHex, { type: 'text', text: 'hello, baseline bot' });
        const textStatements = await settle(before);
        const echo = await waitFor(async () => (await listMessages(botHex)).find((r) => r.direction === 'incoming' && (r.content.type === 'text' || r.content.type === 'reply') && /baseline bot/.test(r.content.text)) ?? null, 90_000);
        console.log(`BOT_ECHO ${echo ? 'yes' : 'none in 90 s'} text_statements=${textStatements}`);
        // A pending seen (the room is read): it must not ride the photo nor go alone.
        await manager.markRead(botHex);
        before = counts();
        await attachments.send(manager, botHex, [preparedImage()], 'M20: a photo over HOP');
        const photoStatements = await settle(before);
        const row = (await listMessages(botHex)).filter((r) => r.direction === 'outgoing' && r.content.type === 'richText').at(-1);
        const attachment = row?.content.attachments[0];
        const wire = row ? wireOut.get(row.messageId) : undefined;
        // The entry is on the node: claim it read-only (no ack, so the bot can still claim) and compare.
        let claimed = 'not tried';
        let layout = '';
        if (attachment?.hop?.node) {
          const ticket = await hopTicket(row.messageId, 0, attachment);
          const rpc = await openHopRpc(resolveHopNode(attachment.hop.node));
          try {
            const fetched = await fetchHopFile({ rpc, identifier: bytesOf(attachment.hop.identifier), ticket });
            claimed = sha256(fetched.bytes) === sha256(image.png) ? 'match' : 'differs';
            layout = `${fetched.cipher}/${fetched.layout}/${fetched.entries.length}entries`;
          } catch (error) {
            claimed = error.reason ?? String(error);
          } finally {
            rpc.close();
          }
        }
        const hopLine = `id=${row?.messageId} wire=${wire?.tag}/${wire?.files.join(',')} node=${attachment?.hop?.node ? new URL(attachment.hop.node).hostname : 'none'} claim=${claimed} ${layout} photo_statements=${photoStatements}`;
        if (wire?.tag !== 'richText' || wire.files.join(',') !== 'p2pMixnet' || claimed !== 'match') finish(1, `HOP_SEND_FAILED ${hopLine}`);
        console.log(`HOP_SEND_OK ${hopLine}`);
        // A keyboard: the menu as text.
        before = counts();
        await manager.sendButtons(botHex, { text: 'Pick one', rows: [[{ label: 'Red', action: { tag: 'command', value: 'red' } }, { label: 'Blue', action: { tag: 'command', value: 'blue' } }]], oneShot: true });
        const buttonStatements = await settle(before);
        // Past the 5 s seen window: nothing more goes.
        const quiet = counts();
        await delay(7_000);
        const late = counts() - quiet;
        const tags = sentTags(from).map((entry) => (entry.tag === 'richText' ? `richText(${entry.files.join(',')})` : entry.tag));
        const forbidden = tags.filter((tag) => ['seen', 'typing', 'buttons', 'botInfo', 'deleted', 'attachment', 'transactionReference'].includes(tag) || tag === 'richText(bulletin)');
        const sets = capsSets() - setsBefore;
        const line = `sent=${tags.join(',')} sets=${sets} statements=text:${textStatements},photo:${photoStatements},buttons:${buttonStatements},after_window:${late}`;
        console.log(forbidden.length === 0 && sets === 1 && late === 0 ? `BASELINE_OK ${line}` : `BASELINE_FAILED ${line} forbidden=${forbidden.join(',') || 'none'}`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

