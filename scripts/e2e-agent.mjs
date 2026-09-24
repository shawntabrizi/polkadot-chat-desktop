#!/usr/bin/env node
// M13 e2e: publish the desktop's agent and chat with it from another identity.
//   npm run e2e:agent [-- --identity pcdeceb] [--real-proxy] [--packaged]
//   npm run e2e:agent:packaged   (the same steps against the packaged app)
// --packaged runs dist/mac-arm64/Polkadot Chat.app (npm run package first):
// bot-core then loads from app.asar(.unpacked) in the packaged utility
// process, which the dev run (out/ + node_modules) cannot show.
// 1. The engine: by default a fake OpenAI-style server (scripts/lib/fake-openai.mjs),
//    so the answers are known: the greeting, then "Pick a colour." with a
//    `send_buttons` tool call (Red, Blue), then "You picked red." With
//    --real-proxy the app uses the LLM proxy and LLM_PROXY_KEY instead.
// 2. The app is built and started headless (PCD_HEADLESS=1) on a throwaway
//    profile (PCD_USER_DATA_DIR). Over CDP: Settings › Agent's calls, audience
//    "anyone", then the claim of a fresh username (pcdagent + 4 letters) on
//    devnet: AGENT_PUBLISHED <username>, AGENT_ATTESTED <ms> (the agent's
//    Consumers entry at the best block, before bot-core starts), then AGENT_RUNNING.
// 3. The sender is the test identity (default pcdeceb) through this repo's
//    domain code (Dexie on fake-indexeddb, as e2e-chat.mjs): it resolves the
//    agent at the best block, sends a chat request with no text, and waits for
//    the accept (ACCEPTED), the botInfo with /help /about /stop (BOTINFO) and
//    the greeting in the Assistant's persona (GREETED).
// 4. It asks for a choice: the answer is a spec 0006 keyboard (ANSWER_KEYBOARD),
//    never JSON; it presses "Red" (a command button: the text "red" goes as its
//    own message) and gets the answer (PRESS_ANSWERED).
// 5. The budget, from the agent's own count of bot-core submissions to the
//    sender: each question costs exactly one submission for its reply (the
//    reply, the seen and any botInfo ride one statement) and no typing is sent.
//    BUDGET_OK. Then AGENT_OK.
// Exit 0 AGENT_OK; 4 AGENT_TIMEOUT <stage>; 1 AGENT_FAIL <why>. Prints no secret.

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { paseoPeopleNext, productsDevnetPeople } from '@polkadot-api/descriptors';
import { register } from 'tsx/esm/api';

import { build, launch, packagedBin, root, writeAssistantSettings } from './lib/app.mjs';
import { startFakeOpenAi } from './lib/fake-openai.mjs';

register();
const load = path => import(pathToFileURL(join(root, path)).href);

const args = process.argv.slice(2);
const identityName = args.includes('--identity') ? args[args.indexOf('--identity') + 1] : 'pcdeceb';
const realProxy = args.includes('--real-proxy');
const packaged = args.includes('--packaged');
const profile = 'devnet';
const STAGE_MS = 180_000;
const POLL_MS = 1_000;
/** A person's pause between reading an answer and typing the next message (longer than the 5 s cooldown and the 5 s seen window). */
const PAUSE_MS = 6_000;

const delay = ms => new Promise(done => setTimeout(done, ms));
const hexOf = bytes => `0x${Buffer.from(bytes).toString('hex')}`;
const bytesOf = hex => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = line => console.log(`${at()} ${line}`);
const waitFor = async (probe, ms = STAGE_MS) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await delay(POLL_MS);
  }
  return null;
};

const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
if (!existsSync(identityFile)) {
  console.log(`AGENT_FAIL no test identity at ${identityFile}`);
  process.exit(1);
}
if (realProxy && !process.env.LLM_PROXY_KEY) {
  console.log('AGENT_FAIL --real-proxy needs LLM_PROXY_KEY');
  process.exit(1);
}

