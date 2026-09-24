#!/usr/bin/env node
// M12 e2e (spec 0009 fan-out groups): a three-member room on devnet, two
// people and the live pca bot, through this repo's domain code:
//   npm run e2e:group -- [--profile devnet] [--identity-a pcde2e] [--identity-b pcdeceb] [--bot pcdguide.70]
//
// The app's database is one per process (Dexie over fake-indexeddb, as in
// e2e-flip.mjs), so each person is a child process of this script
// (`--role a|b`); this parent orders the steps and checks the results.
//  1. a sends b a chat request; b accepts that very request (by id, so an
//     older request from an earlier run is not the one accepted); both then
//     hold the other as a contact (CONTACTS_OK). Both open a chat with the
//     bot (a request; the bot accepts).
//  2. a creates the group with b and the bot; b receives `groupInfo`
//     (GROUP_JOINED b).
//  3. a sends "hello all": b receives it with a as the sender and the same
//     envelope id (FANOUT_OK; the bot's copy is proved by step 4).
//  4. the bot answers in the group: a and b both receive the answer with the
//     same envelope id (BOT_REPLY_OK). A bot on code without groups ignores
//     the roster: then E2E_TIMEOUT bot reply is printed and the run goes on.
//  5. a removes b: roster v2; b's client marks itself removed (ROSTER_OK).
// The screenshot run (scripts/screenshots.mjs) drives one child alone as the
// app's second group member: `--role b --other <app account>`, then
// REQUEST_OTHER, OPEN_BOT, WAIT_CONTACT, WAIT_GROUP any, SEND <text>.
// GROUP_OK when every step passed. Exit 0 GROUP_OK; 13 on any timeout (the
// rest still runs where it can); 3 PEER_KEY_UNSUPPORTED; 1 any other failure.
// Prints no secret.

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
const botUsername = flag('bot') ?? 'pcdguide.70';

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

if (role) await child();
else await parent();

