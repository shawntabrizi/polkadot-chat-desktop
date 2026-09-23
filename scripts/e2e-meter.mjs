#!/usr/bin/env node
// M11 e2e (spec 0007) against the live pca bots `pcdfaucet.NN` and
// `pcdmeter.NN` and devnet Asset Hub, through this repo's code:
//   npm run e2e:meter -- [--profile devnet] [--identity <name>=pcde2e] [--questions 3]
// Same setup as e2e-botinfo.mjs (the identity file, fake-indexeddb, the
// People connection). The bots' two digits are not fixed: both are found with
// the app's username search (domain/identity/search.ts).
//  1. Faucet: the app's "Get 1 PAS" path (domain/faucet/drip.ts) sends
//     `/drip <address>` to pcdfaucet; a reference with status >= 1 must come
//     back within 90 s (DRIP_OK).
//  2. Meter: request/accept with pcdmeter, `/topup`, and the "Top up 1 PAS"
//     `tx` button of its answer. The intent is dry-run and signed by the main
//     process's module (main/chain/assetHub.ts, the identity wallet key) and
//     the references go out through the renderer's runner, as in the app
//     (DRYRUN …, then TOPUP_OK once our reference is "in block").
//  3. The Meter balance at the best block (BALANCE …), three questions, and
//     the balance after each answer must drop (METERED_OK), then METER_OK.
// M11b: nothing here knows the Meter. The contract, the view, the decimals
// and the price per reply come from the `balance` hint of pcdmeter's spec
// 0008 botInfo (HINT …), as the app's room header reads them.
// Exit 0 METER_OK; 10 E2E_TIMEOUT <stage> on any timeout; 11 DRIP_REFUSED
// (the faucet bot answered with a text, e.g. its 10 min limit); 3
// PEER_KEY_UNSUPPORTED; 1 any other failure (NO_BALANCE_HINT: the bot's
// botInfo declares no balance). Prints no secret.

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

// One tsx loader for the whole process, so every module shares one instance.
register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(join(root, path)).href);

const POLL_MS = 1_000;
const ACCEPT_WAIT_MS = 120_000;
/** M11 step 7: the faucet's reference within 90 s. */
const DRIP_WAIT_MS = 90_000;
const BUTTON_WAIT_MS = 90_000;
const IN_BLOCK_WAIT_MS = 90_000;
/** A Haiku turn, then the bot's charge in a best block. */
const ANSWER_WAIT_MS = 150_000;
const CHARGE_WAIT_MS = 90_000;
/** The botInfo comes with the accept; a `/start` asks again. */
const HINT_WAIT_MS = 30_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const identityName = flag('identity') ?? 'pcde2e';
const questionCount = Number(flag('questions') ?? 3);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const oneLine = (text) => String(text).replace(/\s+/g, ' ').slice(0, 110);

