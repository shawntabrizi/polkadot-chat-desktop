#!/usr/bin/env node
// HOP receive e2e on devnet: a throwaway pca bot sends a PNG over HOP (the
// phone apps' rail) to a desktop test identity, and this repo's code
// receives it.
//   npm run e2e:hop -- [--profile devnet] [--identity pcdbenchzzlx] [--pca <polkadot-chat-agents checkout>]
//
//  1. BOT_REGISTERED: `pca create <name> --brain echo --allow <desktop>` in a
//     scratch PCA_BOTS_DIR. On devnet pca turns on HOP file delivery for a
//     private bot and gets its `//allowance//bulletin//chat` account a Bulletin
//     grant from the public faucet. Never a fleet bot, never the owner's
//     identity; the folder is deleted at the end.
//  2. The PNG (drawn here, ~2.7 MB, two HOP chunks) goes into the bot's file
//     vault for the desktop identity with bot-core's own `createFileStore`,
//     before `pca run`.
//  3. The desktop (the renderer's domain code over fake-indexeddb, the main
//     process's HOP client in this process) opens a chat with the bot and
//     sends `/file get hop-e2e.png`. pca's `sendAttachment` → `uploadP2PFile`
//     puts the file on its HOP node and sends a `richText` with a
//     `P2PMixnet` attachment (HOP_MESSAGE).
//  4. The attachment service claims, checks, decrypts and persists it, then
//     acks each entry (HOP_RECEIVE_OK with the SHA-256, the cipher and the
//     root layout the sender used).
//  5. A second claim of the root now answers NotFound: the ack removed the
//     entries from the node (HOP_ACK_OK).
//  6. RFC-0001 chain fallback: the bot sends a second, small file; before the
//     desktop claims it, a second recipient device (the same ticket on its
//     own connection, as a phone of the same identity would) claims and acks
//     it. The desktop's claim then answers NotFound, so it asks the node's
//     `bitswap_v1_get` and the Bulletin fetch (bitswap, then gateway), acks
//     nothing, and keeps the row `fetchingChain` (HOP_CHAIN_FALLBACK_OK).
//     The file cannot arrive here: the pool deletes an acked entry without
//     promotion (RFC-0001 "Known issues"), and promotion of an unacked one
//     runs only near its 24 h expiry. So arrival from chain storage is
//     HOP_CHAIN_FALLBACK_PENDING live and covered by src/main/chain/hop.spec.ts.
// Exit 0 HOP_OK; 13 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any
// other failure. Prints no secret (the ticket stays in this process).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { drawTestImage } from './lib/testImage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const identityName = flag('identity') ?? 'pcdbenchzzlx';
const TIMEOUT_EXIT = 13;
const BOT_WAIT_MS = 3 * 60_000;
const FILE_NAME = 'hop-e2e.png';
const SECOND_FILE_NAME = 'hop-e2e-second.png';

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

