#!/usr/bin/env node
// M22b multi-device chat and device sync, the desktop half, headless, through
// this repo's domain code:
//   npm run e2e:mds
// A script plays the phone (and one contact) on an in-memory Statement Store:
// no network, no allowance, no username. Node has no WebRTC, so the data
// channel is the in-memory loopback link (domain/deviceSync/testing/loopback.ts);
// everything above it is real: the Statement Store session with the phone
// (DevicesSessionManager parameters), the offerId signalling with MinimalSetup
// SDP and candidates, the SyncMessage codec, the apply into Dexie. Steps:
//   PAIRED              pairing as e2e:pair (the phone's statement account is
//                       its identity account, as on Android)
//   DEVICE_ADDED        the phone tells the contact about this device (kind 17
//                       over its multi-device session); the contact reads it
//   SYNC_OPEN           the phone's sync engine and the app's (inside the chat
//                       manager) signal over the store and open the channel
//   CHAT_SYNCED         the phone's Update: ChatsAdded(contact), the contact's
//                       device as a synced DeviceAdded, one incoming and one
//                       own message -> a contact with a device and two rows here
//   CONTACT_TO_DEVICE   the contact, now knowing this device, sends a text; it
//                       arrives here live (multi-device wrapping, not sync)
//   OWN_TO_BOTH         a text sent here reaches the contact AND comes to the
//                       phone as a Messages update
//   REMOVED             the phone syncs DeviceRemoved(this device): sign-out fires
// Exit 0 MDS_OK, 1 MDS_FAILED <stage> <reason>. Prints no secret.

// Dexie needs an IndexedDB before app/database.ts is loaded.
import 'fake-indexeddb/auto';

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

// One tsx loader for the whole process: one Dexie, one loopback registry.
register();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(join(root, path)).href);

const { x25519 } = await import('@noble/curves/ed25519.js');
const { createInMemoryStatementStore, createExpiryAllocator, createSr25519Prover, createSr25519Secret, deriveSr25519PublicKey } = await import('@novasamatech/statement-store');
const { startSignIn } = await load('src/renderer/domain/pairing/signIn.ts');
const { phoneAnswer, successAnswer } = await load('src/renderer/domain/pairing/testing/phoneAnswer.ts');
const { publishPairingResponse } = await load('src/renderer/domain/pairing/testing/publishPairingResponse.ts');
const { generateEncryptionPrivateKey, generateStatementAccountSeed, toDeviceKeys } = await load('src/renderer/domain/device/keys.ts');
const { getDeviceKeys } = await load('src/renderer/domain/device/repository.ts');
const { ensurePairedIdentitySeeded, pairedIdentityOf } = await load('src/renderer/domain/identity/pairedIdentity.ts');
const { readUserIdentity } = await load('src/renderer/domain/identity/userIdentity.ts');
const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
const { createPeerRoster } = await load('src/renderer/domain/chat/peerRoster.ts');
const { createPeerSession } = await load('src/renderer/domain/chat/peerSession.ts');
const { createAccountSpace } = await load('src/renderer/domain/chat/accountSpace.ts');
const { createDeviceSync } = await load('src/renderer/domain/deviceSync/engine.ts');
const { createLoopbackLink } = await load('src/renderer/domain/deviceSync/testing/loopback.ts');
const { makePeer } = await load('src/renderer/domain/testing/peers.ts');
const { db } = await load('src/renderer/app/database.ts');
const { bytesToHex } = await load('src/renderer/app/bytes.ts');
const { decodePairedSecrets, encodePairedSecrets, pairedIdentityProblem, pairedPublicOf, pairedSummaryOf } = await load('src/shared/pairedIdentity.ts');

const STAGE_MS = 60_000;
let stage = 'start';
const fail = (reason) => {
  console.log(`MDS_FAILED ${stage} ${reason}`);
  process.exit(1);
};
const waitFor = async (probe, what, ms = STAGE_MS) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 50));
  }
  fail(`timeout waiting for ${what}`);
};
const short = (bytes) => `${bytesToHex(bytes).slice(0, 10)}…`;
const hex = (bytes) => bytesToHex(bytes).toLowerCase();