const waitFor = async (probe, timeoutMs) => {
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
const { requestDrip } = await load('src/renderer/domain/faucet/drip.ts');
const { toSs58 } = await load('src/renderer/ui/format.ts');
const { createTxRunner } = await load('src/renderer/domain/chain/transactions.ts');
const { openAssetHub, createTxService } = await load('src/main/chain/assetHub.ts');
const { decodeTxIntent, formatUnits } = await load('src/shared/txIntent.ts');
const { decodeUint256, hintCalldata, hintLine, planckInHintUnits, reviveAddressOf } = await load('src/shared/balanceHint.ts');

setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
setMetadataCache(metadataCache());

let manager = null;
let chain = null;
let service = null;
let runner = null;
const finish = (code, line) => {
  if (line) console.log(line);
  for (const close of [() => runner?.dispose(), () => service?.dispose(), () => manager?.dispose(), () => chain?.destroy()]) {
    try {
      close();
    } catch (error) {
      console.warn('close failed', error);
    }
  }
  disposePeopleConnection();
  process.exit(code);
};
const timeout = (stage) => finish(10, `E2E_TIMEOUT ${stage}`);

// ── Identity (an existing test identity; the Meter needs a funded account) ──

const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
if (!existsSync(identityFile)) finish(1, `NO_IDENTITY ${identityFile} (run npm run e2e:chat -- <peer> --identity ${identityName} first)`);
const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
const selfKeys = deriveIdentityKeys(saved.mnemonic);
if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
console.log(`SELF ${saved.accountHex} ${saved.username}`);

// ── Connections: People (chat) and Asset Hub (transactions) ────────────────

const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
connection.onStatus((status) => console.log(`[ws] ${status}`));
const client = connection.lazyClient.getClient();
try {
  const head = await retryOnNextEndpoint(() => awaitBestRuntime(client), connection.switchEndpoint);
  console.log(`people best block #${head.number}`);
  chain = await openAssetHub(profile);
} catch (error) {
  finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
}
// The main process's signing service, with the identity wallet key (as ipc.ts builds it).
service = createTxService(chain, { publicKey: selfKeys.accountId, sign: selfKeys.sign });
const account = await chain.api.query.System.Account.getValue(service.address, { at: 'best' });
console.log(`ASSET_HUB ${chain.genesis.slice(0, 10)}… account ${service.address} free ${formatUnits(account.data.free)} PAS`);

await seedSelfIdentity(
  { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
  selfKeys.accountId,
);
const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
const lookup = createIdentityLookup(connection);
manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus });
runner = createTxRunner({ chain: { sign: service.sign, onTxStatus: service.onStatus }, sendReference: manager.sendReference });

const search = async (prefix) => (await searchUsernames(NETWORK_PROFILES[profile], prefix, selfKeys.accountId)).results;
/** The bot's username by search: `<name>.NN`. */
const findBot = async (name) => {
  const pattern = new RegExp(`^${name}\\.\\d{2}$`);
  const hits = await search(name);
  const hit = hits.find((row) => pattern.test(row.username));
  if (!hit) finish(1, `BOT_NOT_FOUND ${name} (search returned ${hits.map((row) => row.username).join(', ') || 'nothing'})`);
  console.log(`FOUND ${hit.username} ${hexOf(hit.accountId)}`);
  return { username: hit.username, accountHex: hexOf(hit.accountId), accountId: hit.accountId };
};

const rowsOf = async (peerHex) => listMessages(peerHex);
// pca status rows are not answers: live frames (⏳ / 🤔) and the "✓ Answered in …" receipt.
const isStatus = (row) => row.content.type === 'text' && /^(?:⏳|🤔|✓) /u.test(row.content.text);
const incomingAfter = async (peerHex, since) => (await rowsOf(peerHex)).filter((row) => row.direction === 'incoming' && row.timestamp >= since);

// ── 1. Faucet: /drip through the Faucet's "Get 1 PAS" path ─────────────────

const faucet = await findBot('pcdfaucet');
const dripStarted = Date.now() - 5_000;
const drip = await requestDrip(
  {
    contacts: () => db.contacts.toArray(),
    requests: () => db.requests.toArray(),
    search,
    getPeerIdentity: (accountId) => lookup.getPeerIdentity(accountId),
    sendMessage: (peer, text) => manager.sendMessage(peer, { type: 'text', text }),
    sendRequest: (peer, text) => manager.sendRequest(peer, text),
  },
  // The address the Faucet room sends (Shell passes toSs58 of the identity).
  toSs58(selfKeys.accountId),
);
console.log(`DRIP_SENT via=${drip.via} to=${drip.username} (/drip ${toSs58(selfKeys.accountId)})`);
const dripAnswer = await waitFor(async () => {
  const rows = await incomingAfter(faucet.accountHex, dripStarted);
  const reference = rows.find((row) => row.content.type === 'transactionReference');
  if (reference) return { reference };
  const text = rows.find((row) => row.content.type === 'text' && !isStatus(row));
  return text ? { text } : null;
}, DRIP_WAIT_MS);
if (!dripAnswer) timeout('drip reference (90 s)');
if (dripAnswer.text) {
  // The reference may still follow a text; give it the rest of the window.
  const late = await waitFor(async () => (await incomingAfter(faucet.accountHex, dripStarted)).find((row) => row.content.type === 'transactionReference'), 5_000);
  if (!late) finish(11, `DRIP_REFUSED ${oneLine(dripAnswer.text.content.text)}`);
  dripAnswer.reference = late;
}
{
  const reference = dripAnswer.reference.content.reference;
  if (reference.status === 'failed') finish(1, `DRIP_FAILED ${reference.note}`);
  console.log(`DRIP_OK status=${reference.status} block=${reference.block} note="${reference.note}" hash=${reference.hash} at=${at()}`);
}