const pcaRoot = resolve(flag('pca') ?? join(root, '..', 'polkadot-chat-agents'));
const pcaCli = join(pcaRoot, 'bot-core', 'cli.mjs');
if (!existsSync(pcaCli)) {
  console.log(`NO_PCA ${pcaCli} (pass --pca <polkadot-chat-agents checkout>)`);
  process.exit(1);
}
const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
if (!existsSync(identityFile)) {
  console.log(`NO_IDENTITY ${identityFile}`);
  process.exit(1);
}
const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
if (saved.profile !== profile) {
  console.log(`IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
  process.exit(1);
}

// ── The scratch bot ─────────────────────────────────────────────────────────
const botsDir = mkdtempSync(join(tmpdir(), 'pcd-e2e-hop-bots-'));
const botName = `pcdhop${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir };
let botProc = null;
let manager = null;
let disposeConnection = () => undefined;
const cleanup = () => {
  if (botProc && botProc.exitCode === null) {
    try {
      process.kill(-botProc.pid, 'SIGTERM');
    } catch {
      botProc.kill('SIGTERM');
    }
  }
  rmSync(botsDir, { recursive: true, force: true });
  try {
    manager?.dispose();
  } catch {
    // closing anyway
  }
  disposeConnection();
};
/** Prints the last line, cleans up and exits, once; awaiting it stops the script there. */
let finishing = false;
const finish = (code, line) => {
  if (finishing) return new Promise(() => undefined);
  finishing = true;
  console.log(line);
  cleanup();
  setTimeout(() => process.exit(code), 500);
  return new Promise(() => undefined);
};
process.on('SIGINT', () => void finish(130, 'INTERRUPTED'));
// A crash still stops the bot and deletes its folder.
process.on('uncaughtException', (error) => void finish(1, `HOP_FAILED ${error instanceof Error ? error.stack : String(error)}`));
process.on('unhandledRejection', (error) => void finish(1, `HOP_FAILED ${error instanceof Error ? error.stack : String(error)}`));

console.log(`BOT_CREATE ${botName} (scratch PCA_BOTS_DIR, brain echo, allow ${saved.username}) at=${at()}`);
const created = spawnSync(process.execPath, [pcaCli, 'create', botName, '--brain', 'echo', '--allow', saved.accountHex, '--network', profile, '--wait', '180'], {
  cwd: pcaRoot,
  env: pcaEnv,
  encoding: 'utf8',
  timeout: 6 * 60_000,
});
const botConfigFile = join(botsDir, botName, 'config.json');
const botConfig = existsSync(botConfigFile) ? JSON.parse(readFileSync(botConfigFile, 'utf8')) : null;
if (created.status !== 0 || !botConfig?.registered) {
  console.log(`BOT_CREATE_FAILED status=${created.status} registered=${botConfig?.registered ?? 'no config'}`);
  for (const line of `${created.stdout ?? ''}${created.stderr ?? ''}`.trim().split('\n').slice(-8)) console.log(`[pca] ${line}`);
  await finish(1, 'HOP_FAILED the scratch bot was not made');
}
if (!botConfig.fileDelivery) {
  for (const line of `${created.stdout ?? ''}`.trim().split('\n').slice(-6)) console.log(`[pca] ${line}`);
  await finish(1, 'HOP_FAILED pca did not turn on HOP file delivery for the bot');
}
const bot = { username: botConfig.username, accountHex: `0x${String(botConfig.account).replace(/^0x/, '')}` };
console.log(`BOT_REGISTERED ${bot.username} ${bot.accountHex} files=${botConfig.fileDelivery.profile} at=${at()}`);

/**
 * `TransactionStorage.authorize_account(who, 10, 8 MiB)` by //Eve on the devnet Bulletin chain, done at a
 * best block. Small: on 2026-09-24 //Eve's authorizer budget refused 64 MiB (InsufficientAuthorizerBudget).
 */
async function grantOnDevnet(who) {
  if (profile !== 'devnet') return 'not devnet';
  const { register: registerTs } = await import('tsx/esm/api');
  registerTs();
  const { openBulletin, assertDevnetBulletin } = await import(pathToFileURL(join(root, 'src/main/chain/bulletin.ts')).href);
  const { devPair } = await import(pathToFileURL(join(root, 'src/main/chain/faucet.ts')).href);
  const { getTxCreator } = await import('polkadot-api/tx-creator');
  const { ss58Address } = await import('@polkadot-labs/hdkd-helpers');
  const { setMetadataCacheDir } = await import(pathToFileURL(join(root, 'src/main/metadataCache.ts')).href);
  setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
  const chain = await openBulletin('devnet');
  try {
    assertDevnetBulletin(chain.genesis);
    const eve = devPair('Eve');
    const tx = chain.api.tx.TransactionStorage.authorize_account({ who: ss58Address(bytesOf(who)), transactions: 10, bytes: 8n * 1024n * 1024n });
    return await new Promise((done) => {
      const timer = setTimeout(() => done('timeout'), 90_000);
      const subscription = tx.createSubmitAndWatch(getTxCreator(eve.publicKey, 'Sr25519', eve.sign)).subscribe({
        next: (event) => {
          if (event.type !== 'inBestBlock') return;
          clearTimeout(timer);
          subscription.unsubscribe();
          done(event.ok ? `granted in best block #${event.block.number}` : `grant failed: ${JSON.stringify(event.dispatchError?.value ?? null)}`);
        },
        error: (error) => {
          clearTimeout(timer);
          done(`grant failed: ${error?.message ?? error}`);
        },
      });
    });
  } finally {
    chain.destroy();
  }
}

// pca colours its terminal output.
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
// The bot's HOP upload key needs a Bulletin authorization (hop_submit answers 1012 without one).
// `pca create` asks the faucet once; when that did not land, pca's own `storage grant` asks again.
const pcaSays = (output) => `${output.stdout ?? ''}${output.stderr ?? ''}`.split('\n').filter((line) => /storage:|allowance/i.test(line)).map((line) => line.replace(ANSI_COLOUR, '').trim());
const storage = (action) => spawnSync(process.execPath, [pcaCli, 'storage', botName, action], { cwd: pcaRoot, env: pcaEnv, encoding: 'utf8', timeout: 3 * 60_000 });
for (const line of pcaSays(created)) console.log(`[pca create] ${line}`);
let allowance = pcaSays(storage('status')).find((line) => line.startsWith('storage:')) ?? 'storage: unknown';
if (!/^storage:\s+active/.test(allowance)) {
  // pca's faucet step can end "may have accepted" and then guard against a retry. Devnet only: the
  // public dev key //Eve grants the bot's allowance account, the same call this app's Bulletin
  // service makes for its own account (src/main/chain/bulletin.ts, M15a).
  console.log(`BOT_STORAGE ${allowance}; //Eve grants it on devnet at=${at()}`);
  const granted = await grantOnDevnet(botConfig.bulletinAccount);
  console.log(`BOT_STORAGE //Eve: ${granted} at=${at()}`);
  allowance = granted.startsWith('granted') ? `storage: active (${granted})` : (pcaSays(storage('status')).find((line) => line.startsWith('storage:')) ?? 'storage: unknown');
}
console.log(`BOT_STORAGE ${allowance} at=${at()}`);
if (!/^storage:\s+active/.test(allowance)) {
  console.log('HOP_CHAIN_FALLBACK_PENDING step 6 not run: the scratch bot has no Bulletin authorization, so it cannot hop_submit; covered by src/main/chain/hop.spec.ts');
  await finish(1, 'HOP_FAILED the bot has no Bulletin authorization for hop_submit');
}

// ── The file, into the bot's vault for the desktop identity (bot-core's own store) ──
const png = drawTestImage(1100, 900).png;
const { createFileStore } = await import(pathToFileURL(join(pcaRoot, 'bot-core', 'lib', 'file-store.mjs')).href);
createFileStore({ dir: join(botsDir, botName, 'files') }).putBytes(saved.accountHex, FILE_NAME, png, { mime: 'image/png' });
console.log(`FILE_SEEDED ${FILE_NAME} bytes=${png.length} sha256=${sha256(png)}`);
// Step 6: small, so it sits inline in one entry.
const secondPng = drawTestImage(160, 120).png;
createFileStore({ dir: join(botsDir, botName, 'files') }).putBytes(saved.accountHex, SECOND_FILE_NAME, secondPng, { mime: 'image/png' });
console.log(`FILE_SEEDED ${SECOND_FILE_NAME} bytes=${secondPng.length}`);

botProc = spawn(process.execPath, [pcaCli, 'run', botName], { cwd: pcaRoot, env: pcaEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const botLines = [];
const onBotLine = (line) => {
  botLines.push(line);
  if (/BOT_STARTING|BOT_HOP_UPLOAD_CONFIGURED|HOP_UPLOADED|BOT_SENT_FILE|BOT_FILE_DELIVER|_FAILED|ERROR/.test(line)) console.log(`[bot] ${line.slice(0, 220)}`);
};
createInterface({ input: botProc.stdout }).on('line', onBotLine);
createInterface({ input: botProc.stderr }).on('line', onBotLine);
const waitFor = async (probe, timeoutMs, everyMs = 1_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await delay(everyMs);
  }
  return null;
};
if (!(await waitFor(() => botLines.some((line) => /BOT_STARTING/.test(line)), 60_000, 250))) await finish(TIMEOUT_EXIT, 'E2E_TIMEOUT the scratch bot starts');

// ── The desktop ─────────────────────────────────────────────────────────────
await import('fake-indexeddb/auto');
const { register } = await import('tsx/esm/api');
register();
const load = (path) => import(pathToFileURL(join(root, path)).href);
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
const { createAttachmentService, getAttachmentRow, hopItemOf } = await load('src/renderer/domain/chat/attachments.ts');
const { hopTicket } = await load('src/renderer/domain/chat/attachmentKeyStore.ts');
const { hopFetch, hopAck, openHopRpc, fetchHopFile, resolveHopNode } = await load('src/main/chain/hop.ts');

setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
setMetadataCache(metadataCache());

const selfKeys = deriveIdentityKeys(saved.mnemonic);
if (hexOf(selfKeys.accountId) !== saved.accountHex) await finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
disposeConnection = disposePeopleConnection;
try {
  await retryOnNextEndpoint(() => awaitBestRuntime(connection.lazyClient.getClient()), connection.switchEndpoint);
} catch (error) {
  await finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
await seedSelfIdentity(
  { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
  selfKeys.accountId,
);
const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
const lookup = createIdentityLookup(connection);
manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
console.log(`READY desktop=${saved.username} at=${at()}`);

// A fresh registration, and a People RPC that can drop a head subscription: ask again for a minute.
const botPeer = await waitFor(() => lookup.getPeerIdentity(bytesOf(bot.accountHex)).catch(() => null), 60_000, 3_000);
if (!botPeer) await finish(3, 'PEER_KEY_UNSUPPORTED the scratch bot');
await manager.sendRequest(botPeer, null);
const contact = await waitFor(() => db.contacts.get(bot.accountHex), BOT_WAIT_MS);
if (!contact) await finish(TIMEOUT_EXIT, 'E2E_TIMEOUT the bot accepts the chat');
console.log(`BOT_CONTACT ${contact.username} at=${at()}`);

/** Asks the bot for `name` and waits for a new `richText` with an attachment (not one of `seen`). */
const askForFile = async (name, seen = new Set()) => {
  const askedAt = Date.now();
  const botFrom = botLines.length;
  await manager.sendMessage(bot.accountHex, { type: 'text', text: `/file get ${name}` });
  console.log(`ASKED /file get ${name} at=${at()}`);
  return waitFor(
    async () => {
      const refused = botLines.slice(botFrom).find((line) => /BOT_FILE_DELIVERY_FAILED/.test(line));
      if (refused) await finish(1, `HOP_FAILED the bot could not send: ${refused.slice(0, 200)}`);
      return (await listMessages(bot.accountHex)).find(
        (row) => row.direction === 'incoming' && row.content.type === 'richText' && row.content.attachments.length > 0 && row.timestamp >= askedAt - 60_000 && !seen.has(row.messageId),
      ) ?? null;
    },
    BOT_WAIT_MS,
  );
};
const message = await askForFile(FILE_NAME);
if (!message) await finish(TIMEOUT_EXIT, 'E2E_TIMEOUT the bot sends the file over HOP');
const [attachment] = message.content.attachments;
if (!attachment?.hop) await finish(1, `HOP_FAILED the attachment names no node or ticket: ${JSON.stringify({ kind: attachment?.kind, mime: attachment?.mimeType })}`);
console.log(`HOP_MESSAGE id=${message.messageId} kind=${attachment.kind} mime=${attachment.mimeType} size=${attachment.fileSize} node=${new URL(attachment.hop.node).hostname} ticket_on_row=${attachment.hop.ticket.length}B text=${JSON.stringify(message.content.text ?? '')} at=${at()}`);

// The attachment service with main's HOP client as the IPC seam (what preload hands the renderer),
// and main's chain sources: the node's bitswap (inside hopFetch), then the Bulletin fetch as ipc.ts wires it.
const progress = new Set();
const rpcCalls = [];
const counted = async (url) => {
  const rpc = await openHopRpc(url);
  return { ...rpc, call: (method, params) => (rpcCalls.push(method), rpc.call(method, params)) };
};
let bulletinService = null;
let bulletinChain = null;
const bulletinTries = [];
const bulletinSource = async (hash, large) => {
  if (!bulletinService) {
    const { openBulletin, createBulletinService, bulletinSigner } = await load('src/main/chain/bulletin.ts');
    bulletinChain = await openBulletin(profile);
    bulletinService = createBulletinService(bulletinChain, bulletinSigner(saved.mnemonic));
  }
  try {
    return (await bulletinService.fetchChunk(hash, null, undefined, large)).bytes;
  } catch (error) {
    bulletinTries.push(error instanceof Error ? error.message.slice(0, 160) : String(error));
    throw error;
  }
};
let desktopAcks = 0;
const hopApi = {
  fetch: (requestId, node, identifier, ticket) =>
    hopFetch(node, bytesOf(identifier), ticket, (done, total) => progress.forEach((listener) => listener({ requestId, done, total })), counted, [bulletinSource]),
  ack: async (node, ticket, entries) => {
    desktopAcks += 1;
    const result = await hopAck(node, ticket, entries);
    console.log(`ACKED acked=${result.acked} notFound=${result.notFound} failed=${result.failed} entries=${entries.length}`);
    return result;
  },
  onProgress: (listener) => {
    progress.add(listener);
    return () => progress.delete(listener);
  },
};
const service = createAttachmentService({ bulletin: null, store: null, chat: manager, hop: hopApi });
const status = await service.fetch(message.messageId, 0, hopItemOf(attachment));
const local = await getAttachmentRow(message.messageId, 0);
if (status !== 'ready' || !local?.bytes) await finish(1, `HOP_FAILED status=${status} error=${local?.error ?? 'none'}`);
const got = sha256(local.bytes);
if (got !== sha256(png)) await finish(1, `HOP_FAILED sha256 differs: got ${got}, sent ${sha256(png)}`);
console.log(`HOP_RECEIVE_OK sha256=${got} bytes=${local.bytes.length} entries=${local.total} cipher=${local.hop.cipher} layout=${local.hop.layout} at=${at()}`);

// The ack removed every entry: a second claim of the root finds nothing.
const ticket = await hopTicket(message.messageId, 0, attachment);
const rpc = await openHopRpc(resolveHopNode(attachment.hop.node));
let again;
try {
  await fetchHopFile({ rpc, identifier: bytesOf(attachment.hop.identifier), ticket });
  again = 'still-claimable';
} catch (error) {
  again = error.reason ?? String(error);
} finally {
  rpc.close();
}
if (again !== 'notFound') await finish(1, `HOP_FAILED after the ack the root is ${again}, not NotFound`);
console.log(`HOP_ACK_OK a second claim of the root answers NotFound at=${at()}`);

// ── Step 6: RFC-0001 chain fallback after another device acked first ─────────
const second = await askForFile(SECOND_FILE_NAME, new Set([message.messageId]));
if (!second) await finish(TIMEOUT_EXIT, 'E2E_TIMEOUT the bot sends the second file over HOP');
const [secondAttachment] = second.content.attachments;
if (!secondAttachment?.hop) await finish(1, 'HOP_FAILED the second attachment names no node or ticket');
const secondTicket = await hopTicket(second.messageId, 0, secondAttachment);
// The other device: the same ticket, its own connection; claims everything, then acks it.
const other = await hopFetch(secondAttachment.hop.node, bytesOf(secondAttachment.hop.identifier), secondTicket, () => undefined);
if (!other.ok) await finish(1, `HOP_FAILED the second device could not claim the second file: ${other.reason}`);
const otherAck = await hopAck(secondAttachment.hop.node, secondTicket, other.entries);
if (otherAck.acked !== other.entries.length) await finish(1, `HOP_FAILED the second device acked ${otherAck.acked} of ${other.entries.length}`);
console.log(`HOP_OTHER_DEVICE_ACKED entries=${other.entries.length} sha256_ok=${sha256(other.bytes) === sha256(secondPng)} at=${at()}`);
const acksBefore = desktopAcks;
const callsFrom = rpcCalls.length;
const secondStatus = await service.fetch(second.messageId, 0, hopItemOf(secondAttachment));
const secondRow = await getAttachmentRow(second.messageId, 0);
const methods = rpcCalls.slice(callsFrom);
const claims = methods.filter((method) => method === 'hop_claim').length;
const bitswaps = methods.filter((method) => method === 'bitswap_v1_get').length;
console.log(`HOP_CHAIN_FALLBACK status=${secondStatus} claims=${claims} node_bitswap=${bitswaps} bulletin_tries=${bulletinTries.length} desktop_acks=${desktopAcks - acksBefore} error=${JSON.stringify(secondRow?.error ?? null)} at=${at()}`);
for (const reason of bulletinTries) console.log(`  bulletin: ${reason}`);
if (secondStatus === 'ready') await finish(1, 'HOP_FAILED the acked entry came back from chain storage, which RFC-0001 says cannot happen; check the node');
if (secondStatus !== 'fetchingChain' || claims < 1 || bitswaps < 1 || bulletinTries.length < 1 || desktopAcks !== acksBefore) {
  await finish(1, `HOP_FAILED the chain fallback did not run as RFC-0001 says (status=${secondStatus})`);
}
console.log(`HOP_CHAIN_FALLBACK_OK NotFound → node bitswap → Bulletin fetch, nothing acked, row fetchingChain at=${at()}`);
console.log('HOP_CHAIN_FALLBACK_PENDING arrival from chain storage not provable live: an acked entry is deleted without promotion (RFC-0001 Known issues) and promotion runs only near the 24 h expiry; covered by src/main/chain/hop.spec.ts');
service.dispose();
bulletinChain?.destroy();
await finish(0, `HOP_OK bot=${bot.username} desktop=${saved.username} sha256=${got.slice(0, 16)}…`);
