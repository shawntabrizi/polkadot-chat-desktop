#!/usr/bin/env node
// Headless chat round trip with a live peer, through this repo's domain code:
//   npm run e2e:chat -- <peerUsername> [--profile devnet|paseo] [--identity <name>]
// Reuses .agent-runs/identity-<name>/identity.json (M1's script writes it) or
// registers <name> + 4 random letters with M1's createIdentity. Dexie runs on
// fake-indexeddb (memory only), seeded with the identity the way the app seeds
// it. Sends a chat request, waits for the accept, sends `ping <nonce>`, waits
// for a reply. Exit 0 E2E_OK, 3 PEER_KEY_UNSUPPORTED, 4 E2E_TIMEOUT <stage>,
// 1 any other failure. Prints no secret.

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
const peerUsername = args.find((arg, i) => !arg.startsWith('--') && !flagValues.has(i));
const profile = flag('profile') ?? 'devnet';
const identityName = flag('identity') ?? 'pcde2e';
if (!peerUsername) {
  console.error('usage: npm run e2e:chat -- <peerUsername> [--profile devnet|paseo] [--identity <name>]');
  process.exit(2);
}
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

const textOf = (row) => (row.content.type === 'text' || row.content.type === 'reply' ? row.content.text : `[${row.content.type}]`);
const incoming = async () =>
  (await db.messages.toArray()).filter((row) => row.peerAccountId === peerAccountHex && row.direction === 'incoming');
// A bot answers the request itself (an echo bot echoes the empty opener) a
// moment after the accept. Let that land first, so it is not taken for the
// answer to the ping.
const greeting = await waitFor(async () => (await incoming())[0], GREETING_WAIT_MS);
if (greeting) console.log(`GREETING ${textOf(greeting).slice(0, 80)}`);
const before = new Set((await incoming()).map((row) => row.messageId));
const nonce = randomBytes(3).toString('hex');
try {
  await manager.sendMessage(peerAccountHex, { type: 'text', text: `ping ${nonce}` });
} catch (error) {
  finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`PING_SENT ping ${nonce}`);

const reply = await waitFor(async () => (await incoming()).find((row) => !before.has(row.messageId)));
if (!reply) finish(4, 'E2E_TIMEOUT reply');
console.log(`REPLY ${textOf(reply).slice(0, 80)}`);
console.log(`REPLY_HAS_NONCE ${textOf(reply).includes(nonce) ? 'yes' : 'no'}`);
finish(0, 'E2E_OK');
