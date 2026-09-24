#!/usr/bin/env node
// M11b e2e (specs 0007 and 0008 v2): two people flip a coin in chat with the
// live pca bot `pcdflip.NN` and the Flip contract on devnet Asset Hub
// (docs/spec/contracts/flip.md), through this repo's code:
//   npm run e2e:flip -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdeceb]
//
// The app's database is one per process (Dexie over fake-indexeddb, as in
// e2e-meter.mjs), so each person is a child process of this script
// (`--role a|b`); this parent only says who stakes when and checks the end.
// Each child, with its own identity file:
//  1. asks the faucet bot for 1 PAS (the Faucet's "Get 1 PAS" path) and
//     waits for its reference (DRIP_OK);
//  2. request/accept with pcdflip (found by username search); waits for the
//     "Stake 0.5 PAS" `tx` button and the bot's spec 0008 `balance` hint
//     ("your stake"), and reads the contract's `pending()` player (READY);
//  3. on STAKE: dry-run, sign with the identity key (main/chain/assetHub.ts)
//     and send the references through the renderer's runner, as the app
//     does; prints STAKED once its own reference is in a best block, and the
//     hint's value ("your stake: 0.5 PAS" while it waits);
//  4. on SETTLE <hash>: waits for the bot's "Flip settled: <username> won
//     1 PAS" reference for that extrinsic, and checks its own Asset Hub
//     balance: the winner's rose by about 0.5 PAS minus fees since its stake.
// The contract is global: a stake someone else left waiting would pair with
// ours, so the parent reads `pending()` first and clears such a stake with
// one extra stake of person a.
// Exit 0 FLIP_OK; 12 E2E_TIMEOUT <stage>; 3 PEER_KEY_UNSUPPORTED; 1 any
// other failure. Prints no secret.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

if (role) await child(role);
else await parent();

// ── The parent: order the stakes, check the end ────────────────────────────

