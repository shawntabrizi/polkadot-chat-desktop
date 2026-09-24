#!/usr/bin/env node
// M12i e2e: the demo action ("Start chats with all") for a new person, through
// this repo's domain code (domain/demo/demo.ts, the same call the onboarding
// step and Settings › Demo make):
//   npm run e2e:demo -- [--profile devnet] [--identity <file>]
// 1. A fresh test identity: registered now (name pcddemo + 4 random letters,
//    saved under .agent-runs/identity-demo-<name>/), unless --identity names an
//    identity.json to reuse (then the run is not "fresh"; the script says so).
// 2. Dexie on fake-indexeddb, seeded as the app seeds it; the People
//    connection, the chat manager, the identity lookup and the username
//    resolver (Resources.UsernameOwnerOf at the best block).
// 3. Run 1 over the built-in devnet list (shared/demoBots.ts). The action
//    first waits until this identity's key reads back from the People chain
//    (best block, every 2 s, up to 90 s): DEMO_WAITED_FOR_KEY <ms> when the
//    key was not there at the first read, DEMO_KEY_VISIBLE at=once when it
//    was, DEMO_FAIL key-not-visible when the wait ran out. Then one line per
//    bot (DEMO_STEP), then wait up to 60 s from the press for accepts (a
//    contact with a room, as the chat list shows it). DEMO_OK n=<accepts>
//    when n >= 4. GREETED lists the bots whose answer arrived (information).
// 4. Run 2: the same action again must send nothing (no request, no message):
//    DEMO_IDEMPOTENT sent=0. The key is known by then, so it must not wait.
// Exit 0 on DEMO_OK and DEMO_IDEMPOTENT; 1 DEMO_FAIL / DEMO_NOT_IDEMPOTENT / any
// other failure. Prints no secret.

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(join(root, path)).href);

const ACCEPT_WAIT_MS = 60_000;
const MIN_ACCEPTS = 4;
/** After the accepts: how long the bots' greetings may take (information only). */
const GREETING_WAIT_MS = 15_000;
const POLL_MS = 1_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const reuse = flag('identity') ?? null;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const { createIdentity } = await load('src/main/identity/service.ts');
const { deriveIdentityKeys } = await load('src/main/identity/keys.ts');
const { NETWORK_PROFILES } = await load('src/renderer/app/network.ts');
const { getPeopleConnection, disposePeopleConnection, setMetadataCache } = await load('src/renderer/app/statementStore.ts');
const { metadataCache, setMetadataCacheDir } = await load('src/main/metadataCache.ts');
const { awaitBestRuntime, retryOnNextEndpoint } = await load('src/shared/chainRead.ts');
const { seedSelfIdentity } = await load('src/renderer/domain/identity/selfIdentity.ts');
const { readUserIdentity } = await load('src/renderer/domain/identity/userIdentity.ts');
const { getDeviceKeys } = await load('src/renderer/domain/device/repository.ts');
const { createIdentityLookup, createUsernameResolver } = await load('src/renderer/domain/identity/lookup.ts');
const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
const { listMessages } = await load('src/renderer/domain/chat/messages.ts');
const { BUILT_IN_DEMO_BOTS } = await load('src/shared/demoBots.ts');
const { DEMO_OPENER, demoPeerState, readDemoSnapshot, selfKeyVisibleVia, startDemoChats } = await load('src/renderer/domain/demo/demo.ts');

setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
setMetadataCache(metadataCache());

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

const bots = BUILT_IN_DEMO_BOTS[profile] ?? [];
if (bots.length === 0) finish(1, `DEMO_FAIL no demo bots on ${profile}`);

// ── 1. A fresh identity ───────────────────────────────────────────────────

