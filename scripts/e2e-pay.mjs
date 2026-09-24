#!/usr/bin/env node
// M12g e2e: payments in a 1:1 chat between two test identities of this repo
// (never the owner's), on devnet Asset Hub, through this repo's code:
//   npm run e2e:pay -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdeceb]
//
// Each person is a child process (`--role a|b`): the app's database is one
// per process (Dexie over fake-indexeddb, as in e2e-flip.mjs). The parent
// says who does what and when:
//  0. both hold at least 1 PAS (else a drip from the faucet bot pcdfaucet.NN);
//     a sends b a chat request and b accepts it;
//  1. a requests 0.2 PAS from b: a `buttons` message with one `tx` button
//     (REQUEST_SENT); b sees it and reads it as a request (REQUEST_SEEN);
//  2. b checks the request pays a, dry-runs, signs, and posts one reference
//     with the note `req:<messageId>` (PAID);
//  3. a sees that reference and marks the request paid only after the
//     chain's `Balances.Transfer` of that extrinsic moved 0.2 PAS from b to a
//     (REQUEST_PAID); a's free balance rose by 0.2 PAS (BALANCE_OK);
//  4. b's dry-run of a send above its balance is refused (OVER_BALANCE_REFUSED);
//  5. b sends 0.1 PAS to a directly (SENT); a sees "sent you 0.1 PAS" and the
//     chain confirms it (RECEIVED).
// On PAY_OK the paid request (ids, hash, block; no secret) goes to
// .agent-runs/pay-last.json: screenshots.mjs shows it as room-request-paid.png.
// Exit 0 PAY_OK; 14 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any other
// failure. Prints no secret.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const profile = flag('profile') ?? 'devnet';
const role = flag('role');
const TIMEOUT_EXIT = 14;
const REQUEST_PAS = '0.2';
const SEND_PAS = '0.1';

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const identityFile = (name) => join(root, '.agent-runs', `identity-${name}`, 'identity.json');

if (role) await child(role);
else await parent();