const store = createInMemoryStatementStore();

// ── The phone: its statement account IS its identity account (Android RealOurDevicesProvider) ──
const phoneSeed = createSr25519Secret(crypto.getRandomValues(new Uint8Array(32)));
const phoneChatPrivate = x25519.utils.randomSecretKey();
const phoneEncPrivate = x25519.utils.randomSecretKey();
const phone = {
  seed: phoneSeed,
  identity: {
    identityAccountId: deriveSr25519PublicKey(phoneSeed),
    rootAccountId: crypto.getRandomValues(new Uint8Array(32)),
    identityChatPrivateKey: phoneChatPrivate,
    identityChatPublicKey: x25519.getPublicKey(phoneChatPrivate),
    peerDeviceEncPubKey: new Uint8Array(32),
    peerStatementAccountId: null,
    pairedAt: 0,
  },
  deviceKeys: { statementAccountSeed: phoneSeed, statementAccountPublicKey: deriveSr25519PublicKey(phoneSeed), encryptionPrivateKey: phoneEncPrivate, encryptionPublicKey: x25519.getPublicKey(phoneEncPrivate) },
};
const phoneDevice = { statementAccountId: phone.identity.identityAccountId, encryptionPublicKey: phone.deviceKeys.encryptionPublicKey };

// ── Pairing (as e2e:pair) ─────────────────────────────────────────────────
stage = 'pair';
let kept = null;
const identityApi = {
  get: async () => (kept ? pairedSummaryOf(kept.publicPart) : null),
  savePaired: async (identity) => {
    const problem = pairedIdentityProblem(identity);
    if (problem) throw new Error(problem);
    kept = { publicPart: pairedPublicOf(identity), text: encodePairedSecrets(identity) };
  },
  pairedSecrets: async () => decodePairedSecrets(kept.text, kept.publicPart),
};
const device = toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey());
const phases = [];
startSignIn({
  statementStore: store,
  device,
  metadata: { hostName: 'Polkadot Chat Desktop', platformType: 'desktop' },
  onPhase: (phase) => phases.push(phase),
  onSuccess: (success) => identityApi.savePaired(pairedIdentityOf(success, device, 'devnet', 'alicephone.07')),
});
await publishPairingResponse(
  store,
  device,
  phoneAnswer(
    device.encryptionPublicKey,
    successAnswer({
      identityAccountId: phone.identity.identityAccountId,
      rootAccountId: phone.identity.rootAccountId,
      identityChatPrivateKey: phone.identity.identityChatPrivateKey,
      ssoEncPubKey: crypto.getRandomValues(new Uint8Array(32)),
      deviceEncPubKey: phoneDevice.encryptionPublicKey,
      rootEntropySource: crypto.getRandomValues(new Uint8Array(32)),
    }),
  ),
  { signer: bytesToHex(phone.identity.identityAccountId) },
);
await waitFor(() => phases.at(-1)?.tag === 'done' || phases.at(-1)?.tag === 'error', 'pairing done', 15_000);
if (phases.at(-1)?.tag === 'error') fail(phases.at(-1).reason);
const summary = await identityApi.get();
await ensurePairedIdentitySeeded(summary, identityApi.pairedSecrets);
const [deviceKeys, identity] = await Promise.all([getDeviceKeys(), readUserIdentity()]);
if (!identity || hex(identity.peerDeviceEncPubKey) !== hex(phoneDevice.encryptionPublicKey)) fail('the phone device key was not kept');
const ownDevice = { statementAccountId: deviceKeys.statementAccountPublicKey, encryptionPublicKey: deviceKeys.encryptionPublicKey };
console.log(`PAIRED identity=${short(identity.identityAccountId)} device=${short(ownDevice.statementAccountId)}`);