let identityFile;
if (reuse) {
  identityFile = resolve(reuse);
  if (!existsSync(identityFile)) finish(1, `NO_IDENTITY ${identityFile}`);
  console.log(`identity reuse (not fresh) ${identityFile}`);
} else {
  const suffix = Array.from(randomBytes(4), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
  const base = `pcddemo${suffix}`;
  identityFile = join(root, '.agent-runs', `identity-demo-${base}`, 'identity.json');
  const store = {
    load: () => (existsSync(identityFile) ? JSON.parse(readFileSync(identityFile, 'utf8')) : null),
    save: (identity) => {
      mkdirSync(dirname(identityFile), { recursive: true, mode: 0o700 });
      writeFileSync(identityFile, `${JSON.stringify({ version: 1, ...identity }, null, 2)}\n`, { mode: 0o600 });
    },
  };
  console.log(`identity register ${base} on ${profile}`);
  try {
    const result = await createIdentity({ username: base, digits: null, profile, store, onProgress: (line) => console.log(`  ${line}`) });
    console.log(`identity registered ${result.username} confirmed=${result.confirmed} finalized=${result.finalized} at=${at()}`);
  } catch (error) {
    finish(1, `REGISTER_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
}
const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
const selfKeys = deriveIdentityKeys(saved.mnemonic);
if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
console.log(`SELF ${saved.accountHex} ${saved.username}`);

// ── 2. The app's chat stack ───────────────────────────────────────────────

const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
connection.onStatus((status) => console.log(`[ws] ${status}`));
try {
  const head = await retryOnNextEndpoint(() => awaitBestRuntime(connection.lazyClient.getClient()), connection.switchEndpoint);
  console.log(`people best block #${head.number}`);
} catch (error) {
  finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
await seedSelfIdentity(
  { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
  selfKeys.accountId,
);
const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
const lookup = createIdentityLookup(connection);
manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });

// The deps the app builds (ui/DemoBots.tsx), with every send counted.
let sends = 0;
const deps = {
  snapshot: readDemoSnapshot,
  resolveUsername: createUsernameResolver(connection),
  getPeerIdentity: (accountId) => lookup.getPeerIdentity(accountId),
  sendRequest: async (peer, text) => {
    sends += 1;
    await manager.sendRequest(peer, text);
  },
  sendMessage: async (peer, text) => {
    sends += 1;
    await manager.sendMessage(peer, { type: 'text', text });
  },
  selfKeyVisible: selfKeyVisibleVia(lookup),
};

// ── 3. Run 1 ──────────────────────────────────────────────────────────────

console.log(`DEMO_START bots=${bots.map((bot) => bot.username).join(',')} opener=${JSON.stringify(DEMO_OPENER)}`);
const pressedAt = Date.now();
let firstWait = null;
const first = await startDemoChats(
  bots,
  deps,
  (username, step, detail) => {
    if (step !== 'sending' && step !== 'waiting') console.log(`DEMO_STEP ${username} ${step}${detail ? ` (${detail})` : ''} at=${at()}`);
  },
  (wait) => {
    firstWait = { ...wait, sendsBefore: sends };
    if (!wait.visible) console.log(`DEMO_KEY_NOT_VISIBLE after=${wait.waitedMs}ms reads=${wait.reads}`);
    else if (wait.reads > 1) console.log(`DEMO_WAITED_FOR_KEY ${wait.waitedMs} reads=${wait.reads} at=${at()}`);
    else console.log(`DEMO_KEY_VISIBLE at=once (${wait.waitedMs}ms)`);
  },
);
if (!firstWait) finish(1, 'DEMO_FAIL the action did not report its wait for the key');
if (!firstWait.visible) finish(1, `DEMO_FAIL key-not-visible sent=${sends}`);
if (firstWait.sendsBefore !== 0) finish(1, `DEMO_FAIL sent=${firstWait.sendsBefore} before the key wait ended`);
const sentTo = bots.filter((bot) => first.get(bot.username) === 'sent' || first.get(bot.username) === 'resumed');
console.log(`RUN1 sent=${sends} of ${bots.length} at=${at()}`);

const acceptedNow = async () => {
  const snapshot = await readDemoSnapshot();
  return sentTo.filter((bot) => demoPeerState(snapshot, bot.username).kind === 'chatting');
};
const reported = new Set();
let accepted = [];
while (Date.now() - pressedAt < ACCEPT_WAIT_MS) {
  accepted = await acceptedNow();
  for (const bot of accepted) {
    if (reported.has(bot.username)) continue;
    reported.add(bot.username);
    console.log(`ACCEPTED ${bot.username} after=${((Date.now() - pressedAt) / 1000).toFixed(1)}s`);
  }
  if (accepted.length === sentTo.length) break;
  await delay(POLL_MS);
}
const silent = sentTo.filter((bot) => !reported.has(bot.username)).map((bot) => bot.username);
if (accepted.length < MIN_ACCEPTS) finish(1, `DEMO_FAIL accepted=${accepted.length} (need ${MIN_ACCEPTS}) no-answer=${silent.join(',') || 'none'}`);
console.log(`DEMO_OK n=${accepted.length} within=${((Date.now() - pressedAt) / 1000).toFixed(1)}s no-answer=${silent.join(',') || 'none'}`);

// The greetings (information: the milestone asks for accepts).
const greetedNow = async () => {
  const snapshot = await readDemoSnapshot();
  const greeted = [];
  for (const bot of accepted) {
    const state = demoPeerState(snapshot, bot.username);
    const rows = state.kind === 'chatting' ? await listMessages(state.peer) : [];
    if (rows.some((row) => row.direction === 'incoming' && row.content.type !== 'deleted')) greeted.push(bot.username);
  }
  return greeted;
};
let greeted = [];
const greetUntil = Date.now() + GREETING_WAIT_MS;
while (Date.now() < greetUntil) {
  greeted = await greetedNow();
  if (greeted.length === accepted.length) break;
  await delay(POLL_MS);
}
console.log(`GREETED ${greeted.length}/${accepted.length} ${greeted.join(',')}`);

// ── 4. Run 2: nothing more goes out ───────────────────────────────────────

const before = sends;
let secondWait = null;
const second = await startDemoChats(bots, deps, undefined, (wait) => {
  secondWait = wait;
});
if (!secondWait?.visible || secondWait.reads !== 1) finish(1, `DEMO_FAIL run 2 waited for a key already known: ${JSON.stringify(secondWait)}`);
const secondSent = sends - before;
const summary = bots.map((bot) => `${bot.username}=${second.get(bot.username)}`).join(' ');
if (secondSent !== 0) finish(1, `DEMO_NOT_IDEMPOTENT sent=${secondSent} ${summary}`);
finish(0, `DEMO_IDEMPOTENT sent=0 ${summary}`);