// ── The parent: the order of the steps, and the end ────────────────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 3 * 60_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdeceb' };
  const saved = {};
  for (const [name, identity] of Object.entries(identities)) {
    if (!existsSync(identityFile(identity))) {
      console.log(`NO_IDENTITY ${identityFile(identity)} (npm run identity:register -- <letters>)`);
      process.exit(1);
    }
    const { username, accountHex } = JSON.parse(readFileSync(identityFile(identity), 'utf8'));
    saved[name] = { username, accountHex };
  }
  const people = {};
  let failing = false;

  const stopAll = () => {
    for (const person of Object.values(people)) if (person.proc.exitCode === null) person.proc.kill('SIGTERM');
  };
  const fail = (code, line) => {
    if (failing) return;
    failing = true;
    console.log(line);
    stopAll();
    setTimeout(() => process.exit(code), 1_500);
  };

  for (const [name, identity] of Object.entries(identities)) {
    const other = saved[name === 'a' ? 'b' : 'a'];
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identity, '--profile', profile, '--other', other.accountHex, '--other-name', other.username], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const person = { name, proc, lines: [], waiters: [] };
    people[name] = person;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      console.log(`[${name}] ${line}`);
      person.lines.push(line);
      for (const waiter of [...person.waiters]) waiter();
    });
    createInterface({ input: proc.stderr }).on('line', (line) => console.log(`[${name}:err] ${line}`));
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      const last = person.lines.at(-1) ?? '';
      fail(/^E2E_TIMEOUT/.test(last) ? TIMEOUT_EXIT : code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${last}"`);
    });
  }

  const send = (name, line) => people[name].proc.stdin.write(`${line}\n`);
  const expectLine = (name, pattern, timeoutMs, from = 0) =>
    new Promise((done) => {
      const person = people[name];
      const check = () => {
        const index = person.lines.findIndex((line, i) => i >= from && pattern.test(line));
        if (index < 0) return false;
        person.waiters = person.waiters.filter((w) => w !== check);
        clearTimeout(timer);
        done(person.lines[index]);
        return true;
      };
      const timer = setTimeout(() => {
        person.waiters = person.waiters.filter((w) => w !== check);
        done(null);
      }, timeoutMs);
      if (!check()) person.waiters.push(check);
    });
  const field = (line, key) => line.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? null;
  /** Sends `command` to `name` and waits for `ok` (or a `…_FAILED` line). */
  const step = async (name, command, ok, stage, timeoutMs = STEP_WAIT_MS) => {
    const from = people[name].lines.length;
    send(name, command);
    const line = await expectLine(name, new RegExp(`${ok.source}|^[A-Z_]+_FAILED `), timeoutMs, from);
    if (!line) return fail(TIMEOUT_EXIT, `E2E_TIMEOUT ${stage}`) ?? null;
    if (/^[A-Z_]+_FAILED /.test(line)) return fail(1, `${stage}: ${line}`) ?? null;
    return line;
  };

  const ready = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^READY /, READY_WAIT_MS)));
  if (ready.some((line) => line === null)) return fail(TIMEOUT_EXIT, 'E2E_TIMEOUT both people ready (connect, funds)');
  console.log(`PEOPLE a=${saved.a.username} b=${saved.b.username} at=${at()}`);

  // 0. The chat between a and b.
  const requested = await step('a', 'REQUEST_OTHER', /^CHAT_REQUEST_SENT /, 'chat request');
  if (!requested) return;
  if (!(await step('b', `ACCEPT ${field(requested, 'id')}`, /^ACCEPTED /, 'accept'))) return;
  if (!(await step('a', 'WAIT_CONTACT', /^CONTACT /, 'contact on a'))) return;

  // 1–3. Request, see, pay, paid.
  const sentRequest = await step('a', `REQUEST ${REQUEST_PAS}`, /^REQUEST_SENT /, 'request sent');
  if (!sentRequest) return;
  const requestId = field(sentRequest, 'id');
  if (!(await step('b', `SEE ${requestId}`, /^REQUEST_SEEN /, 'request seen'))) return;
  const paid = await step('b', `PAY ${requestId}`, /^PAID /, 'pay (dry-run, sign, in block)');
  if (!paid) return;
  const paidOnA = await step('a', `CHECK_PAID ${requestId}`, /^REQUEST_PAID /, 'request paid on a');
  if (!paidOnA) return;
  if (field(paidOnA, 'hash') !== field(paid, 'hash')) return fail(1, `REQUEST_PAID_WRONG_HASH a=${field(paidOnA, 'hash')} b=${field(paid, 'hash')}`);
  if (!(await step('a', `BALANCE ${REQUEST_PAS}`, /^BALANCE_OK /, 'balance rose on a'))) return;

  // 4. The over-balance refusal, live.
  if (!(await step('b', 'OVER_BALANCE', /^OVER_BALANCE_REFUSED /, 'over-balance dry-run'))) return;

  // 5. A direct send.
  const sent = await step('b', `SEND ${SEND_PAS}`, /^SENT /, 'send (dry-run, sign, in block)');
  if (!sent) return;
  const received = await step('a', `RECEIVE ${field(sent, 'hash')} ${SEND_PAS}`, /^RECEIVED /, 'received on a');
  if (!received) return;

  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_000);
  stopAll();
  console.log(`BLOCKS request_paid=${field(paid, 'block')} sent=${field(sent, 'block')}`);
  writeFileSync(
    join(root, '.agent-runs', 'pay-last.json'),
    `${JSON.stringify({ a: saved.a, b: saved.b, requestId, amount: '2000000000', note: 'e2e lunch', paymentNote: `req:${requestId} e2e lunch`, hash: field(paid, 'hash'), block: Number(field(paid, 'block')) }, null, 2)}\n`,
  );
  console.log(`PAY_OK at=${at()}`);
  process.exit(0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child(name) {
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  register();
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const WAIT_MS = 150_000;
  const DRIP_WAIT_MS = 90_000;
  const MIN_FREE = 10_000_000_000n;

  const identityName = flag('identity');
  const otherHex = flag('other');
  const otherName = flag('other-name');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  const waitFor = async (probe, timeoutMs = WAIT_MS) => {
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
  const { requestDrip } = await load('scripts/lib/faucet-bot.ts');
  const { toSs58 } = await load('src/renderer/ui/format.ts');
  const { createTxRunner } = await load('src/renderer/domain/chain/transactions.ts');
  const { openAssetHub, createTxService } = await load('src/main/chain/assetHub.ts');
  const { formatPas } = await load('src/shared/balanceHint.ts');
  const pay = await load('src/renderer/domain/chain/payments.ts');

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

  // ── Identity, connections, the app's modules ──
  const file = identityFile(identityName);
  if (!existsSync(file)) finish(1, `NO_IDENTITY ${file}`);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
  const selfKeys = deriveIdentityKeys(saved.mnemonic);
  if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
  console.log(`SELF ${saved.username} ${saved.accountHex}`);

  const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(connection.lazyClient.getClient()), connection.switchEndpoint);
    chain = await openAssetHub(profile);
  } catch (error) {
    finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  service = createTxService(chain, { publicKey: selfKeys.accountId, sign: selfKeys.sign });
  const chainId = chain.genesis;
  const freeNow = async () => BigInt((await service.balance()).free);
  const transferCall = (to, amount) => service.transferCall(bytesOf(to), BigInt(amount));

  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  runner = createTxRunner({ chain: { sign: service.sign, onTxStatus: service.onStatus }, sendReference: manager.sendReference, recordReference: manager.recordReference });

  // ── 0. Test funds: at least 1 PAS, or a drip from the faucet bot ──
  let free = await freeNow();
  if (free < MIN_FREE) {
    const search = async (prefix) => (await searchUsernames(NETWORK_PROFILES[profile], prefix, selfKeys.accountId)).results;
    const drip = await requestDrip(
      {
        contacts: () => db.contacts.toArray(),
        requests: () => db.requests.toArray(),
        search,
        getPeerIdentity: (accountId) => lookup.getPeerIdentity(accountId),
        sendMessage: (peer, text) => manager.sendMessage(peer, { type: 'text', text }),
        sendRequest: (peer, text) => manager.sendRequest(peer, text),
      },
      toSs58(selfKeys.accountId),
    );
    console.log(`DRIP_SENT via=${drip.via} to=${drip.username}`);
    if (!(await waitFor(async () => (await freeNow()) >= MIN_FREE, DRIP_WAIT_MS))) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: drip`);
    free = await freeNow();
  }
  console.log(`READY username=${saved.username} free=${formatPas(free)}`);

  const ownReferenceSettled = (hash) =>
    waitFor(async () => {
      const row = (await listMessages(otherHex)).find((r) => r.direction === 'outgoing' && r.content.type === 'transactionReference' && r.content.reference.hash === hash);
      const status = row?.content.reference.status;
      return status === 'inBlock' || status === 'finalized' || status === 'failed' ? row.content.reference : null;
    });
  // What the chain says each reference's transaction moved (one read per hash and block).
  const transfers = new Map();
  const lookupTransfers = (reference) => transfers.get(`${reference.hash}:${reference.block}`);
  const readTransfers = async (reference) => {
    const key = `${reference.hash}:${reference.block}`;
    if (!transfers.has(key) && reference.block !== null) transfers.set(key, await service.transfersOf(reference.hash, reference.block));
  };

  let baseline = null;
  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await lookup.getPeerIdentity(bytesOf(otherHex));
        if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${otherName}`);
        await manager.sendRequest(peer, 'M12g payments e2e');
        const request = (await db.requests.toArray()).filter((row) => row.direction === 'outgoing' && row.peerAccountId === otherHex).sort((x, y) => y.createdAt - x.createdAt)[0];
        console.log(`CHAT_REQUEST_SENT id=${request.requestId} to=${peer.username}`);
      }
      if (command === 'ACCEPT') {
        const request = await waitFor(() => db.requests.get(rest[0]));
        if (!request) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the chat request`);
        await manager.acceptRequest(rest[0]);
        console.log(`ACCEPTED ${request.peerUsername}`);
      }
      if (command === 'WAIT_CONTACT') {
        const contact = await waitFor(async () => {
          const row = await db.contacts.get(otherHex);
          return row && row.devices.length > 0 ? row : null;
        });
        if (!contact) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: contact`);
        console.log(`CONTACT ${contact.username} devices=${contact.devices.length}`);
      }
      if (command === 'REQUEST') {
        const amount = pay.parsePas(rest[0]);
        baseline = await freeNow();
        const before = new Set((await listMessages(otherHex)).map((row) => row.messageId));
        await pay.sendPaymentRequest(
          { transferCall, sendButtons: manager.sendButtons },
          { peer: otherHex, self: { accountHex: saved.accountHex, username: saved.username }, chainId, amount, note: 'e2e lunch' },
        );
        const row = (await listMessages(otherHex)).find((r) => !before.has(r.messageId) && pay.paymentRequestOf(r)?.own);
        if (!row) finish(1, 'REQUEST_FAILED no own request row');
        console.log(`REQUEST_SENT id=${row.messageId} text="${row.content.text}" free_before=${formatPas(baseline)}`);
      }
      if (command === 'SEE') {
        const row = await waitFor(async () => (await listMessages(otherHex)).find((r) => r.messageId === rest[0] && r.direction === 'incoming') ?? null);
        if (!row) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the request message`);
        const request = pay.paymentRequestOf(row);
        if (!request) console.log(`SEE_FAILED the message is not a request: ${JSON.stringify(row.content.type)}`);
        else console.log(`REQUEST_SEEN amount=${pay.pas(request.amount)} title="${request.title}" button="${row.content.rows[0][0].label}" state=${pay.payerState(request, [row], Date.now()).state}`);
      }
      if (command === 'PAY') {
        const row = (await listMessages(otherHex)).find((r) => r.messageId === rest[0]);
        const request = row ? pay.paymentRequestOf(row) : null;
        if (!request) {
          console.log('PAY_FAILED no request');
          continue;
        }
        const problem = await pay.requestProblem(request, otherHex, transferCall);
        if (problem) {
          console.log(`PAY_FAILED ${problem}`);
          continue;
        }
        // Never sign without a dry-run: `sign` takes only the id of a passed one.
        const dryRun = await service.dryRun(request.intent);
        console.log(`DRYRUN ok=${dryRun.ok} value=${formatPas(BigInt(dryRun.value))} fee=${dryRun.fee ? formatPas(BigInt(dryRun.fee)) : '-'}${dryRun.error ? ` error="${dryRun.error}"` : ''}`);
        if (!dryRun.ok) {
          console.log(`PAY_FAILED dry-run refused: ${dryRun.error}`);
          continue;
        }
        const note = pay.requestPaymentNote(request.messageId, request.note);
        const hash = await runner.run({ peer: otherHex, dryRunId: dryRun.id, chainId, note, intentMessageId: request.messageId });
        await manager.pressButton(otherHex, request.messageId, 0, 0);
        const reference = await ownReferenceSettled(hash);
        if (!reference) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: payment in block`);
        if (reference.status === 'failed') {
          console.log(`PAY_FAILED ${reference.error ?? 'the chain refused it'}`);
          continue;
        }
        const state = pay.payerState(request, await listMessages(otherHex), Date.now());
        console.log(`PAID hash=${hash} block=${reference.block} note="${note}" state=${state.state}`);
      }
      if (command === 'CHECK_PAID') {
        const row = (await listMessages(otherHex)).find((r) => r.messageId === rest[0]);
        const request = row ? pay.paymentRequestOf(row) : null;
        if (!request) {
          console.log('CHECK_PAID_FAILED no own request');
          continue;
        }
        const accounts = { self: saved.accountHex, peer: otherHex };
        const paid = await waitFor(async () => {
          const rows = await listMessages(otherHex);
          for (const reference of pay.claimedPayments(request.messageId, rows)) await readTransfers(reference);
          const state = pay.requesterState(request, rows, lookupTransfers, accounts, Date.now());
          return state.state === 'paid' ? state : null;
        });
        if (!paid) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the paid reference`);
        const moved = pay.movedBetween(lookupTransfers(paid.paidBy), otherHex, saved.accountHex);
        console.log(`REQUEST_PAID hash=${paid.paidBy.hash} block=${paid.paidBy.block} chain_moved=${pay.pas(moved)} PAS line="${pay.paymentLine(paid.paidBy, false, otherName, request.amount)}"`);
      }
      if (command === 'BALANCE') {
        const amount = pay.parsePas(rest[0]);
        const after = await waitFor(async () => {
          const value = await freeNow();
          return value - baseline >= amount ? value : null;
        }, 60_000);
        const value = after ?? (await freeNow());
        const delta = value - baseline;
        console.log(`${delta === amount ? 'BALANCE_OK' : 'BALANCE_FAILED'} before=${formatPas(baseline)} after=${formatPas(value)} delta=${pay.pas(delta)} PAS expected=${rest[0]}`);
      }
      if (command === 'OVER_BALANCE') {
        const free = await freeNow();
        const intent = await pay.sendIntent(transferCall, { peer: otherHex, peerName: otherName, chainId, amount: free, note: '' });
        const dryRun = await service.dryRun(intent);
        if (!dryRun.ok && /^Not enough PAS: .* available after fees\.$/.test(dryRun.error ?? '')) console.log(`OVER_BALANCE_REFUSED amount=${formatPas(free)} error="${dryRun.error}" id=${dryRun.id}`);
        else console.log(`OVER_BALANCE_FAILED ok=${dryRun.ok} error="${dryRun.error}"`);
      }
      if (command === 'SEND') {
        const amount = pay.parsePas(rest[0]);
        const intent = await pay.sendIntent(transferCall, { peer: otherHex, peerName: otherName, chainId, amount, note: 'e2e direct' });
        const dryRun = await service.dryRun(intent);
        console.log(`DRYRUN ok=${dryRun.ok} value=${formatPas(BigInt(dryRun.value))} fee=${dryRun.fee ? formatPas(BigInt(dryRun.fee)) : '-'}${dryRun.error ? ` error="${dryRun.error}"` : ''}`);
        if (!dryRun.ok) {
          console.log(`SEND_FAILED dry-run refused: ${dryRun.error}`);
          continue;
        }
        const note = pay.sendNote(amount, 'e2e direct');
        const hash = await runner.run({ peer: otherHex, dryRunId: dryRun.id, chainId, note, intentMessageId: null });
        const reference = await ownReferenceSettled(hash);
        if (!reference) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: send in block`);
        if (reference.status === 'failed') {
          console.log(`SEND_FAILED ${reference.error ?? 'the chain refused it'}`);
          continue;
        }
        console.log(`SENT hash=${hash} block=${reference.block} line="${pay.paymentLine(reference, true, otherName, null)}"`);
      }
      if (command === 'RECEIVE') {
        const [hash, amountText] = rest;
        const amount = pay.parsePas(amountText);
        const reference = await waitFor(async () => {
          const row = (await listMessages(otherHex)).find(
            (r) => r.direction === 'incoming' && r.content.type === 'transactionReference' && r.content.reference.hash === hash.toLowerCase(),
          );
          const ref = row?.content.reference;
          return ref && (ref.status === 'inBlock' || ref.status === 'finalized') ? ref : null;
        });
        if (!reference) finish(TIMEOUT_EXIT, `E2E_TIMEOUT ${name}: the send reference`);
        const moved = pay.movedBetween(await service.transfersOf(reference.hash, reference.block), otherHex, saved.accountHex);
        const line = pay.paymentLine(reference, false, otherName, null);
        if (moved === amount && line?.startsWith(`${otherName} sent you ${amountText} PAS`)) console.log(`RECEIVED hash=${reference.hash} block=${reference.block} chain_moved=${pay.pas(moved)} PAS line="${line}"`);
        else console.log(`RECEIVE_FAILED chain_moved=${pay.pas(moved)} line="${line}"`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
