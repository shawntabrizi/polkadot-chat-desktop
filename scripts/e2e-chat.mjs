#!/usr/bin/env node
// Headless chat round trip with a live peer, through this repo's domain code:
//   npm run e2e:chat -- <peerUsername> [--profile devnet|paseo] [--identity <name>] [--delete]
// Reuses .agent-runs/identity-<name>/identity.json (M1's script writes it) or
// registers <name> + 4 random letters with M1's createIdentity. Dexie runs on
// fake-indexeddb (memory only), seeded with the identity the way the app seeds
// it. Sends a chat request, waits for the accept, sends `ping <nonce>`, waits
// for a reply. Exit 0 E2E_OK, 3 PEER_KEY_UNSUPPORTED, 4 E2E_TIMEOUT <stage>,
// 1 any other failure. Prints no secret.
// --delete (M7, RFC-0003): after the reply, sends `delete me <nonce>`, lets
// the echo land, deletes it for everyone (DELETE_SENT <messageId>), then sends
// `ping <nonce>` again and waits for the answer. A bot with the pca RFC-0003
// half logs BOT_RECEIVED_DELETED; that log is the bot's, not checked here.
// --live-frame (M7 screenshots): after the reply, sends one text shaped like a
// pca live progress frame (`⏳ working · …`), so the peer shows a thinking row.
// --buttons (M8 screenshots): after the reply (and the live frame), sends one
// spec 0006 keyboard (kind 242) with two rows: callback, command, url, and a
// reserved tx button. The test identity acts as the operator flag here.
// --botinfo (M10 screenshots): after the keyboard, sends one spec 0008
// `botInfo` (kind 244, an AI agent with a description, a greeting and five
// commands) on the identity channel, as a bot does after it accepts. The
// test identity acts as the operator flag here; a person's client never
// sends it.
// --tx (M11 screenshots): with --botinfo, the agent's botInfo also carries a
// spec 0008 v2 `balance` hint (M11b) naming the Meter contract of
// docs/spec/contracts/meter.md, so the app shows "with Meter: …" under the
// name, read from the chain for the app's own account; after the botInfo,
// sends one keyboard with a spec 0007 `tx` button: a plain
// `Balances.transfer_keep_alive` of 0.01 PAS on devnet Asset Hub from the
// peer's account to itself (kind 0 call data, encoded with the Asset Hub
// descriptors). The app dry-runs and signs it; this script never signs.
// --seen (M9 screenshots): after all of the above, the script stays and reads
// the room like an open app window: every second, a new message from the
// peer is marked read (manager.markRead), which sends spec 0005 `seen`.
// --typing (M9 screenshots): also stays; each new peer message that contains
// "working" starts a 20 s agent turn: `typing{working}` every 4 s, as a pca
// bot sends while it works, then `typing{stopped}`.
// With --seen or --typing the script runs until it is stopped (at most 15 min).

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
const deleteRun = args.includes('--delete');
const liveFrameRun = args.includes('--live-frame');
const buttonsRun = args.includes('--buttons');
const seenRun = args.includes('--seen');
const typingRun = args.includes('--typing');
const botInfoRun = args.includes('--botinfo');
const txRun = args.includes('--tx');
if (!peerUsername) {
  console.error('usage: npm run e2e:chat -- <peerUsername> [--profile devnet|paseo] [--identity <name>] [--delete] [--live-frame] [--buttons] [--botinfo] [--tx] [--seen] [--typing]');
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

if (deleteRun) {
  /** Sends one text and waits for the next incoming row after it. */
  const sendAndWait = async (text, stage) => {
    const seen = new Set((await incoming()).map((row) => row.messageId));
    try {
      await manager.sendMessage(peerAccountHex, { type: 'text', text });
    } catch (error) {
      finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
    }
    const own = (await db.messages.toArray()).find((row) => row.peerAccountId === peerAccountHex && row.direction === 'outgoing' && textOf(row) === text);
    const answer = await waitFor(async () => (await incoming()).find((row) => !seen.has(row.messageId)));
    if (!answer) finish(4, `E2E_TIMEOUT ${stage}`);
    return { own, answer };
  };

  const doomedText = `delete me ${randomBytes(3).toString('hex')}`;
  const doomed = await sendAndWait(doomedText, 'echo of the message to delete');
  console.log(`DOOMED_SENT ${doomedText}`);
  console.log(`DOOMED_ECHO ${textOf(doomed.answer).slice(0, 80)}`);
  try {
    await manager.deleteForEveryone(peerAccountHex, doomed.own.messageId);
  } catch (error) {
    finish(1, `DELETE_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`DELETE_SENT ${doomed.own.messageId}`);
  const local = await db.messages.get(doomed.own.messageId);
  console.log(`LOCAL_TOMBSTONE ${local?.content.type === 'deleted' ? 'yes' : 'no'}`);
  if (local?.content.type !== 'deleted') finish(1, 'DELETE_FAIL the local row is not a tombstone');

  const after = `ping ${randomBytes(3).toString('hex')}`;
  const { answer } = await sendAndWait(after, 'reply after the deletion');
  console.log(`PING_SENT ${after}`);
  console.log(`REPLY ${textOf(answer).slice(0, 80)}`);
  console.log(`REPLY_HAS_NONCE ${textOf(answer).includes(after.slice(5)) ? 'yes' : 'no'}`);
  // The bot must not answer from the deleted message.
  const quoted = textOf(answer).includes(doomedText);
  console.log(`REPLY_QUOTES_DELETED ${quoted ? 'yes' : 'no'}`);
  if (quoted) finish(1, 'DELETE_FAIL the reply after the deletion quotes the deleted text');
}

if (liveFrameRun) {
  // The text bot-core's createProgressTracker renders mid-turn.
  const frame = '⏳ working · 12s · step 2\n▸ Reading notes.md\n▸ Searching the People chain';
  try {
    await manager.sendMessage(peerAccountHex, { type: 'text', text: frame });
  } catch (error) {
    finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  const sent = await waitFor(async () =>
    (await db.messages.toArray()).find((row) => row.peerAccountId === peerAccountHex && textOf(row) === frame && row.status === 'delivered'),
  );
  console.log(`LIVE_FRAME_SENT ${sent ? 'delivered' : 'not acked'}`);
}
if (buttonsRun) {
  const text = 'What would you like to do?';
  const rows = [
    [
      { label: 'Show my balance', action: { tag: 'callback', value: new TextEncoder().encode('balance') } },
      { label: 'Staking', action: { tag: 'command', value: '/staking' } },
    ],
    [
      { label: 'Open the docs', action: { tag: 'url', value: 'https://docs.polkadot.com/' } },
      { label: 'Stake 10 DOT', action: { tag: 'tx', value: new Uint8Array([0]) } },
    ],
  ];
  try {
    await manager.sendButtons(peerAccountHex, { text, rows, oneShot: false });
  } catch (error) {
    finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  const sent = await waitFor(async () =>
    (await db.messages.toArray()).find((row) => row.peerAccountId === peerAccountHex && row.content.type === 'buttons' && row.status === 'delivered'),
  );
  console.log(`BUTTONS_SENT ${sent ? 'delivered' : 'not acked'}`);
}
if (botInfoRun) {
  const info = {
    kind: 1,
    name: 'Staking Helper',
    description: 'Answers staking questions and checks your rewards',
    greeting: 'Hi! I explain staking on Polkadot. Type / to see what I can do.',
    commands: [
      { name: 'staking', description: 'How staking works' },
      { name: 'rewards', description: 'Your rewards this era' },
      { name: 'validators', description: 'Pick validators to nominate' },
      { name: 'start', description: 'Start over' },
      { name: 'help', description: 'What I can do' },
    ],
    version: txRun ? 3 : 1,
    // M11b: the hint pcdmeter declares (docs/spec/contracts/meter.md), as test data.
    balance: txRun
      ? {
          chainId: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
          contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
          selector: '0x70a08231',
          decimals: 18,
          unit: 'PAS',
          perReply: '100000000000000000',
          label: 'with Meter',
        }
      : null,
  };
  try {
    await manager.sendBotInfo(peerAccountHex, info);
  } catch (error) {
    finish(1, `SEND_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`BOTINFO_SENT commands=${info.commands.length}`);
}
if (txRun) {
  const { openAssetHub } = await load('src/main/chain/assetHub.ts');
  const { encodeTxIntent } = await load('src/shared/txIntent.ts');
  let chain = null;
  try {
    chain = await openAssetHub(profile);
    // 0.01 PAS (10 decimals) from the peer's account (the signer) to itself.
    const callData = await chain.api.tx.Balances.transfer_keep_alive({ dest: { type: 'Id', value: ss58.dec(bytesOf(peerAccountHex)) }, value: 100_000_000n }).getEncodedData();
    const intent = encodeTxIntent({
      version: 1,
      chainId: chain.genesis,
      calls: [{ kind: 0, to: undefined, data: callData, value: 0n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
      display: { title: 'Send to yourself', description: 'A test transfer of 0.01 PAS from your account back to it', amount: '0.01', asset: 'PAS' },
      dryRunRequired: true,
      expiresAt: BigInt(Date.now() + 30 * 60_000),
    });
    await manager.sendButtons(peerAccountHex, {
      text: 'Try a transaction: it only costs the network fee.',
      rows: [[{ label: 'Send 0.01 PAS to yourself', action: { tag: 'tx', value: intent } }]],
      oneShot: false,
    });
  } catch (error) {
    finish(1, `TX_FAIL ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    chain?.destroy();
  }
  const sent = await waitFor(async () =>
    (await db.messages.toArray()).find(
      (row) => row.peerAccountId === peerAccountHex && row.content.type === 'buttons' && row.content.rows.flat().some((b) => b.action.kind === 'tx') && row.status === 'delivered',
    ),
  );
  console.log(`TX_BUTTON_SENT ${sent ? 'delivered' : 'not acked'}`);
}
if (seenRun || typingRun) {
  const LINGER_MS = 15 * 60_000;
  const TURN_MS = 20_000;
  const REFRESH_MS = 4_000;
  console.log(`LINGER seen=${seenRun} typing=${typingRun}`);
  const handled = new Set((await incoming()).map((row) => row.messageId));
  let lastRead = null;
  let turnUntil = 0;
  let lastTypingAt = 0;
  const until = Date.now() + LINGER_MS;
  while (Date.now() < until) {
    // toArray() is in id order; the newest message is the latest timestamp.
    const rows = (await incoming()).sort((a, b) => a.timestamp - b.timestamp);
    const newest = rows.at(-1);
    if (seenRun && newest && newest.messageId !== lastRead) {
      lastRead = newest.messageId;
      await manager.markRead(peerAccountHex);
      console.log(`SEEN_SENT upTo=${newest.messageId}`);
    }
    for (const row of rows) {
      if (handled.has(row.messageId)) continue;
      handled.add(row.messageId);
      if (typingRun && /working/i.test(textOf(row))) {
        turnUntil = Date.now() + TURN_MS;
        lastTypingAt = 0;
        console.log('TURN_START');
      }
    }
    const now = Date.now();
    if (turnUntil > 0 && now < turnUntil && now - lastTypingAt >= REFRESH_MS) {
      lastTypingAt = now;
      await manager.sendTyping(peerAccountHex, 'working', now + 6_000).catch((error) => console.log(`TYPING_FAIL ${error.message}`));
      console.log('TYPING_SENT working');
    }
    if (turnUntil > 0 && now >= turnUntil) {
      turnUntil = 0;
      await manager.sendTyping(peerAccountHex, 'stopped', now).catch((error) => console.log(`TYPING_FAIL ${error.message}`));
      console.log('TYPING_SENT stopped');
    }
    await delay(1_000);
  }
}
finish(0, 'E2E_OK');