// ── A contact of the identity, with one device ────────────────────────────
const friend = makePeer();
const friendHex = bytesToHex(friend.identity.identityAccountId);
const friendDevice = { statementAccountId: friend.device.statementAccountPublicKey, encryptionPublicKey: friend.device.encryptionPublicKey };
const friendGot = [];
const friendRoster = createPeerRoster([phoneDevice]);
// The contact's session towards the identity (created first: the in-memory store does not replay).
const friendSession = createPeerSession({
  identity: friend.identity,
  deviceKeys: friend.device,
  peerIdentityAccountId: phone.identity.identityAccountId,
  peerIdentityChatPublicKey: phone.identity.identityChatPublicKey,
  peerRoster: friendRoster,
  prover: createSr25519Prover(friend.device.statementAccountSeed),
  allocator: createExpiryAllocator(),
  statementStore: store,
  onMessage: (message) => friendGot.push(message),
  onSent: () => undefined,
  onDelivered: () => undefined,
  onBatchDelivered: () => undefined,
});
// The phone's multi-device session towards the contact.
const phoneToFriend = createPeerSession({
  identity: phone.identity,
  deviceKeys: phone.deviceKeys,
  peerIdentityAccountId: friend.identity.identityAccountId,
  peerIdentityChatPublicKey: friend.identity.identityChatPublicKey,
  peerRoster: createPeerRoster([friendDevice]),
  prover: createSr25519Prover(phone.seed),
  allocator: createExpiryAllocator(),
  statementStore: store,
  onMessage: () => undefined,
  onSent: () => undefined,
  onDelivered: () => undefined,
  onBatchDelivered: () => undefined,
});

stage = 'device-added';
await phoneToFriend.send({ tag: 'deviceAdded', value: ownDevice }, { messageId: 'phone-device-added', timestamp: Date.now() });
const added = await waitFor(() => friendGot.find((m) => m.content.tag === 'deviceAdded'), 'the contact reading DeviceAdded', 15_000);
if (hex(added.content.value.statementAccountId) !== hex(ownDevice.statementAccountId)) fail('DeviceAdded names another device');
friendRoster.set([phoneDevice, ownDevice]);
console.log(`DEVICE_ADDED contact=${short(friend.identity.identityAccountId)} knows=${short(ownDevice.statementAccountId)} roster=2`);

// ── The phone's sync engine (the same engine, as the phone side) ──────────
stage = 'sync-open';
const phoneOutbox = [];
const phoneApplied = [];
const phoneSync = createDeviceSync({
  own: { statementAccountId: phoneDevice.statementAccountId, encryptionPrivateKey: phone.deviceKeys.encryptionPrivateKey },
  phone: ownDevice,
  prover: createSr25519Prover(phone.seed),
  allocator: createExpiryAllocator(),
  statementStore: store,
  linkFactory: createLoopbackLink,
  collect: async () => phoneOutbox.splice(0),
  apply: async (update) => void phoneApplied.push(update),
  space: createAccountSpace(),
  undeliveredSends: async () => 0,
  tightBudget: async () => false,
  bookkeeping: { readCheckpoint: async () => 0, writeCheckpoint: async () => undefined, nextUpdateId: (() => { let id = 0; return async () => ++id; })() },
  timing: { pushMs: 200 },
});
phoneSync.syncNow();

let removed = 0;
const lookup = {
  getPeerIdentity: async (accountId) =>
    bytesToHex(accountId) === friendHex ? { accountId, username: 'pcdfriend.12', chatPublicKey: friend.identity.identityChatPublicKey } : null,
};
const manager = await createChatManager({
  identity,
  deviceKeys,
  statementStore: store,
  lookup,
  username: summary.username,
  phone: {
    device: phoneDevice,
    linkFactory: createLoopbackLink,
    // The linked-device allowance (2 statements): tight; nothing undelivered yet, so sync goes.
    tightBudget: async () => true,
    onRemoved: () => removed++,
  },
});
await waitFor(() => manager.deviceSync.snapshot().state === 'syncing' && phoneSync.snapshot().state === 'syncing', 'both ends syncing');
console.log(`SYNC_OPEN app=${manager.deviceSync.snapshot().state} phone=${phoneSync.snapshot().state}`);