// ── 2. Meter: accept, /topup, the Top up button ────────────────────────────

const meter = await findBot('pcdmeter');
if (!(await db.contacts.get(meter.accountHex))) {
  const peer = await lookup.getPeerIdentity(meter.accountId);
  if (!peer) finish(3, 'PEER_KEY_UNSUPPORTED pcdmeter');
  await manager.sendRequest(peer, null);
  console.log('REQUEST_SENT pcdmeter');
  if (!(await waitFor(() => db.contacts.get(meter.accountHex), ACCEPT_WAIT_MS))) timeout('pcdmeter accept');
  console.log(`ACCEPTED pcdmeter at=${at()}`);
}
// Let the bot's own answer to the request land first.
await delay(3_000);

// The bot's spec 0008 v2 `balance` hint, as the app stores it (peerInfo).
const storedHint = async () => (await db.peerInfo.get(meter.accountHex))?.botInfo?.balance ?? null;
let hint = await waitFor(storedHint, HINT_WAIT_MS);
if (!hint) {
  await manager.sendMessage(meter.accountHex, { type: 'text', text: '/start' });
  console.log('SENT /start (no botInfo with a balance hint yet)');
  hint = await waitFor(storedHint, HINT_WAIT_MS * 2);
}
if (!hint) finish(1, `NO_BALANCE_HINT botInfo=${JSON.stringify((await db.peerInfo.get(meter.accountHex))?.botInfo ?? null)}`);
console.log(`HINT label="${hint.label}" contract=${hint.contract} selector=${hint.selector} decimals=${hint.decimals} unit=${hint.unit} perReply=${hint.perReply} chain=${hint.chainId.slice(0, 10)}…`);

/** The hint's view for our account at the best block, in the hint's units (what the room header reads). */
const readBalance = async () => decodeUint256(await service.contractRead(hint.chainId, hint.contract, hintCalldata(hint.selector, reviveAddressOf(selfKeys.accountId)))) ?? 0n;
const before = await readBalance();
console.log(`BALANCE_BEFORE ${hintLine(hint, before)}`);

const topupAsked = Date.now() - 1_000;
await manager.sendMessage(meter.accountHex, { type: 'text', text: '/topup' });
console.log('SENT /topup');
const keyboard = await waitFor(
  async () =>
    (await incomingAfter(meter.accountHex, topupAsked)).find(
      (row) => row.content.type === 'buttons' && row.content.rows.flat().some((button) => button.action.kind === 'tx' && /^Top up/.test(button.label)),
    ),
  BUTTON_WAIT_MS,
);
if (!keyboard) timeout('Top up button');
const position = (() => {
  for (const [r, row] of keyboard.content.rows.entries()) for (const [i, button] of row.entries()) if (button.action.kind === 'tx') return { r, i, button };
  return null;
})();
const intent = decodeTxIntent(position.button.action.intent);
console.log(
  `BUTTON "${position.button.label}" text="${oneLine(keyboard.content.text)}" intent: ${intent.display.title} ${intent.display.amount ?? ''} ${intent.display.asset ?? ''}; calls=${intent.calls.length} kind=${intent.calls[0].kind} to=${hexOf(intent.calls[0].to ?? [])} value=${intent.calls[0].value}`,
);

