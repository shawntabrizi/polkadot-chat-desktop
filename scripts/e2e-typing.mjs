#!/usr/bin/env node
// M12c e2e (the submission budget, spec 0005 revision 2026-09-23) against a
// live pca bot, through this repo's domain code:
//   npm run e2e:typing -- [peerUsername=pcdpirate.81] [--profile devnet] [--identity <name>]
// Same setup as before (the identity file, fake-indexeddb, the People
// connection). Sends a chat request, waits for the accept and the bot's
// botInfo, then asks one question and proves, with the manager's submission
// counter (what reaches the Statement Store, acknowledgements apart):
//  (a) our question costs 1 submission (QUESTION_SUBMISSIONS 1): no `typing`
//      goes out (typing is off by default), and reading the reply costs
//      exactly 1 more, only when its 5 s window ends (READ_SUBMISSIONS 1);
//  (b) the room shows "working" at once after the send, with no wire signal
//      (WORKING_LOCAL), and it clears on the reply (WORKING_CLEARED);
//  (c) the bot's `seen` marks our question (SEEN_RECEIVED), alone or riding
//      on its reply.
// It holds for bots before and after the pca change: an older bot's own
// `typing{working}` is logged (TYPING_RECEIVED) and shares the one line.
// The pca agent may restart the bot mid-run: a missing accept or reply
// waits and tries once more (BOT_DOWN_RETRY).
// Exit 0 BUDGET_OK; 8 any check failed (its marker is printed); 3
// PEER_KEY_UNSUPPORTED; 4 E2E_TIMEOUT <stage>; 1 any other failure. Prints
// no secret.

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { paseoPeopleNext, productsDevnetPeople } from '@polkadot-api/descriptors';
import { AccountId } from '@polkadot-api/substrate-bindings';
import { register } from 'tsx/esm/api';

// One tsx loader for the whole process, so every module shares one instance
// (one Dexie, one People connection). `tsImport` would load each entry apart.
register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(join(root, path)).href);