// ── The engine ──────────────────────────────────────────────────────────────

const lastUser = request => [...(request.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
const fake = realProxy
  ? null
  : await startFakeOpenAi(
      request => {
        const text = lastUser(request);
        if (/greet them/i.test(text)) return { text: 'Hello! I am a test agent. Ask me anything.' };
        if (/^red$/i.test(text.trim())) return { text: 'You picked red.' };
        return { text: 'Pick a colour.', toolCall: { name: 'send_buttons', arguments: JSON.stringify({ rows: [[{ label: 'Red', action: { command: 'red' } }, { label: 'Blue', action: { command: 'blue' } }]] }) } };
      },
      { pieceDelayMs: 20 },
    );

// ── Modules for the sender ──────────────────────────────────────────────────

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
setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
setMetadataCache(metadataCache());

let app = null;
let manager = null;
let appProfile = null;
const finish = async (code, line) => {
  if (line) console.log(line);
  if (code !== 0 && app) {
    // The agent's own log (Settings › Agent) says where it stopped.
    const log = await app.evaluate('window.desktop.agent.status().then(s => s.log)').catch(() => []);
    for (const entry of log.slice(-25)) console.log(`  agent log: ${entry.kind} ${entry.text}`);
  }
  await app?.quit().catch(() => undefined);
  await fake?.close();
  if (appProfile) rmSync(appProfile, { recursive: true, force: true });
  // Closing the People connection rejects its pending reads; the run is over by then.
  process.on('unhandledRejection', () => undefined);
  process.on('uncaughtException', () => undefined);
  try {
    manager?.dispose();
    disposePeopleConnection();
  } catch {
    // closing anyway
  }
  process.exit(code);
};

// ── 1. Publish the agent ────────────────────────────────────────────────────

if (packaged) say(`packaged app ${packagedBin}`);
else {
  build();
  say('built');
}
appProfile = mkdtempSync(join(tmpdir(), 'pcd-e2e-agent-'));
if (fake) writeAssistantSettings(appProfile, { engine: 'proxy', baseUrl: fake.baseUrl });
else writeAssistantSettings(appProfile, { engine: 'proxy' });
app = await launch(appProfile, { env: fake ? { LLM_PROXY_KEY: 'fake-key-for-e2e' } : {}, packaged });
if (!(await app.waitFor('!!window.desktop?.agent', 60_000))) await finish(1, 'AGENT_FAIL the app has no agent API');
const status = () => app.evaluate('window.desktop.agent.status()');
await app.evaluate(`window.desktop.agent.update({ audience: 'anyone' }).then(() => true)`);
const base = `pcdagent${Array.from(randomBytes(4), byte => String.fromCharCode(97 + (byte % 26))).join('')}`;
say(`claim ${base} on ${profile} (engine: ${fake ? 'fake OpenAI server' : 'LLM proxy'})`);
let claimed;
try {
  claimed = await app.evaluate(`window.desktop.agent.claim({ username: ${JSON.stringify(base)}, digits: null, profile: ${JSON.stringify(profile)} })`);
} catch (error) {
  await finish(1, `AGENT_FAIL claim: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
}
say(`AGENT_PUBLISHED ${claimed.username} confirmed=${claimed.confirmed}`);
const agentAccount = claimed.accountHex.toLowerCase();
// bot-core starts only after the agent's Consumers entry is visible at the best block (the statement allowance comes with it).
const attestedLine = /The network attested the agent after (\d+) ms/;
const attested = await waitFor(async () => (await status()).log.find(entry => attestedLine.test(entry.text)), 180_000);
if (!attested) await finish(4, `AGENT_TIMEOUT attestation (state ${(await status()).attestation})`);
say(`AGENT_ATTESTED ${attestedLine.exec(attested.text)[1]}`);
const running = await waitFor(async () => (await status()).state === 'running', 120_000);
if (!running) await finish(4, `AGENT_TIMEOUT running (state ${(await status()).state}; log: ${JSON.stringify((await status()).log.slice(-5))})`);
say('AGENT_RUNNING');
const order = (await status()).log.map(entry => entry.text);
if (order.findIndex(text => text.startsWith('Starting as')) < order.findIndex(text => attestedLine.test(text))) await finish(1, 'AGENT_FAIL bot-core started before the attestation');

// ── 2. The sender ───────────────────────────────────────────────────────────

const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
const selfKeys = deriveIdentityKeys(saved.mnemonic);
if (hexOf(selfKeys.accountId) !== saved.accountHex) await finish(1, 'AGENT_FAIL the identity file does not derive its account');
if (saved.accountHex.toLowerCase() === agentAccount) await finish(1, 'AGENT_FAIL the agent reuses the sender key');
say(`SENDER ${saved.username}`);
const senderKey = saved.accountHex.toLowerCase().replace(/^0x/, '');

const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
const client = connection.lazyClient.getClient();
const people = client.getTypedApi(profile === 'paseo' ? paseoPeopleNext : productsDevnetPeople);
const best = { at: 'best' };
const read = (label, fn) => retryOnNextEndpoint(() => withTimeout(fn(), READ_TIMEOUT_MS, label), connection.switchEndpoint);
await retryOnNextEndpoint(() => awaitBestRuntime(client), connection.switchEndpoint);
// The agent's key at the best block (a fresh registration can take a few blocks to show).
const agentKey = await waitFor(async () => {
  const owner = await read('username lookup', () => people.query.Resources.UsernameOwnerOf.getValue(new TextEncoder().encode(claimed.username), best)).catch(() => null);
  if (typeof owner !== 'string' || owner === '') return null;
  const value = await read('identifier lookup', () => people.query.Resources.Consumers.getValue(owner, best)).catch(() => null);
  return value?.identifier_key == null ? null : String(value.identifier_key).toLowerCase();
});
if (!agentKey) await finish(4, 'AGENT_TIMEOUT agent key on chain');
const peer = { accountId: bytesOf(agentAccount), username: claimed.username, chatPublicKey: bytesOf(agentKey).slice(1, 33) };

await seedSelfIdentity(
  { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
  selfKeys.accountId,
);
const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup: createIdentityLookup(connection), onConnectionStatus: connection.onStatus });

const incoming = async () =>
  (await db.messages.toArray()).filter(row => row.peerAccountId === agentAccount && row.direction === 'incoming').sort((a, b) => a.timestamp - b.timestamp);
const textOf = row => (row.content.type === 'text' || row.content.type === 'reply' || row.content.type === 'buttons' ? row.content.text : `[${row.content.type}]`);
const submissions = async () => (await status()).stats.perPeer[senderKey]?.submissions ?? 0;
const replies = async () => (await status()).stats.perPeer[senderKey]?.replies ?? 0;
const jsonShown = row => /"rows"|"label"|```/.test(textOf(row));

// ── 3. Request, accept, botInfo, greeting ───────────────────────────────────

await manager.sendRequest(peer, null);
say('REQUEST_SENT (no text)');
const contact = await waitFor(() => db.contacts.get(agentAccount));
if (!contact) await finish(4, 'AGENT_TIMEOUT accept');
say(`ACCEPTED devices=${contact.devices.length}`);
const info = await waitFor(async () => (await db.peerInfo.get(agentAccount))?.botInfo ?? null, 60_000);
if (!info) await finish(4, 'AGENT_TIMEOUT botInfo');
const commands = info.commands.map(command => command.name).join(',');
say(`BOTINFO kind=${info.kind} name=${info.name} commands=${commands}`);
if (commands !== 'help,about,stop') await finish(1, `AGENT_FAIL botInfo commands ${commands}`);
const greeting = await waitFor(async () => (await incoming())[0], 60_000);
if (!greeting) await finish(4, 'AGENT_TIMEOUT greeting');
say(`GREETED "${textOf(greeting).slice(0, 80)}"`);
// The greeting is the engine's, in the Assistant's persona: never bot-core's fixed welcome.
if (/Connecting you to the agent/.test(textOf(greeting))) await finish(1, 'AGENT_FAIL the greeting is bot-core\'s fixed welcome, not the engine\'s');
if (fake && !fake.requests.some(request => /greet them/i.test(lastUser(request)))) await finish(1, 'AGENT_FAIL the engine was not asked for the greeting');

// ── 4. A question, a keyboard, a press ──────────────────────────────────────

/** Sends `send()`, waits for the next incoming row, and measures the submissions the reply cost. */
const turn = async (label, send) => {
  await delay(PAUSE_MS);
  const known = new Set((await incoming()).map(row => row.messageId));
  const [s0, r0] = [await submissions(), await replies()];
  await send();
  const answer = await waitFor(async () => (await incoming()).find(row => !known.has(row.messageId)));
  if (!answer) await finish(4, `AGENT_TIMEOUT ${label}`);
  // The reply's statement is counted when bot-core logs it; give the log a moment.
  await waitFor(async () => (await replies()) > r0 && (await submissions()) > s0, 10_000);
  await delay(1_500);
  const cost = { submissions: (await submissions()) - s0, replies: (await replies()) - r0 };
  return { answer, cost };
};

const asked = await turn('answer', () => manager.sendMessage(agentAccount, { type: 'text', text: 'Which colour do you like? Let me pick with buttons.' }));
const keyboard = asked.answer.content.type === 'buttons' ? asked.answer.content.rows.flat().map(button => button.label) : [];
say(`ANSWER "${textOf(asked.answer).slice(0, 60)}" keyboard=[${keyboard.join(', ')}] submissions=${asked.cost.submissions} replies=${asked.cost.replies}`);
if (jsonShown(asked.answer)) await finish(1, 'AGENT_FAIL the answer shows button JSON');
if (asked.answer.content.type !== 'buttons') await finish(1, 'AGENT_FAIL the answer has no keyboard');
say('ANSWER_KEYBOARD');

const redIndex = asked.answer.content.rows.flat().findIndex(button => /red/i.test(button.label));
const pressAt = redIndex >= 0 ? redIndex : 0;
const rowOf = (() => {
  let left = pressAt;
  for (const [r, row] of asked.answer.content.rows.entries()) {
    if (left < row.length) return { row: r, index: left };
    left -= row.length;
  }
  return { row: 0, index: 0 };
})();
const pressed = await turn('press answer', () => manager.pressButton(agentAccount, asked.answer.messageId, rowOf.row, rowOf.index));
say(`PRESS_ANSWERED "${textOf(pressed.answer).slice(0, 60)}" submissions=${pressed.cost.submissions} replies=${pressed.cost.replies}`);
if (jsonShown(pressed.answer)) await finish(1, 'AGENT_FAIL the press answer shows button JSON');

// ── 5. The budget ───────────────────────────────────────────────────────────

const final = await status();
const typingRows = (await db.messages.toArray()).filter(row => row.peerAccountId === agentAccount && row.content.type === 'typing').length;
say(`TOTALS replies=${final.stats.perPeer[senderKey]?.replies} submissions=${final.stats.perPeer[senderKey]?.submissions} (the accept and the greeting included) typing=${typingRows}`);
for (const [label, cost] of [['answer', asked.cost], ['press', pressed.cost]]) {
  if (cost.replies !== 1 || cost.submissions !== 1) await finish(1, `AGENT_FAIL budget: the ${label} cost ${cost.submissions} submissions for ${cost.replies} replies`);
}
say('BUDGET_OK one submission per reply');
await finish(0, 'AGENT_OK');
