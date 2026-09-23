#!/usr/bin/env node
// M8 e2e (spec 0006 buttons) against a live pca bot, through this repo's domain code:
//   npm run e2e:buttons -- [peerUsername=pcdguide.70] [--profile devnet|paseo] [--identity <name>]
// Same setup as e2e-chat.mjs (the identity file, fake-indexeddb, the People
// connection). Sends a chat request, waits for the accept, sends `menu`, and
// waits for a `buttons` message (BUTTONS_RECEIVED rows=<n>). Presses the first
// `callback` button through the manager, as the app does (PRESS_SENT), and
// waits up to 60 s for any text reply to the press (BUTTONS_OK).
// Exit 0 BUTTONS_OK; 7 BUTTONS_FALLBACK (the bot answered `menu` with plain
// text: no buttons extension, or the gate did not open); 3 PEER_KEY_UNSUPPORTED;
// 4 E2E_TIMEOUT <stage>; 1 any other failure. Prints no secret.

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

const STAGE_TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;
/** How long a bot's own answer to the request may take to arrive. */
const GREETING_WAIT_MS = 15_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const flagValues = new Set(['--profile', '--identity'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
const peerUsername = args.find((arg, i) => !arg.startsWith('--') && !flagValues.has(i)) ?? 'pcdguide.70';
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
const waitFor = async (probe, timeoutMs = STAGE_TIMEOUT_MS) => {
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

// One People connection for the chain reads and the Statement Store, as in the app.
const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
console.log(`[ws] ${connection.status()}`);
connection.onStatus((status) => console.log(`[ws] ${status}`));

// Reads go to the best block (PLAN.md "Best block first"): a peer that just
// registered is readable before finality. The runtime is loaded first (from
// the metadata cache when it has it), so a read's deadline never covers the
// metadata download; a timed-out step moves to the next endpoint once.
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

if (await db.contacts.get(peerAccountHex)) {
  console.log('CONTACT_EXISTS');
} else {
  try {
    await manager.sendRequest(peer, null);
  } catch (error) {
    finish(1, `REQUEST_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log('REQUEST_SENT');
  const contact = await waitFor(() => db.contacts.get(peerAccountHex));
  if (!contact) finish(4, 'E2E_TIMEOUT accept');
  console.log(`ACCEPTED devices=${contact.devices.length}`);
}

// The session starts right after the "chat accepted" row; wait for it.
const sessionReady = await waitFor(async () => (await db.messages.where('peerAccountId').equals(peerAccountHex).count()) > 0, 10_000);
if (!sessionReady) console.log('note: no chat row yet; sending anyway');

const textOf = (row) =>
  row.content.type === 'text' || row.content.type === 'reply' || row.content.type === 'buttons' ? row.content.text : `[${row.content.type}]`;
const oneLine = (text) => text.replace(/\s+/g, ' ').slice(0, 100);
const incoming = async () =>
  (await db.messages.toArray()).filter((row) => row.peerAccountId === peerAccountHex && row.direction === 'incoming');
// pca status rows are not answers: its live frames (⏳ / 🤔, M7) and the
// receipt it edits the placeholder into ("✓ Answered in …").
const isStatus = (row) => row.content.type === 'text' && /^(?:⏳|🤔|✓) /u.test(row.content.text);

// A bot answers the request itself a moment after the accept. Let that land
// first, so it is not taken for the answer to `menu`.
const greeting = await waitFor(async () => (await incoming())[0], GREETING_WAIT_MS);
if (greeting) console.log(`GREETING ${oneLine(textOf(greeting))}`);

const before = new Set((await incoming()).map((row) => row.messageId));
try {
  await manager.sendMessage(peerAccountHex, { type: 'text', text: 'menu' });
} catch (error) {
  finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
console.log('MENU_SENT menu');

/** How long a plain-text answer may stand before it counts as the fallback. */
const FALLBACK_GRACE_MS = 20_000;
let plainSince = null;
let plain = null;
const keyboard = await waitFor(async () => {
  const fresh = (await incoming()).filter((row) => !before.has(row.messageId));
  const found = fresh.find((row) => row.content.type === 'buttons');
  if (found) return found;
  const answer = fresh.find((row) => row.content.type === 'text' && !isStatus(row));
  if (answer && plainSince === null) {
    plainSince = Date.now();
    plain = answer;
  }
  if (plainSince !== null && Date.now() - plainSince > FALLBACK_GRACE_MS) return 'fallback';
  return null;
}, STAGE_TIMEOUT_MS);
if (keyboard === 'fallback') {
  console.log(`PLAIN_REPLY ${oneLine(textOf(plain))}`);
  finish(7, 'BUTTONS_FALLBACK');
}
if (!keyboard) finish(4, 'E2E_TIMEOUT buttons');
const rows = keyboard.content.rows;
console.log(`BUTTONS_RECEIVED rows=${rows.length}`);
console.log(`BUTTONS_TEXT ${oneLine(keyboard.content.text)}`);
rows.forEach((row, r) => console.log(`  row ${r}: ${row.map((button) => `[${button.label} · ${button.action.kind}]`).join(' ')}`));

let target = null;
rows.forEach((row, r) => row.forEach((button, i) => {
  if (!target && button.action.kind === 'callback') target = { row: r, index: i, label: button.label };
}));
if (!target) finish(1, 'NO_CALLBACK_BUTTON the keyboard has no callback button to press');

const beforePress = new Set((await incoming()).map((row) => row.messageId));
try {
  await manager.pressButton(peerAccountHex, keyboard.messageId, target.row, target.index);
} catch (error) {
  finish(1, `PRESS_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`PRESS_SENT row=${target.row} index=${target.index} label=${JSON.stringify(target.label)}`);

// The answer may come as a new message or as an edit of a status row; read
// every row after the press, and the latest text of each.
const PRESS_REPLY_MS = 60_000;
// Reviewer ruling (2026-09-23): the proof is that the bot answers the press at
// all; a bot's wording is its persona's business (the guide answers "Colour of
// the day" with a colour name). Whether the reply names the label is reported,
// not required.
const needle = target.label.toLowerCase();
const answer = await waitFor(async () => {
  const fresh = (await incoming()).filter((row) => !beforePress.has(row.messageId) && !isStatus(row));
  return fresh.length > 0 ? fresh.at(-1) : null;
}, PRESS_REPLY_MS);
if (!answer) finish(4, 'E2E_TIMEOUT press reply');
const names = textOf(answer).toLowerCase().includes(needle);
console.log(`PRESS_REPLY ${oneLine(textOf(answer))} (names the label: ${names ? 'yes' : 'no'})`);
finish(0, 'BUTTONS_OK');