// ── The parent: order the steps, compare what each person saw ─────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 2 * 60_000;
  const BOT_WAIT_MS = 4 * 60_000;
  const identities = { a: flag('identity-a') ?? 'pcde2e', b: flag('identity-b') ?? 'pcdeceb' };
  // The public half only: account and username, for the other child's request.
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
  const timeouts = [];

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
    const proc = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), '--role', name, '--identity', identities[name], '--profile', profile, '--bot', botUsername, '--other', who[other].accountHex],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const person = { name, proc, lines: [], waiters: [] };
    people[name] = person;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      console.log(`[${name}] ${line}`);
      person.lines.push(line);
      for (const waiter of [...person.waiters]) waiter();
    });
    // Library warnings stay visible, marked, but are not protocol lines.
    createInterface({ input: proc.stderr }).on('line', (line) => console.log(`[${name}:err] ${line}`));
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      const last = person.lines.at(-1) ?? '';
      fail(code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${last}"`);
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
  /** Sends `command` to `name` and waits for its answer line. */
  const ask = async (name, command, pattern, timeoutMs) => {
    const from = people[name].lines.length;
    send(name, command);
    return expectLine(name, pattern, timeoutMs, from);
  };
  const timeout = (stage) => {
    timeouts.push(stage);
    console.log(`E2E_TIMEOUT ${stage}`);
  };
  const end = (line, code) => {
    for (const person of Object.values(people)) {
      person.done = true;
      send(person.name, 'EXIT');
    }
    setTimeout(() => {
      stopAll();
      console.log(line);
      process.exit(code);
    }, 1_000);
  };

  const ready = await Promise.all(['a', 'b'].map((name) => expectLine(name, /^READY /, READY_WAIT_MS)));
  if (ready.some((entry) => entry === null)) return fail(13, 'E2E_TIMEOUT both people connected');
  console.log(`PEOPLE a=${who.a.username} b=${who.b.username} bot=${botUsername} at=${at()}`);

  // 1. a and b become contacts: a's request, b accepts exactly that one.
  const request = await ask('a', 'REQUEST_OTHER', /^REQUEST_SENT |^\w+_FAILED /, STEP_WAIT_MS);
  if (!request || /_FAILED /.test(request.line)) return fail(request ? 1 : 13, request?.line ?? 'E2E_TIMEOUT request a → b');
  const accepted = await ask('b', `ACCEPT ${field(request.line, 'id')}`, /^ACCEPTED |^\w+_FAILED /, STEP_WAIT_MS);
  if (!accepted || /_FAILED /.test(accepted.line)) return fail(accepted ? 1 : 13, accepted?.line ?? 'E2E_TIMEOUT b accepts a');
  const contactA = await ask('a', 'WAIT_CONTACT', /^CONTACT /, STEP_WAIT_MS);
  if (!contactA) return fail(13, 'E2E_TIMEOUT a learns the accept');
  console.log(`CONTACTS_OK ${who.a.username} ↔ ${who.b.username} at=${at()}`);
  const bots = await Promise.all(['a', 'b'].map((name) => ask(name, 'OPEN_BOT', /^BOT_CONTACT |^\w+_FAILED /, STEP_WAIT_MS)));
  const botFailed = bots.find((entry) => entry === null || /_FAILED /.test(entry.line));
  if (botFailed !== undefined) return fail(botFailed ? 1 : 13, botFailed?.line ?? 'E2E_TIMEOUT the bot accepts both');

  // 2. a creates the group; b receives the roster.
  const created = await ask('a', `CREATE ${who.b.accountHex} ${who.b.username}`, /^GROUP_CREATED |^\w+_FAILED /, STEP_WAIT_MS);
  if (!created || /_FAILED /.test(created.line)) return fail(created ? 1 : 13, created?.line ?? 'E2E_TIMEOUT create');
  const groupId = field(created.line, 'id');
  const joined = await ask('b', `WAIT_GROUP ${groupId}`, /^JOINED /, STEP_WAIT_MS);
  if (!joined) return fail(13, 'E2E_TIMEOUT b receives groupInfo');
  console.log(`GROUP_JOINED b version=${field(joined.line, 'version')} members=${field(joined.line, 'members')} at=${at()}`);

  // 3. "hello all" fans out.
  const sent = await ask('a', 'SEND hello all', /^SENT |^\w+_FAILED /, STEP_WAIT_MS);
  if (!sent || /_FAILED /.test(sent.line)) return fail(sent ? 1 : 13, sent?.line ?? 'E2E_TIMEOUT send');
  const messageId = field(sent.line, 'id');
  const since = field(sent.line, 'at');
  const got = await ask('b', `WAIT_MESSAGE ${messageId}`, /^GOT /, STEP_WAIT_MS);
  if (!got) timeout('b receives "hello all"');
  else if (field(got.line, 'sender') !== who.a.accountHex) return fail(1, `FANOUT_BAD_SENDER ${got.line}`);
  else console.log(`FANOUT_OK b got id=${messageId} from a (copies went to b and ${botUsername}) at=${at()}`);

  // 4. The bot answers to all.
  const replies = await Promise.all(['a', 'b'].map((name) => ask(name, `WAIT_BOT ${since}`, /^BOT_REPLY /, BOT_WAIT_MS)));
  if (replies.some((entry) => entry === null)) {
    timeout(`bot reply (${replies.map((entry, i) => `${i === 0 ? 'a' : 'b'}=${entry ? 'yes' : 'no'}`).join(' ')}): the bot may not run group-aware code yet`);
  } else {
    const [ra, rb] = replies.map((entry) => field(entry.line, 'id'));
    if (ra !== rb) return fail(1, `BOT_REPLY_MISMATCH a=${ra} b=${rb}`);
    console.log(`BOT_REPLY_OK id=${ra} (the same envelope on a and b) at=${at()}`);
  }

  // 5. a removes b: roster v2; b marks itself removed.
  const removed = await ask('a', 'REMOVE_OTHER', /^ROSTER_SENT |^\w+_FAILED /, STEP_WAIT_MS);
  if (!removed || /_FAILED /.test(removed.line)) return fail(removed ? 1 : 13, removed?.line ?? 'E2E_TIMEOUT remove b');
  const left = await ask('b', 'WAIT_REMOVED', /^REMOVED /, STEP_WAIT_MS);
  if (!left) timeout('b applies roster v2');
  else console.log(`ROSTER_OK b removed at version=${field(left.line, 'version')} self=${field(left.line, 'self')} at=${at()}`);

  if (timeouts.length > 0) return end(`GROUP_INCOMPLETE ${timeouts.length} step(s) timed out: ${timeouts.join('; ')}`, 13);
  end(`GROUP_OK at=${at()}`, 0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child() {
  // Dexie needs an IndexedDB before app/database.ts is loaded.
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  // One tsx loader for the whole process, so every module shares one instance.
  register();
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const WAIT_MS = 110_000;
  const BOT_WAIT_MS = 230_000;
  const identityName = flag('identity');
  const otherHex = flag('other');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
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
  const { db, groupPeerOf } = await load('src/renderer/app/database.ts');
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
  const { getGroup } = await load('src/renderer/domain/chat/groups.ts');
  const { isLiveFrame } = await load('src/renderer/domain/chat/content.ts');

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
  console.log(`SELF ${saved.username} ${saved.accountHex}`);

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
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  console.log(`READY username=${saved.username}`);

  let bot = null;
  let groupId = null;
  const peerOf = async (accountHex, label) => {
    const peer = await lookup.getPeerIdentity(bytesOf(accountHex));
    if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${label}`);
    return peer;
  };

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await peerOf(otherHex, 'other person');
        await manager.sendRequest(peer, 'M12 group e2e');
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
      if (command === 'OPEN_BOT') {
        const hits = (await searchUsernames(NETWORK_PROFILES[profile], botUsername.split('.')[0], selfKeys.accountId)).results;
        const hit = hits.find((row) => row.username === botUsername);
        if (!hit) {
          console.log(`OPEN_BOT_FAILED ${botUsername} not found (search returned ${hits.map((row) => row.username).join(', ') || 'nothing'})`);
          continue;
        }
        bot = { username: hit.username, accountHex: hexOf(hit.accountId) };
        await manager.sendRequest(await peerOf(bot.accountHex, botUsername), null);
        const contact = await waitFor(() => db.contacts.get(bot.accountHex), WAIT_MS);
        if (contact) console.log(`BOT_CONTACT ${bot.username} ${bot.accountHex}`);
        else console.log(`OPEN_BOT_FAILED ${botUsername} did not accept in ${WAIT_MS / 1000} s`);
      }
      if (command === 'CREATE') {
        const [bHex, bName] = rest;
        // This run proves v1 (spec 0009) still works: M16 made v2 the default, so ask for the fan-out.
        groupId = await manager.createGroup(
          `M12 e2e ${new Date().toISOString().slice(11, 19)}`,
          [
            { account: bHex, username: bName },
            { account: bot.accountHex, username: bot.username },
          ],
          { fanOut: true },
        );
        const group = await getGroup(groupId);
        console.log(`GROUP_CREATED id=${groupId} version=${group.version} members=${group.members.map((m) => m.username).join(',')} invites=${group.invites.length}`);
      }
      if (command === 'WAIT_GROUP') {
        // `any`: the newest group the other person runs (the screenshot run's helper does not know the id).
        // A v2 group (M16) counts once its state is read from the topic, not at the bare welcome.
        const ready = (g) => (g && (g.v !== 2 || g.state) ? g : null);
        const newest = async () => (await db.groups.toArray()).filter((g) => ready(g) && g.admin === otherHex && g.self === 'member').sort((x, y) => y.createdAt - x.createdAt)[0] ?? null;
        const group = await waitFor(async () => (rest[0] === 'any' ? newest() : ready(await getGroup(rest[0]))), WAIT_MS);
        if (group) groupId = group.id;
        if (group) console.log(`JOINED id=${groupId} version=${group.version} members=${group.members.map((m) => m.username).join(',')} admin=${group.admin}`);
      }
      if (command === 'SEND') {
        const text = rest.join(' ');
        const before = Date.now();
        await manager.sendToGroup(groupId, { type: 'text', text });
        const row = (await listMessages(groupPeerOf(groupId))).find((r) => r.direction === 'outgoing' && r.timestamp >= before - 1);
        console.log(`SENT id=${row.messageId} at=${row.timestamp} status=${row.status}`);
      }
      if (command === 'WAIT_MESSAGE') {
        const [id] = rest;
        const row = await waitFor(async () => {
          const found = await db.messages.get(id);
          return found?.peerAccountId === groupPeerOf(groupId) ? found : null;
        }, WAIT_MS);
        if (row) console.log(`GOT id=${row.messageId} sender=${row.senderAccountId} text="${oneLine(row.content.text ?? '')}"`);
      }
      if (command === 'WAIT_BOT') {
        const since = Number(rest[0]);
        // A pca bot edits a live frame ("⏳ working…") into its answer: wait for a bot row that is no longer one.
        const row = await waitFor(
          async () =>
            (await listMessages(groupPeerOf(groupId))).find(
              (r) => r.direction === 'incoming' && r.senderAccountId === bot.accountHex && r.timestamp >= since - 5_000 && !isLiveFrame(r.content) && r.content.type !== 'deleted',
            ) ?? null,
          BOT_WAIT_MS,
        );
        if (row) console.log(`BOT_REPLY id=${row.messageId} type=${row.content.type} text="${oneLine(row.content.text ?? '')}"`);
      }
      if (command === 'REMOVE_OTHER') {
        await manager.updateRoster(groupId, [{ account: bot.accountHex, username: bot.username }]);
        const group = await getGroup(groupId);
        console.log(`ROSTER_SENT version=${group.version} members=${group.members.map((m) => m.username).join(',')}`);
      }
      if (command === 'WAIT_REMOVED') {
        const group = await waitFor(async () => {
          const found = await getGroup(groupId);
          return found && found.self !== 'member' ? found : null;
        }, WAIT_MS);
        if (group) console.log(`REMOVED version=${group.version} self=${group.self}`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
