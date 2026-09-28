#!/usr/bin/env node
// M10a "Sign in with Polkadot app", the desktop half, headless, through this
// repo's domain code:
//   npm run e2e:pair
// A script plays the phone (domain/pairing/testing/publishPairingResponse.ts
// and phoneAnswer.ts: the Android answer bytes) on an in-memory Statement
// Store, so no network, no allowance and no username are needed. Steps, as
// the first-run screen runs them (ui/Pair.tsx, ui/App.tsx `start`):
//   QR_SHOWN         startSignIn with fresh device keys; the polkadotapp:// offer
//   PENDING          the phone answers Pending(AllowanceAllocation)
//   SUCCESS          the phone answers Success, signed by its statement account
//   SAVED            savePaired through a stand-in of main's IPC (the same
//                    shared codec main seals; safeStorage is main's, tested in
//                    pairedStore.spec.ts)
//   SEEDED           a restart: ensurePairedIdentitySeeded, getDeviceKeys, readUserIdentity
//   CHAT_READY       the chat manager runs as the identity, signing as the device
//   NO_ALLOWANCE     the start-up allowance read (none: the phone's slot is not
//                    on this fake chain) raises the reconnect banner state
//   SIGNER_IS_DEVICE a chat request from the app is signed by the device
//                    statement account, not the identity account
//   INCOMING         a peer's chat request to the IDENTITY (encrypted to the
//                    phone's identity chat key) lands in the app's requests
// Exit 0 PAIR_OK, 1 PAIR_FAILED <stage> <reason>. Prints no secret.
// The real scan against the owner's phone is not this script (docs/acceptance.md).

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

// One tsx loader for the whole process: one Dexie, one set of modules.
register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(join(root, path)).href);

const { createInMemoryStatementStore, createExpiryAllocator } = await import('@novasamatech/statement-store');
const { startSignIn } = await load('src/renderer/domain/pairing/signIn.ts');
const { phoneAnswer, pendingAnswer, successAnswer } = await load('src/renderer/domain/pairing/testing/phoneAnswer.ts');
const { publishPairingResponse } = await load('src/renderer/domain/pairing/testing/publishPairingResponse.ts');
const { generateEncryptionPrivateKey, generateStatementAccountSeed, toDeviceKeys } = await load('src/renderer/domain/device/keys.ts');
const { getDeviceKeys } = await load('src/renderer/domain/device/repository.ts');
const { ensurePairedIdentitySeeded, pairedIdentityOf } = await load('src/renderer/domain/identity/pairedIdentity.ts');
const { readUserIdentity } = await load('src/renderer/domain/identity/userIdentity.ts');
const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
const { sendChatRequest } = await load('src/renderer/domain/requests/gateway.ts');
const { makePeer } = await load('src/renderer/domain/testing/peers.ts');
const { db } = await load('src/renderer/app/database.ts');
const { bytesToHex } = await load('src/renderer/app/bytes.ts');
const { decodePairedSecrets, encodePairedSecrets, pairedIdentityProblem, pairedPublicOf, pairedSummaryOf } = await load('src/shared/pairedIdentity.ts');

const STAGE_MS = 15_000;
let stage = 'start';
const fail = (reason) => {
  console.log(`PAIR_FAILED ${stage} ${reason}`);
  process.exit(1);
};
const waitFor = async (probe, what) => {
  const until = Date.now() + STAGE_MS;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 50));
  }
  fail(`timeout waiting for ${what}`);
};
const short = (bytes) => `${bytesToHex(bytes).slice(0, 10)}…`;

// Every statement that reaches the store, with its signer, so the run can say who signed what.
const inner = createInMemoryStatementStore();
const submitted = [];
const store = {
  ...inner,
  submitStatement: (statement) => {
    submitted.push({ signer: statement.proof?.value?.signer?.toLowerCase() ?? null, topics: statement.topics ?? [] });
    return inner.submitStatement(statement);
  },
};

// The stand-in of main's identity IPC: one sign-in, checked and kept as main keeps it (text in, text out).
let kept = null;
const identityApi = {
  get: async () => (kept ? pairedSummaryOf(kept.publicPart) : null),
  savePaired: async (identity) => {
    if (kept) throw new Error('This computer is already signed in with a phone.');
    const problem = pairedIdentityProblem(identity);
    if (problem) throw new Error(problem);
    kept = { publicPart: pairedPublicOf(identity), text: encodePairedSecrets(identity) };
  },
  pairedSecrets: async () => decodePairedSecrets(kept.text, kept.publicPart),
};

// ── The phone ─────────────────────────────────────────────────────────────
const phone = {
  statementAccount: crypto.getRandomValues(new Uint8Array(32)),
  identity: makePeer().identity,
  sso: crypto.getRandomValues(new Uint8Array(32)),
  deviceEnc: crypto.getRandomValues(new Uint8Array(32)),
  entropy: crypto.getRandomValues(new Uint8Array(32)),
};

