#!/usr/bin/env node
// M15a e2e: an encrypted image through the Bulletin chain (spec 0012) between
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
//  4. the bot step (BOT_DESCRIBE_OK) runs only when the pca fleet already runs
//     the pca half of M15a; else BOT_DESCRIBE_SKIPPED with the reason. The
//     fleet is read (its REVISION file), never changed.
// Exit 0 ATTACH_OK; 13 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any
// other failure. Prints no secret (keys stay in the processes).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
const BOT = flag('bot') ?? 'pcdguide.70';
const BOT_WORDS = ['red', 'circle', 'round', 'dot'];
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

  // 4. The bot, only when its half runs on the fleet.
  const bot = botReadiness();
  if (!bot.ready) console.log(`BOT_DESCRIBE_SKIPPED ${bot.reason}`);
  else if (!(await step('a', `BOT ${BOT}`, /^BOT_DESCRIBE_OK /, 'bot describes the image', 6 * 60_000))) return;

  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_000);
  stopAll();
  console.log(`ATTACH_OK at=${at()}${bot.ready ? '' : ' (desktop steps; bot step skipped)'}`);
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
  const { createAttachmentService, getAttachmentRow } = await load('src/renderer/domain/chat/attachments.ts');
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
  const bulletinApi = {
    store: async (uploadId, chunks) => {
      const stored = await service.store(chunks, (step) => {
        for (const listener of progress) listener({ uploadId, ...step });
      });
      for (const entry of stored) console.log(`STORED ${cidOf(bytesOf(entry.hash))} block=${entry.block ?? 'already-on-chain'} best=yes`);
    },
    onProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    fetch: async (chainId, hash, mirror, only) => {
      if (chainId.toLowerCase() !== genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      const result = await service.fetchChunk(bytesOf(hash), mirror, only);
      sources.push(result.source);
      return result;
    },
  };
  attachments = createAttachmentService({ bulletin: bulletinApi, store: { genesis, mirror: null } });

  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
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
        await manager.sendRequest(peer, 'M15a attachments e2e');
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
        const since = Date.now();
        await attachments.send(manager, botHex, [preparedImage()], 'What is in this image? Answer in one short sentence.');
        const reply = await waitFor(async () => {
          const rows = (await listMessages(botHex)).filter((row) => row.direction === 'incoming' && row.timestamp >= since - 60_000 && row.content.type === 'text' && !/^(?:⏳|🤔|✓) /u.test(row.content.text));
          return rows.find((row) => BOT_WORDS.some((word) => row.content.text.toLowerCase().includes(word))) ?? null;
        }, 5 * 60_000);
        if (!reply) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the bot's description`);
        console.log(`BOT_DESCRIBE_OK bot=${username} reply="${reply.content.text.replace(/\s+/g, ' ').slice(0, 120)}"`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
