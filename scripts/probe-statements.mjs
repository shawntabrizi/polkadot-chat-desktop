#!/usr/bin/env node
// M12c step 6: how many statements per second the Statement Store takes from
// one person, and how fast they reach the other side, so its practical
// ceiling is a number, not a guess (docs/spec/efficiency.md "Measurement").
//   npm run probe:statements -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdeceb] [--seconds 20]
//
// Two e2e identities, each a child process (`--role a|b`, as in
// e2e-group.mjs: the app's database is one per process). a asks b for a
// chat, b accepts; then a sends text messages to b at 0.5, 1, 2 and 4 per
// second, 20 s each, through the app's chat manager. b notes the arrival
// time of each (Dexie `creating` hook: the moment the row is stored); the
// propagation time is arrival minus the message's own timestamp (one
// machine, one clock). a wraps the Statement Store adapter to count every
// statement it submits and keep each error text.
// Prints one row per rate, then PROBE_DONE. Exit 0 PROBE_DONE; 2 the profile
// is not devnet (never on paseo: the public testnet is not ours to load);
// 13 a step timed out; 1 any other failure. Prints no secret.

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
const RATES = [0.5, 1, 2, 4];
const SECONDS = Number(flag('seconds') ?? 20);

// The guard comes first, in the parent and in each child.
if (profile !== 'devnet') {
  console.log(`PROBE_REFUSED profile=${profile}: the probe runs on devnet only`);
  process.exit(2);
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

if (role) await child();
else await parent();

// ── The parent: order the steps, print the table ──────────────────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 2 * 60_000;
  /** After a burst: time for the last batch to arrive before b reports. */
  const DRAIN_MS = 30_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdeceb' };
  const publicOf = (name) => {
    const file = join(root, '.agent-runs', `identity-${name}`, 'identity.json');
    if (!existsSync(file)) {
      console.log(`NO_IDENTITY ${file}`);
      process.exit(1);
    }
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return { username: saved.username, accountHex: saved.accountHex };
  };
  const who = { a: publicOf(identities.a), b: publicOf(identities.b) };
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

  for (const name of ['a', 'b']) {
    const other = name === 'a' ? 'b' : 'a';
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identities[name], '--profile', profile, '--other', who[other].accountHex], {
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
    createInterface({ input: proc.stderr }).on('line', (line) => {
      // Library warnings stay visible but short.
      if (!/^\s+at /.test(line)) console.log(`[${name}:err] ${line.slice(0, 200)}`);
    });
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      fail(1, `CHILD_FAILED ${name} exit=${code} last="${person.lines.at(-1) ?? ''}"`);
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
        done({ line: person.lines[index], index });
        return true;
      };
      const timer = setTimeout(() => {
        person.waiters = person.waiters.filter((w) => w !== check);
        done(null);
      }, timeoutMs);
      if (!check()) person.waiters.push(check);
    });
  const ask = async (name, command, pattern, timeoutMs) => {
    const from = people[name].lines.length;
    send(name, command);
    return expectLine(name, pattern, timeoutMs, from);
  };
  const field = (line, key) => line.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? '';

  for (const name of ['a', 'b']) {
    if (!(await expectLine(name, /^READY /, READY_WAIT_MS))) return fail(13, `E2E_TIMEOUT ${name} ready`);
  }
  const requested = await ask('a', 'REQUEST_OTHER', /^REQUEST_SENT |_FAILED /, STEP_WAIT_MS);
  if (!requested || /_FAILED /.test(requested.line)) return fail(requested ? 1 : 13, requested?.line ?? 'E2E_TIMEOUT request');
  const accepted = await ask('b', `ACCEPT ${field(requested.line, 'id')}`, /^ACCEPTED |_FAILED /, STEP_WAIT_MS);
  if (!accepted || /_FAILED /.test(accepted.line)) return fail(accepted ? 1 : 13, accepted?.line ?? 'E2E_TIMEOUT accept');
  if (!(await ask('a', 'WAIT_CONTACT', /^CONTACT /, STEP_WAIT_MS))) return fail(13, 'E2E_TIMEOUT a contact');
  // b's session learns a's device from the accept; one more beat for both sessions to settle.
  await delay(5_000);

  const rows = [];
  for (const rate of RATES) {
    console.log(`BURST rate=${rate}/s for ${SECONDS} s at=${at()}`);
    const sent = await ask('a', `BURST ${rate} ${SECONDS}`, /^SENT |_FAILED /, (SECONDS + 60) * 1000);
    if (!sent || /_FAILED /.test(sent.line)) return fail(sent ? 1 : 13, sent?.line ?? `E2E_TIMEOUT burst ${rate}`);
    await delay(DRAIN_MS);
    const report = await ask('b', `REPORT ${rate}`, /^RECEIVED /, STEP_WAIT_MS);
    if (!report) return fail(13, `E2E_TIMEOUT report ${rate}`);
    rows.push({
      rate,
      sent: field(sent.line, 'messages'),
      statements: field(sent.line, 'statements'),
      received: field(report.line, 'count'),
      p50: field(report.line, 'p50'),
      p95: field(report.line, 'p95'),
      max: field(report.line, 'max'),
      errors: sent.line.match(/errors="(.*)"$/)?.[1] ?? '',
    });
  }

  console.log('');
  console.log('| rate (msg/s) | messages sent | statements submitted | received | p50 ms | p95 ms | max ms | submit errors |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.rate} | ${row.sent} | ${row.statements} | ${row.received} | ${row.p50} | ${row.p95} | ${row.max} | ${row.errors || 'none'} |`);
  console.log('');
  for (const person of Object.values(people)) {
    person.done = true;
    send(person.name, 'EXIT');
  }
  await delay(1_500);
  stopAll();
  console.log(`PROBE_DONE at=${at()}`);
  process.exit(0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child() {
  // Dexie needs an IndexedDB before app/database.ts is loaded.
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  register();
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const WAIT_MS = 110_000;
  const identityName = flag('identity');
  const otherHex = flag('other');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
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
  const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');

  setMetadataCacheDir(join(root, '.agent-runs', 'metadata'));
  setMetadataCache(metadataCache());

  let manager = null;
  const finish = (code, line) => {
    if (line) console.log(line);
    try {
      manager?.dispose();
    } catch (error) {
      console.warn('close failed', error);
    }
    disposePeopleConnection();
    process.exit(code);
  };

  const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
  if (!existsSync(identityFile)) finish(1, `NO_IDENTITY ${identityFile}`);
  const saved = JSON.parse(readFileSync(identityFile, 'utf8'));
  if (saved.profile !== profile) finish(1, `IDENTITY_PROFILE_MISMATCH file=${saved.profile} run=${profile}`);
  const selfKeys = deriveIdentityKeys(saved.mnemonic);
  if (hexOf(selfKeys.accountId) !== saved.accountHex) finish(1, 'IDENTITY_FILE_MISMATCH the mnemonic does not derive the saved account');

  const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(connection.lazyClient.getClient()), connection.switchEndpoint);
  } catch (error) {
    finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');

  // Every statement this person submits, and every error the store answers with.
  let statements = 0;
  const errors = new Map();
  const adapter = {
    ...connection.adapter,
    submitStatement: (statement) => {
      statements += 1;
      return connection.adapter.submitStatement(statement).mapErr((error) => {
        const text = String(error?.message ?? error).slice(0, 80);
        errors.set(text, (errors.get(text) ?? 0) + 1);
        return error;
      });
    },
  };
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });

  // b: when each probe message is stored.
  const arrivals = new Map();
  const PROBE = /^probe r=(\S+) n=(\d+)$/;
  db.messages.hook('creating', (_key, row) => {
    if (row.direction !== 'incoming' || row.peerAccountId !== otherHex || row.content.type !== 'text') return;
    const match = row.content.text.match(PROBE);
    if (!match) return;
    const list = arrivals.get(match[1]) ?? [];
    list.push(Date.now() - row.timestamp);
    arrivals.set(match[1], list);
  });
  console.log(`READY username=${saved.username}`);

  const percentile = (sorted, p) => (sorted.length === 0 ? 'n/a' : String(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]));

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await lookup.getPeerIdentity(bytesOf(otherHex));
        if (!peer) finish(3, 'PEER_KEY_UNSUPPORTED other person');
        await manager.sendRequest(peer, 'M12c statement probe');
        const request = (await db.requests.toArray()).filter((row) => row.direction === 'outgoing' && row.peerAccountId === otherHex).sort((x, y) => y.createdAt - x.createdAt)[0];
        console.log(`REQUEST_SENT id=${request.requestId} to=${peer.username}`);
      }
      if (command === 'ACCEPT') {
        const [requestId] = rest;
        const request = await waitFor(() => db.requests.get(requestId), WAIT_MS);
        if (!request) {
          console.log(`ACCEPT_FAILED no request ${requestId} arrived`);
          continue;
        }
        await manager.acceptRequest(requestId);
        console.log(`ACCEPTED ${request.peerUsername} id=${requestId}`);
      }
      if (command === 'WAIT_CONTACT') {
        const contact = await waitFor(() => db.contacts.get(otherHex), WAIT_MS);
        if (contact) console.log(`CONTACT ${contact.username} devices=${contact.devices.length}`);
      }
      if (command === 'BURST') {
        const rate = Number(rest[0]);
        const seconds = Number(rest[1]);
        const interval = 1000 / rate;
        const count = Math.round(rate * seconds);
        const before = statements;
        errors.clear();
        let failed = 0;
        const started = Date.now();
        for (let n = 0; n < count; n++) {
          // On a fixed schedule, so a slow send does not lower the rate.
          await delay(Math.max(0, started + n * interval - Date.now()));
          await manager.sendMessage(otherHex, { type: 'text', text: `probe r=${rest[0]} n=${n}` }).catch((error) => {
            failed += 1;
            const text = String(error?.message ?? error).slice(0, 80);
            errors.set(text, (errors.get(text) ?? 0) + 1);
          });
        }
        // The last send's statement goes out at the end of its task.
        await delay(500);
        const errorText = [...errors].map(([text, times]) => `${text} ×${times}`).join('; ');
        console.log(`SENT rate=${rest[0]} messages=${count - failed} statements=${statements - before} took=${Date.now() - started}ms errors="${errorText}"`);
      }
      if (command === 'REPORT') {
        const list = [...(arrivals.get(rest[0]) ?? [])].sort((x, y) => x - y);
        console.log(`RECEIVED rate=${rest[0]} count=${list.length} p50=${percentile(list, 50)} p95=${percentile(list, 95)} max=${list.at(-1) ?? 'n/a'}`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