// ── First run: the QR ─────────────────────────────────────────────────────
stage = 'qr';
const device = toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey());
const phases = [];
const signIn = startSignIn({
  statementStore: store,
  device,
  metadata: { hostName: 'Polkadot Chat Desktop', platformType: 'desktop' },
  onPhase: (phase) => phases.push(phase),
  onSuccess: (success) => identityApi.savePaired(pairedIdentityOf(success, device, 'devnet', 'alicephone.07')),
});
if (!/^polkadotapp:\/\/pair\?handshake=[0-9a-f]+$/.test(signIn.qrPayload)) fail('no pairing link');
console.log(`QR_SHOWN ${signIn.qrPayload.slice(0, 40)}… phase=${phases.at(-1)?.tag}`);

const answer = (inner) =>
  publishPairingResponse(store, device, phoneAnswer(device.encryptionPublicKey, inner), { signer: bytesToHex(phone.statementAccount) });

stage = 'pending';
await answer(pendingAnswer());
await waitFor(() => phases.at(-1)?.tag === 'allocating', 'allocating');
console.log('PENDING phase=allocating');

stage = 'success';
await answer(
  successAnswer({
    identityAccountId: phone.identity.identityAccountId,
    rootAccountId: phone.identity.rootAccountId,
    identityChatPrivateKey: phone.identity.identityChatPrivateKey,
    ssoEncPubKey: phone.sso,
    deviceEncPubKey: phone.deviceEnc,
    rootEntropySource: phone.entropy,
  }),
);
await waitFor(() => phases.at(-1)?.tag === 'done' || phases.at(-1)?.tag === 'error', 'done');
if (phases.at(-1)?.tag === 'error') fail(phases.at(-1).reason);
console.log(`SUCCESS phases=${phases.map((phase) => phase.tag).join('>')}`);

stage = 'saved';
const summary = await identityApi.get();
if (!summary?.paired || summary.accountHex !== bytesToHex(phone.identity.identityAccountId)) fail('summary is not the phone identity');
console.log(`SAVED ${summary.username} ${short(phone.identity.identityAccountId)} paired=${summary.paired}`);

// ── Restart as the identity (App.tsx `start`) ─────────────────────────────
stage = 'seeded';
await ensurePairedIdentitySeeded(summary, identityApi.pairedSecrets);
const [deviceKeys, identity] = await Promise.all([getDeviceKeys(), readUserIdentity()]);
if (!identity || bytesToHex(identity.identityAccountId) !== summary.accountHex) fail('identity row');
if (bytesToHex(deviceKeys.statementAccountPublicKey) !== bytesToHex(device.statementAccountPublicKey)) fail('device key is not the offer key');
if (bytesToHex(identity.peerStatementAccountId) !== bytesToHex(phone.statementAccount)) fail('phone statement account not kept');
console.log(`SEEDED device=${short(deviceKeys.statementAccountPublicKey)} identity=${short(identity.identityAccountId)} phone=${short(identity.peerStatementAccountId)}`);

stage = 'chat';
const peer = makePeer();
const lookup = {
  getPeerIdentity: async (accountId) =>
    bytesToHex(accountId) === bytesToHex(peer.identity.identityAccountId)
      ? { accountId, username: 'pcdpeer.47', chatPublicKey: peer.identity.identityChatPublicKey }
      : null,
};
const manager = await createChatManager({
  identity,
  deviceKeys,
  statementStore: store,
  lookup,
  username: summary.username,
  readAllowance: async () => false,
});
console.log(`CHAT_READY as=${summary.username}`);

stage = 'allowance';
await waitFor(() => manager.accountSpace.snapshot().noAllowance, 'no-allowance state');
console.log('NO_ALLOWANCE banner=on');

stage = 'signer';
const before = submitted.length;
await manager.sendRequest({ accountId: peer.identity.identityAccountId, username: 'pcdpeer.47', chatPublicKey: peer.identity.identityChatPublicKey }, null);
const mine = submitted.slice(before);
const deviceHex = bytesToHex(device.statementAccountPublicKey).toLowerCase();
const identityHex = bytesToHex(phone.identity.identityAccountId).toLowerCase();
if (mine.length === 0) fail('no statement submitted');
if (mine.some((entry) => entry.signer !== deviceHex)) fail(`a statement was not signed by the device (${mine.map((entry) => entry.signer?.slice(0, 10)).join(',')})`);
if (mine.some((entry) => entry.signer === identityHex)) fail('a statement was signed as the identity account');
console.log(`SIGNER_IS_DEVICE yes statements=${mine.length}`);

stage = 'incoming';
await sendChatRequest({
  recipientAccountId: phone.identity.identityAccountId,
  recipientChatPublicKey: phone.identity.identityChatPublicKey,
  senderIdentityAccountId: peer.identity.identityAccountId,
  senderIdentityChatPrivateKey: peer.identity.identityChatPrivateKey,
  senderDeviceEncryptionPublicKey: peer.device.encryptionPublicKey,
  senderDeviceSeed: peer.device.statementAccountSeed,
  welcomeMessage: 'hello phone identity',
  statementStore: store,
  allocator: createExpiryAllocator(),
});
const incoming = await waitFor(async () => (await db.requests.toArray()).find((row) => row.direction === 'incoming'), 'incoming request');
console.log(`INCOMING from=${incoming.peerUsername} welcome="${incoming.welcomeMessage}"`);

manager.dispose();
console.log('PAIR_OK');
process.exit(0);