async function parent() {
  const READY_WAIT_MS = 8 * 60_000;
  const STAKE_WAIT_MS = 4 * 60_000;
  const SETTLE_WAIT_MS = 5 * 60_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdeceb' };
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
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identity, '--profile', profile], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const person = { name, proc, lines: [], waiters: [] };
    people[name] = person;
    const onLine = (line) => {
      console.log(`[${name}] ${line}`);
      person.lines.push(line);
      for (const waiter of [...person.waiters]) waiter();
    };
    createInterface({ input: proc.stdout }).on('line', onLine);
    // Library warnings stay visible, marked, but are not protocol lines.
    createInterface({ input: proc.stderr }).on('line', (line) => console.log(`[${name}:err] ${line}`));
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      const last = person.lines.at(-1) ?? '';
      fail(/^E2E_TIMEOUT/.test(last) ? 12 : code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${last}"`);
    });
  }

  const send = (name, line) => people[name].proc.stdin.write(`${line}\n`);
  /** The first line of `name` after `from` that matches; null on timeout. */
  const expectLine = (name, pattern, timeoutMs, from = 0) =>
    new Promise((done) => {
      const person = people[name];
      const check = () => {
        const index = person.lines.findIndex((line, i) => i >= from && pattern.test(line));
        if (index < 0) return false;
        person.waiters = person.waiters.filter((w) => w !== check);
        clearTimeout(timer);
        done({ line: person.lines[index], index });
        return true;
      };
      const timer = setTimeout(() => {
        person.waiters = person.waiters.filter((w) => w !== check);
        done(null);
      }, timeoutMs);
      if (!check()) person.waiters.push(check);
    });
  const field = (line, key) => line.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? null;

  const ready = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^READY /, READY_WAIT_MS)));
  if (ready.some((entry) => entry === null)) return fail(12, 'E2E_TIMEOUT both people ready (drip, accept, stake button)');
  const who = Object.fromEntries(['a', 'b'].map((name, i) => [name, { username: field(ready[i].line, 'username'), h160: field(ready[i].line, 'h160') }]));
  let pending = field(ready[0].line, 'pending');
  console.log(`PEOPLE a=${who.a.username} b=${who.b.username} pending=${pending} at=${at()}`);

  const stake = async (name, label) => {
    const from = people[name].lines.length;
    send(name, 'STAKE');
    const done = await expectLine(name, /^STAKED |^STAKE_FAILED /, STAKE_WAIT_MS, from);
    if (!done) return fail(12, `E2E_TIMEOUT stake ${label}`) ?? null;
    if (/^STAKE_FAILED/.test(done.line)) return fail(1, `STAKE_FAILED ${label}: ${done.line}`) ?? null;
    return field(done.line, 'hash');
  };
  const readPending = async () => {
    const from = people.a.lines.length;
    send('a', 'PENDING');
    const line = await expectLine('a', /^PENDING /, 60_000, from);
    return line ? field(line.line, 'pending') : null;
  };

  // A stake left by someone else pairs with the next stake: clear it with one of a's.
  for (let tries = 0; pending !== ZERO_ADDRESS && pending !== who.a.h160 && pending !== who.b.h160; tries++) {
    if (tries >= 2 || pending === null) return fail(1, `PENDING_STRANGER ${pending} is still waiting in the Flip contract`);
    console.log(`PENDING_STRANGER ${pending}: person a stakes once to settle that round first`);
    if ((await stake('a', 'a (clearing)')) === null) return;
    await delay(6_000);
    pending = await readPending();
  }

  let settleHash;
  if (pending === who.b.h160) {
    console.log('STAKED b (waiting from an earlier run)');
    settleHash = await stake('a', 'a');
    if (!settleHash) return;
    console.log(`STAKED a hash=${settleHash} (settles the round)`);
  } else {
    if (pending === who.a.h160) console.log('STAKED a (waiting from an earlier run)');
    else {
      const first = await stake('a', 'a');
      if (!first) return;
      console.log(`STAKED a hash=${first}`);
    }
    settleHash = await stake('b', 'b');
    if (!settleHash) return;
    console.log(`STAKED b hash=${settleHash} (settles the round)`);
  }

  const marks = Object.fromEntries(['a', 'b'].map((name) => [name, people[name].lines.length]));
  for (const name of ['a', 'b']) send(name, `SETTLE ${settleHash}`);
  const settled = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^BALANCE_(?:WIN|LOSE) |^SETTLE_FAILED /, SETTLE_WAIT_MS, marks[name])));
  if (settled.some((entry) => entry === null)) return fail(12, 'E2E_TIMEOUT settlement reference and balances');
  const failed = settled.find((entry) => /^SETTLE_FAILED/.test(entry.line));
  if (failed) return fail(1, failed.line);
  const settledLine = people.a.lines.slice(marks.a).find((line) => /^SETTLED /.test(line)) ?? people.b.lines.slice(marks.b).find((line) => /^SETTLED /.test(line));
  const winner = field(settledLine ?? '', 'winner');
  const payout = settledLine?.match(/payout=(.+)$/)?.[1] ?? '?';
  console.log(`SETTLED winner=${winner} payout=${payout}`);
  const winnerRole = ['a', 'b'].find((name) => who[name].username === winner);
  if (!winnerRole) return fail(1, `FLIP_BAD_WINNER ${winner} is neither ${who.a.username} nor ${who.b.username}`);
  const winLine = settled[winnerRole === 'a' ? 0 : 1].line;
  if (!/^BALANCE_WIN .* ok=yes/.test(winLine)) return fail(1, `FLIP_BAD_BALANCE ${winLine}`);
  console.log(`WINNER ${winnerRole} ${winner}: ${winLine}`);
  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_000);
  stopAll();
  console.log(`FLIP_OK at=${at()}`);
  process.exit(0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child(name) {
  // Dexie needs an IndexedDB before app/database.ts is loaded.
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  // One tsx loader for the whole process, so every module shares one instance.
  register();
  const { keccak_256 } = await import('@noble/hashes/sha3.js');
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const DRIP_WAIT_MS = 90_000;
  const ACCEPT_WAIT_MS = 120_000;
  const BUTTON_WAIT_MS = 90_000;
  const HINT_WAIT_MS = 30_000;
  const IN_BLOCK_WAIT_MS = 90_000;
  const SETTLE_WAIT_MS = 180_000;
  const PAYOUT_WAIT_MS = 60_000;

  const identityName = flag('identity');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
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
  const { requestDrip } = await load('scripts/lib/faucet-bot.ts');
  const { toSs58 } = await load('src/renderer/ui/format.ts');
  const { createTxRunner } = await load('src/renderer/domain/chain/transactions.ts');
  const { openAssetHub, createTxService } = await load('src/main/chain/assetHub.ts');
  const { decodeTxIntent, formatUnits } = await load('src/shared/txIntent.ts');
  const { decodeUint256, formatPas, hintCalldata, hintLine, reviveAddressOf } = await load('src/shared/balanceHint.ts');

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
  const timeout = (stage) => finish(12, `E2E_TIMEOUT ${name}: ${stage}`);

  // ── Identity, connections, the app's modules ──
  const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
  if (!existsSync(identityFile)) finish(1, `NO_IDENTITY ${identityFile} (npm run identity:register -- <letters>)`);
  const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
  if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
  const selfKeys = deriveIdentityKeys(saved.mnemonic);
  if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');
  const selfH160 = hexOf(reviveAddressOf(selfKeys.accountId));
  console.log(`SELF ${saved.username} ${saved.accountHex} h160=${selfH160}`);

  const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
  const client = connection.lazyClient.getClient();
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(client), connection.switchEndpoint);
    chain = await openAssetHub(profile);
  } catch (error) {
    finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  service = createTxService(chain, { publicKey: selfKeys.accountId, sign: selfKeys.sign });
  const freeNow = async () => BigInt((await service.balance()).free);
  console.log(`ASSET_HUB account ${service.address} free ${formatPas(await freeNow())}`);

  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus });
  runner = createTxRunner({ chain: { sign: service.sign, onTxStatus: service.onStatus }, sendReference: manager.sendReference, recordReference: manager.recordReference });

  const search = async (prefix) => (await searchUsernames(NETWORK_PROFILES[profile], prefix, selfKeys.accountId)).results;
  const findBot = async (botName) => {
    const pattern = new RegExp(`^${botName}\\.\\d{2}$`);
    const hits = await search(botName);
    const hit = hits.find((row) => pattern.test(row.username));
    if (!hit) finish(1, `BOT_NOT_FOUND ${botName} (search returned ${hits.map((row) => row.username).join(', ') || 'nothing'})`);
    console.log(`FOUND ${hit.username}`);
    return { username: hit.username, accountHex: hexOf(hit.accountId), accountId: hit.accountId };
  };
  const isStatus = (row) => row.content.type === 'text' && /^(?:⏳|🤔|✓) /u.test(row.content.text);
  const incomingAfter = async (peerHex, since) => (await listMessages(peerHex)).filter((row) => row.direction === 'incoming' && row.timestamp >= since);

  // ── 1. Test funds ──
  // Both people ask the one faucet account at once; the faucet can refuse the
  // second transfer of a block ("did not go through"), so a refusal is asked again.
  const faucet = await findBot('pcdfaucet');
  const dripDeps = {
    contacts: () => db.contacts.toArray(),
    requests: () => db.requests.toArray(),
    search,
    getPeerIdentity: (accountId) => lookup.getPeerIdentity(accountId),
    sendMessage: (peer, text) => manager.sendMessage(peer, { type: 'text', text }),
    sendRequest: (peer, text) => manager.sendRequest(peer, text),
  };
  let dripped = null;
  for (let attempt = 1; attempt <= 3 && !dripped; attempt++) {
    if (attempt > 1) await delay(name === 'a' ? 8_000 : 16_000);
    const dripStarted = Date.now() - 1_000;
    const drip = await requestDrip(dripDeps, toSs58(selfKeys.accountId));
    console.log(`DRIP_SENT via=${drip.via} to=${drip.username} attempt=${attempt}`);
    const answer = await waitFor(async () => {
      const rows = await incomingAfter(faucet.accountHex, dripStarted);
      return rows.find((row) => row.content.type === 'transactionReference') ?? rows.find((row) => row.content.type === 'text' && !isStatus(row)) ?? null;
    }, DRIP_WAIT_MS);
    if (!answer) timeout('drip reference (90 s)');
    if (answer.content.type === 'text') console.log(`DRIP_REFUSED ${oneLine(answer.content.text)}`);
    else if (answer.content.reference.status === 'failed') console.log(`DRIP_FAILED ${answer.content.reference.note}`);
    else dripped = answer;
  }
  if (!dripped) finish(1, 'DRIP_GAVE_UP three faucet refusals');
  console.log(`DRIP_OK status=${dripped.content.reference.status} block=${dripped.content.reference.block} note="${dripped.content.reference.note}"`);

  // ── 2. The flip bot: accept, the stake button, the balance hint ──
  const flip = await findBot('pcdflip');
  const offerSince = Date.now() - 5_000;
  const peer = await lookup.getPeerIdentity(flip.accountId);
  if (!peer) finish(3, 'PEER_KEY_UNSUPPORTED pcdflip');
  await manager.sendRequest(peer, null);
  console.log('REQUEST_SENT pcdflip');
  if (!(await waitFor(() => db.contacts.get(flip.accountHex), ACCEPT_WAIT_MS))) timeout('pcdflip accept');
  console.log(`ACCEPTED ${flip.username}`);
  const stakeKeyboard = async () =>
    (await incomingAfter(flip.accountHex, offerSince))
      .reverse()
      .find((row) => row.content.type === 'buttons' && row.content.rows.flat().some((button) => button.action.kind === 'tx' && /^Stake/.test(button.label))) ?? null;
  let keyboard = await waitFor(stakeKeyboard, BUTTON_WAIT_MS / 2);
  if (!keyboard) {
    await manager.sendMessage(flip.accountHex, { type: 'text', text: '/stake' });
    console.log('SENT /stake');
    keyboard = await waitFor(stakeKeyboard, BUTTON_WAIT_MS);
  }
  if (!keyboard) timeout('Stake button');
  const storedHint = async () => (await db.peerInfo.get(flip.accountHex))?.botInfo?.balance ?? null;
  let hint = await waitFor(storedHint, HINT_WAIT_MS);
  if (!hint) {
    await manager.sendMessage(flip.accountHex, { type: 'text', text: '/start' });
    hint = await waitFor(storedHint, HINT_WAIT_MS * 2);
  }
  if (!hint) finish(1, `NO_BALANCE_HINT botInfo=${JSON.stringify((await db.peerInfo.get(flip.accountHex))?.botInfo ?? null)}`);
  console.log(`HINT label="${hint.label}" contract=${hint.contract} selector=${hint.selector} decimals=${hint.decimals} unit=${hint.unit}`);
  const readHint = async () => decodeUint256(await service.contractRead(hint.chainId, hint.contract, hintCalldata(hint.selector, reviveAddressOf(selfKeys.accountId)))) ?? 0n;
  // Flip.pending(): the player waiting in the open round (flip.md).
  const PENDING_SELECTOR = keccak_256(new TextEncoder().encode('pending()')).slice(0, 4);
  const readPending = async () => {
    const word = await service.contractRead(hint.chainId, hint.contract, PENDING_SELECTOR);
    return word.length === 32 ? hexOf(word.slice(12)) : null;
  };
  console.log(`READY username=${saved.username} h160=${selfH160} pending=${await readPending()} hint="${hintLine(hint, await readHint())}"`);

  // ── 3 and 4: the parent says when ──
  let stakeBefore = null;
  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, argument] = line.trim().split(/\s+/);
    if (command === 'EXIT') finish(0, 'EXIT');
    if (command === 'PENDING') console.log(`PENDING pending=${await readPending()}`);
    if (command === 'STAKE') {
      // The newest stake button: an older one may have expired.
      keyboard = (await stakeKeyboard()) ?? keyboard;
      const position = (() => {
        for (const [r, row] of keyboard.content.rows.entries()) for (const [i, button] of row.entries()) if (button.action.kind === 'tx') return { r, i, button };
        return null;
      })();
      const intent = decodeTxIntent(position.button.action.intent);
      const before = await freeNow();
      const dryRun = await service.dryRun(position.button.action.intent);
      console.log(
        `DRYRUN "${position.button.label}" ok=${dryRun.ok} value=${formatPas(BigInt(dryRun.value))} fee=${dryRun.fee ? formatPas(BigInt(dryRun.fee)) : '-'} mapsAccount=${dryRun.mapsAccount}${dryRun.error ? ` error="${dryRun.error}"` : ''}`,
      );
      if (!dryRun.ok) {
        console.log(`STAKE_FAILED dry-run refused: ${dryRun.error}`);
        continue;
      }
      const note = `${intent.display.title} (${intent.display.amount} ${intent.display.asset})`;
      const hash = await runner.run({ peer: flip.accountHex, dryRunId: dryRun.id, chainId: intent.chainId, note, intentMessageId: keyboard.messageId });
      await manager.pressButton(flip.accountHex, keyboard.messageId, position.r, position.i);
      console.log(`SIGNED hash=${hash}`);
      const own = await waitFor(async () => {
        const row = (await listMessages(flip.accountHex)).find(
          (r) => r.direction === 'outgoing' && r.content.type === 'transactionReference' && r.content.reference.hash === hash,
        );
        const status = row?.content.reference.status;
        return status === 'inBlock' || status === 'finalized' || status === 'failed' ? row : null;
      }, IN_BLOCK_WAIT_MS);
      if (!own) timeout('stake in block');
      if (own.content.reference.status === 'failed') {
        console.log(`STAKE_FAILED ${own.content.reference.error ?? 'the chain refused it'}`);
        continue;
      }
      stakeBefore = before;
      console.log(`STAKED ${name} hash=${hash} block=${own.content.reference.block} free_before=${formatPas(before)}`);
      console.log(`HINT_VALUE ${hintLine(hint, await readHint())}`);
    }
    if (command === 'SETTLE') {
      const hash = argument.toLowerCase();
      const settled = await waitFor(
        async () =>
          (await listMessages(flip.accountHex)).find(
            (row) => row.direction === 'incoming' && row.content.type === 'transactionReference' && row.content.reference.hash.toLowerCase() === hash && /^Flip settled:/.test(row.content.reference.note),
          ) ?? null,
        SETTLE_WAIT_MS,
      );
      if (!settled) timeout('settlement reference');
      const note = settled.content.reference.note;
      const match = note.match(/^Flip settled: (\S+) won (.+)$/);
      if (!match) {
        console.log(`SETTLE_FAILED note="${note}"`);
        continue;
      }
      const [, winner, payout] = match;
      console.log(`SETTLED winner=${winner} payout=${payout}`);
      console.log(`HINT_VALUE ${hintLine(hint, await readHint())}`);
      // Our balance since our stake: +1 PAS pot - 0.5 PAS stake - fees for the winner.
      const base = stakeBefore ?? (await freeNow());
      const staked = stakeBefore !== null;
      if (winner === saved.username) {
        const low = staked ? 4_000_000_000n : 9_000_000_000n;
        const high = staked ? 5_000_000_000n : 10_000_000_000n;
        const after = await waitFor(async () => {
          const free = await freeNow();
          return free - base > low ? free : null;
        }, PAYOUT_WAIT_MS);
        const free = after ?? (await freeNow());
        const delta = free - base;
        console.log(`BALANCE_WIN before=${formatPas(base)} after=${formatPas(free)} delta=${formatUnits(delta)} PAS expected=(${formatUnits(low)}, ${formatUnits(high)}] ok=${delta > low && delta <= high ? 'yes' : 'no'}`);
      } else {
        const free = await freeNow();
        console.log(`BALANCE_LOSE before=${formatPas(base)} after=${formatPas(free)} delta=${formatUnits(free - base)} PAS`);
      }
    }
  }
}