// ── The phone syncs a chat and its history ────────────────────────────────
stage = 'chat-synced';
const now = Date.now();
const incoming = (seen) => ({ tag: 'Incoming', value: { tag: seen ? 'SEEN' : 'NEW', value: undefined } });
const local = (id, at, content, status) => ({
  remote: { messageId: id, timestamp: BigInt(at), versioned: { tag: 'v1', value: content } },
  peerId: friend.identity.identityAccountId,
  status,
  order: BigInt(at),
});
phoneOutbox.push(
  { tag: 'ChatsAdded', value: [{ tag: 'Contact', value: friend.identity.identityAccountId }] },
  {
    tag: 'Messages',
    value: [
      // The phone keeps each contact device as a synthetic incoming DeviceAdded (IncomingChatRequestProcessor.kt:437).
      local('synthetic-device', now - 3_000, { tag: 'deviceAdded', value: friendDevice }, incoming(false)),
      local('friend-hello', now - 2_000, { tag: 'text', value: 'hello, read on the phone' }, incoming(true)),
      local('phone-reply', now - 1_000, { tag: 'text', value: 'reply sent from the phone' }, { tag: 'Outgoing', value: { tag: 'DELIVERED', value: undefined } }),
    ],
  },
);
const contact = await waitFor(async () => {
  const row = await db.contacts.get(friendHex);
  return row && row.devices.length > 0 ? row : null;
}, 'the synced contact with its device');
const synced = await waitFor(async () => {
  const rows = await db.messages.where('[peerAccountId+timestamp]').between([friendHex, 0], [friendHex, Infinity]).toArray();
  return rows.filter((row) => row.synced).length === 2 ? rows : null;
}, 'two synced rows');
const hello = synced.find((row) => row.messageId === 'friend-hello');
const reply = synced.find((row) => row.messageId === 'phone-reply');
if (hello?.direction !== 'incoming' || reply?.direction !== 'outgoing' || reply.status !== 'delivered') fail('synced rows have the wrong direction or status');
console.log(`CHAT_SYNCED contact=${contact.username} devices=${contact.devices.length} rows=${synced.map((row) => `${row.direction}:${row.status}`).join(',')} unread=${(await db.rooms.get(friendHex))?.unreadCount}`);

// ── The contact writes; this device reads it live ─────────────────────────
stage = 'contact-to-device';
await friendSession.send({ tag: 'text', value: 'live to all your devices' }, { messageId: 'friend-live', timestamp: Date.now() });
const live = await waitFor(() => db.messages.get('friend-live'), 'the contact’s live text here', 20_000);
if (live.synced) fail('the live text came through sync, not the session');
console.log(`CONTACT_TO_DEVICE text="${live.content.text}" via=session`);

// ── This device writes; the contact and the phone both get it ─────────────
stage = 'own-to-both';
await manager.sendMessage(friendHex, { type: 'text', text: 'sent from the desktop' });
const own = await waitFor(async () => (await db.messages.toArray()).find((row) => row.direction === 'outgoing' && !row.synced && row.content.type === 'text'), 'our row');
await waitFor(() => friendGot.find((m) => m.messageId === own.messageId), 'the contact reading our text', 20_000);
const toPhone = await waitFor(
  () => phoneApplied.flatMap((u) => u.entities).filter((e) => e.tag === 'Messages').flatMap((e) => e.value).find((m) => m.remote.messageId === own.messageId),
  'our text in an update to the phone',
  20_000,
);
console.log(`OWN_TO_BOTH contact=yes phone=${toPhone.status.tag}:${toPhone.status.value.tag}`);

// ── The phone removes this device ─────────────────────────────────────────
stage = 'removed';
phoneOutbox.push({
  tag: 'Messages',
  value: [local('phone-removed-me', Date.now(), { tag: 'deviceRemoved', value: { statementAccountId: ownDevice.statementAccountId } }, { tag: 'Outgoing', value: { tag: 'SENT', value: undefined } })],
});
await waitFor(() => removed > 0, 'the sign-out callback');
console.log(`REMOVED sign-out=${removed}`);

manager.dispose();
phoneSync.dispose();
friendSession.dispose();
phoneToFriend.dispose();
console.log('MDS_OK');
process.exit(0);