const POLL_MS = 250;
const ACCEPT_WAIT_MS = 120_000;
const BOTINFO_WAIT_MS = 30_000;
const REPLY_WAIT_MS = 90_000;
/** A restarting bot is back within this (the pca agent restarts it in seconds). */
const BOT_DOWN_WAIT_MS = 45_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const flagValues = new Set(['--profile', '--identity'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
const peerUsername = args.find((arg, i) => !arg.startsWith('--') && !flagValues.has(i)) ?? 'pcdpirate.81';
const profile = flag('profile') ?? 'devnet';
const identityName = flag('identity') ?? 'pcde2e';
if (profile !== 'devnet' && profile !== 'paseo') {
  console.error(`unknown profile "${profile}" (devnet or paseo)`);
  process.exit(2);
}

const ss58 = AccountId(42);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

/** Polls `probe` until it returns a value; `null` after the timeout. */
const waitFor = async (probe, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await delay(POLL_MS);
  }
  return null;
};

const { createIdentity } = await load('src/main/identity/service.ts');
const { deriveIdentityKeys } = await load('src/main/identity/keys.ts');
const { NETWORK_PROFILES } = await load('src/renderer/app/network.ts');
const { db } = await load('src/renderer/app/database.ts');
const { getPeopleConnection, disposePeopleConnection, setMetadataCache } = await load('src/renderer/app/statementStore.ts');
const { metadataCache, setMetadataCacheDir } = await load('src/main/metadataCache.ts');
const { READ_TIMEOUT_MS, awaitBestRuntime, retryOnNextEndpoint, withTimeout } = await load('src/shared/chainRead.ts');
const { seedSelfIdentity } = await load('src/renderer/domain/identity/selfIdentity.ts');
const { readUserIdentity } = await load('src/renderer/domain/identity/userIdentity.ts');
const { getDeviceKeys } = await load('src/renderer/domain/device/repository.ts');
const { createIdentityLookup } = await load('src/renderer/domain/identity/lookup.ts');
const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
const { SEEN_INTERVAL_MS } = await load('src/renderer/domain/chat/signals.ts');
const { readChatPrefs } = await load('src/renderer/app/chatPrefs.ts');

// The app keeps runtime metadata under <userData>/metadata; the script keeps it
// here, so only the first run after a runtime upgrade downloads it.
setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
setMetadataCache(metadataCache());

// Everything that holds a socket, closed on every exit path.
let manager = null;
const finish = (code, line) => {
  if (line) console.log(line);
  try {
    manager?.dispose();
  } catch (error) {
    console.warn('dispose failed', error);
  }
  disposePeopleConnection();
  process.exit(code);
};

// ── Identity ──────────────────────────────────────────────────────────────

const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
const store = {
  load: () => (existsSync(identityFile) ? JSON.parse(readFileSync(identityFile, 'utf8')) : null),
  save: (identity) => {
    mkdirSync(dirname(identityFile), { recursive: true, mode: 0o700 });
    writeFileSync(identityFile, `${JSON.stringify({ version: 1, ...identity }, null, 2)}\n`, { mode: 0o600 });
  },
};

let saved = store.load();
if (saved) {
  console.log(`identity reuse ${saved.username} (${identityFile})`);
  if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
} else {
  // The backend takes letters only, so the random suffix is letters, not the digits the spec names.
  const suffix = Array.from(randomBytes(4), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
  const base = `${identityName.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)))}${suffix}`;
  console.log(`identity register ${base} on ${profile}`);
  try {
    const result = await createIdentity({ username: base, digits: null, profile, store, onProgress: (line) => console.log(`  ${line}`) });
    console.log(`identity registered ${result.username} confirmed=${result.confirmed} finalized=${result.finalized}`);
  } catch (error) {
    finish(1, `REGISTER_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  saved = store.load();
}
const selfKeys = deriveIdentityKeys(saved.mnemonic);
if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
console.log(`SELF ${saved.accountHex} ${saved.username}`);

// ── Peer resolution (People chain, best block) ──────────────────────────

const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
console.log(`[ws] ${connection.status()}`);
connection.onStatus((status) => console.log(`[ws] ${status}`));

// Reads go to the best block (PLAN.md "Best block first").
const client = connection.lazyClient.getClient();
const people = client.getTypedApi(profile === 'paseo' ? paseoPeopleNext : productsDevnetPeople);
const best = { at: 'best' };
const read = (label, fn) => retryOnNextEndpoint(() => withTimeout(fn(), READ_TIMEOUT_MS, label), connection.switchEndpoint);
/** The RFC-0004 identifier-key container (0x-hex) of an account, or null. */
const identifierKeyOf = async (accountHex) => {
  const value = await read('identifier lookup', () => people.query.Resources.Consumers.getValue(ss58.dec(bytesOf(accountHex)), best));
  return value?.identifier_key == null ? null : String(value.identifier_key).toLowerCase();
};

// The chain pads a lite number to two digits (`name.6` -> `name.06`).
const canonical = peerUsername.replace(/^@/, '').replace(/^([a-z0-9]+)\.(\d)$/i, '$1.0$2');
let peerAccountHex;
let peerKey;
try {
  const started = Date.now();
  const head = await retryOnNextEndpoint(() => awaitBestRuntime(client), connection.switchEndpoint);
  console.log(`best block #${head.number} (runtime ready in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if ((await identifierKeyOf(saved.accountHex)) == null) {
    finish(1, 'SELF_NOT_ON_CHAIN (the peer cannot verify a request from an account without a chat key)');
  }
  const owner = await read('username lookup', () => people.query.Resources.UsernameOwnerOf.getValue(new TextEncoder().encode(canonical), best));
  if (typeof owner !== 'string' || owner === '') finish(1, `PEER_NOT_FOUND ${canonical}`);
  peerAccountHex = hexOf(ss58.enc(owner));
  peerKey = await identifierKeyOf(peerAccountHex);
} catch (error) {
  finish(1, `CHAIN_READ_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
if (peerKey == null) finish(1, `PEER_NO_CHAT_KEY ${peerAccountHex}`);
const keyType = Number.parseInt(peerKey.slice(2, 4), 16);
console.log(`PEER ${peerAccountHex} key_type=${keyType}`);
if (keyType !== 0) finish(3, 'PEER_KEY_UNSUPPORTED');
// RFC-0004 container: 0x00 || x25519 public key (32) || padding.
const peer = { accountId: bytesOf(peerAccountHex), username: canonical, chatPublicKey: bytesOf(peerKey).slice(1, 33) };

// ── Chat ──────────────────────────────────────────────────────────────────

await seedSelfIdentity(
  { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
  selfKeys.accountId,
);
const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');

manager = await createChatManager({
  identity,
  deviceKeys,
  statementStore: connection.adapter,
  lookup: createIdentityLookup(connection),
  onConnectionStatus: connection.onStatus,
});
const prefs = await readChatPrefs();
console.log(`PREFS sendTyping=${prefs.sendTyping} readReceipts=${prefs.readReceipts} (a fresh profile: the defaults)`);

/** Request, then the accept; a bot that is down (restarting) gets one more request after a pause. */
const connect = async () => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await manager.sendRequest(peer, null);
    } catch (error) {
      finish(1, `REQUEST_FAIL ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`REQUEST_SENT attempt=${attempt}`);
    const contact = await waitFor(() => db.contacts.get(peerAccountHex), ACCEPT_WAIT_MS);
    if (contact) return contact;
    if (attempt === 1) {
      console.log(`BOT_DOWN_RETRY no accept in ${ACCEPT_WAIT_MS / 1000} s; waiting ${BOT_DOWN_WAIT_MS / 1000} s`);
      await delay(BOT_DOWN_WAIT_MS);
    }
  }
  return null;
};
const contact = await connect();
if (!contact) finish(4, 'E2E_TIMEOUT accept');
console.log(`ACCEPTED devices=${contact.devices.length}`);

const textOf = (row) =>
  row.content.type === 'text' || row.content.type === 'reply' || row.content.type === 'buttons' ? row.content.text : `[${row.content.type}]`;
const oneLine = (text) => text.replace(/\s+/g, ' ').slice(0, 100);
const incoming = async () =>
  (await db.messages.toArray()).filter((row) => row.peerAccountId === peerAccountHex && row.direction === 'incoming').sort((a, b) => a.timestamp - b.timestamp);
// pca status rows are not answers: live frames (⏳ / 🤔) and the receipt it edits the placeholder into.
const isStatus = (row) => row.content.type === 'text' && /^(?:⏳|🤔|✓) /u.test(row.content.text);

// The local "working" state is for a KNOWN bot: its botInfo (spec 0008).
// pca sends it with the accept; `/start` asks again, as the app's room does.
const botInfo = async () => (await db.peerInfo.get(peerAccountHex))?.botInfo ?? null;
let info = await waitFor(botInfo, BOTINFO_WAIT_MS);
if (!info) {
  await manager.roomOpened(peerAccountHex);
  console.log('BOTINFO_ASKED (/start)');
  info = await waitFor(botInfo, BOTINFO_WAIT_MS);
}
if (!info) finish(8, 'BOTINFO_MISSING (no local working state without it)');
console.log(`BOTINFO name="${info.name}" version=${info.version}`);
// Let the greeting and any answer to /start land, so none is taken for the reply.
await delay(3_000);

// ── One question, measured ───────────────────────────────────────────────

const counts = () => manager.submissions.snapshot();
const round = async (attempt) => {
  const t0 = Date.now();
  const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const result = { working: false, cleared: false, reply: null, seen: false, question: null, read: null, receivedTyping: false };

  let lastState = null;
  const onTyping = () => {
    const state = manager.typing.snapshot().get(peerAccountHex) ?? null;
    if (state === lastState) return;
    lastState = state;
    if (state && !state.local && !result.receivedTyping) {
      result.receivedTyping = true;
      console.log(`TYPING_RECEIVED kind=${state.kind} at=${since()} (an older bot; one line with the local state)`);
    }
  };
  const stop = manager.typing.subscribe(onTyping);

  const before = new Set((await incoming()).map((row) => row.messageId));
  const start = counts();
  const question = attempt === 1 ? 'Tell me a short pirate joke about blocks.' : 'Tell me a short pirate joke about ships.';
  await manager.sendMessage(peerAccountHex, { type: 'text', text: question });
  const state = manager.typing.snapshot().get(peerAccountHex);
  result.working = state?.kind === 'working' && state.local === true;
  console.log(`${result.working ? 'WORKING_LOCAL' : 'WORKING_LOCAL_MISSING'} at=${since()} state=${JSON.stringify(state ?? null)}`);
  const own = (await db.messages.toArray()).find((row) => row.peerAccountId === peerAccountHex && row.direction === 'outgoing' && textOf(row) === question && row.timestamp >= t0);
  if (!own) finish(1, 'SEND_FAIL no row for the question');
  // The meter sends at the end of the task; give it a moment, then count.
  await delay(1_000);
  result.question = counts().submissions - start.submissions;
  console.log(`QUESTION_SENT ${own.messageId} QUESTION_SUBMISSIONS ${result.question}`);

  // Read the room as the app does when it is open and focused.
  const readUpTo = new Set();
  let readAt = null;
  let atRead = null;
  const readNew = async () => {
    const fresh = (await incoming()).filter((row) => !before.has(row.messageId));
    const newest = fresh.at(-1);
    if (newest && !readUpTo.has(newest.messageId)) {
      readUpTo.add(newest.messageId);
      if (readAt === null) {
        readAt = Date.now();
        atRead = counts().submissions;
      }
      await manager.markRead(peerAccountHex);
    }
    return fresh;
  };
  await waitFor(async () => {
    const fresh = await readNew();
    if (!result.reply) {
      const answer = fresh.find((row) => !isStatus(row) && row.timestamp > own.timestamp);
      if (answer) {
        result.reply = answer;
        console.log(`REPLY at=${since()} ${oneLine(textOf(answer))}`);
        const after = manager.typing.snapshot().get(peerAccountHex);
        result.cleared = after === undefined;
        console.log(`${result.cleared ? 'WORKING_CLEARED' : 'WORKING_NOT_CLEARED'} at=${since()} state=${JSON.stringify(after ?? null)}`);
      }
    }
    if (!result.seen && (await db.messages.get(own.messageId))?.seenAt !== undefined) {
      result.seen = true;
      console.log(`SEEN_RECEIVED upTo=${own.messageId} at=${since()}${result.reply ? '' : ' (before the reply)'}`);
    }
    return result.reply && result.seen;
  }, REPLY_WAIT_MS);
  if (!result.reply) {
    stop();
    return result;
  }

  // The read: nothing inside the 5 s window, one standalone `seen` after it.
  const inside = Math.max(0, readAt + SEEN_INTERVAL_MS - 1_000 - Date.now());
  await delay(inside);
  await readNew();
  const early = counts().submissions - atRead;
  await delay(Math.max(0, readAt + SEEN_INTERVAL_MS + 2_500 - Date.now()));
  await readNew();
  result.read = counts().submissions - atRead;
  console.log(`READ_SUBMISSIONS ${result.read} (inside the 5 s window: ${early})`);
  const end = counts();
  console.log(
    `COUNTS submissions=${end.submissions - start.submissions} messages=${end.messages - start.messages} acknowledgements=${end.acknowledgements - start.acknowledgements} (this round)`,
  );
  stop();
  return result;
};

let result = await round(1);
if (!result.reply) {
  console.log(`BOT_DOWN_RETRY no reply in ${REPLY_WAIT_MS / 1000} s; waiting ${BOT_DOWN_WAIT_MS / 1000} s`);
  await delay(BOT_DOWN_WAIT_MS);
  result = await round(2);
}
if (!result.reply) finish(4, 'E2E_TIMEOUT reply (after one retry)');

const failures = [];
if (result.question !== 1) failures.push(`QUESTION_SUBMISSIONS_${result.question}`);
if (result.read !== 1) failures.push(`READ_SUBMISSIONS_${result.read}`);
if (!result.working) failures.push('WORKING_LOCAL_MISSING');
if (!result.cleared) failures.push('WORKING_NOT_CLEARED');
if (!result.seen) failures.push('SEEN_MISSING');
const total = counts();
console.log(`DIAGNOSTICS submissions=${total.submissions} messages=${total.messages} acknowledgements=${total.acknowledgements} (whole run: request and accept included)`);
if (failures.length > 0) finish(8, `BUDGET_FAILED ${failures.join(' ')}`);
finish(0, 'BUDGET_OK');