const dryRun = await service.dryRun(position.button.action.intent);
console.log(`DRYRUN ok=${dryRun.ok} fee=${dryRun.fee ? `${formatUnits(BigInt(dryRun.fee))} PAS (${dryRun.fee} planck)` : '-'} mapsAccount=${dryRun.mapsAccount} value=${dryRun.value}${dryRun.error ? ` error="${dryRun.error}"` : ''}`);
if (!dryRun.ok) finish(1, 'TOPUP_DRYRUN_FAILED');
const note = `${intent.display.title} (${intent.display.amount} ${intent.display.asset})`;
const hash = await runner.run({ peer: meter.accountHex, dryRunId: dryRun.id, chainId: intent.chainId, note, intentMessageId: keyboard.messageId });
await manager.pressButton(meter.accountHex, keyboard.messageId, position.r, position.i);
console.log(`SIGNED hash=${hash} at=${at()}`);
const ownReference = async () =>
  (await rowsOf(meter.accountHex)).find((row) => row.direction === 'outgoing' && row.content.type === 'transactionReference' && row.content.reference.hash === hash);
const inBlock = await waitFor(async () => {
  const row = await ownReference();
  const status = row?.content.reference.status;
  return status === 'inBlock' || status === 'finalized' || status === 'failed' ? row : null;
}, IN_BLOCK_WAIT_MS);
if (!inBlock) timeout('top-up in block');
if (inBlock.content.reference.status === 'failed') finish(1, `TOPUP_FAILED ${inBlock.content.reference.error ?? ''}`);
console.log(`TOPUP_OK status=${inBlock.content.reference.status} block=${inBlock.content.reference.block} row="${oneLine(inBlock.content.reference.note)}" at=${at()}`);

// ── 3. Balance, three questions, the balance drops ─────────────────────────

const afterTopUp = await readBalance();
console.log(`BALANCE ${hintLine(hint, afterTopUp)} (${afterTopUp} ${hint.unit} units; before ${hintLine(hint, before)})`);
if (afterTopUp < before + (planckInHintUnits(hint, intent.calls[0].value) ?? 0n)) console.log('BALANCE_NOTE the top-up is not fully visible yet (a charge may have run meanwhile)');

const QUESTIONS = ['In one sentence: what is Polkadot?', 'In one sentence: what is a parachain?', 'In one sentence: what is Asset Hub?', 'In one sentence: what is a smart contract?'];
let last = afterTopUp;
let drops = 0;
for (let n = 0; n < questionCount; n++) {
  const question = QUESTIONS[n % QUESTIONS.length];
  const asked = Date.now() - 1_000;
  await manager.sendMessage(meter.accountHex, { type: 'text', text: question });
  const answer = await waitFor(
    async () => (await incomingAfter(meter.accountHex, asked)).find((row) => (row.content.type === 'text' || row.content.type === 'buttons') && !isStatus(row)),
    ANSWER_WAIT_MS,
  );
  if (!answer) timeout(`answer ${n + 1}`);
  console.log(`ANSWER ${n + 1} ${oneLine(answer.content.text)}`);
  const dropped = await waitFor(async () => {
    const balance = await readBalance();
    return balance < last ? { balance } : null;
  }, CHARGE_WAIT_MS);
  if (!dropped) timeout(`charge after answer ${n + 1}`);
  // The bot's charge reference names the new balance in planck (`balance: <planck>`, meter.md); it may land a moment later.
  const notePlanck = dropped.balance / (planckInHintUnits(hint, 1n) ?? 1n);
  const charge = await waitFor(
    async () => (await incomingAfter(meter.accountHex, asked)).find((row) => row.content.type === 'transactionReference' && row.content.reference.note === `balance: ${notePlanck}`),
    10_000,
  );
  console.log(`BALANCE ${hintLine(hint, dropped.balance)} (-${formatUnits(last - dropped.balance, hint.decimals)} ${hint.unit})${charge ? ` reference="${charge.content.reference.note}" ${charge.content.reference.status}` : ''} at=${at()}`);
  last = dropped.balance;
  drops += 1;
}
console.log(`METERED_OK ${drops} answers charged: ${formatUnits(afterTopUp, hint.decimals)} → ${formatUnits(last, hint.decimals)} ${hint.unit}`);
const finalized = await waitFor(async () => ((await ownReference())?.content.reference.status === 'finalized' ? true : null), 1);
console.log(`TOPUP_REFERENCE ${(await ownReference())?.content.reference.status}${finalized ? '' : ' (finality is shown when it comes; nothing waited for it)'}`);
finish(0, 'METER_OK');
