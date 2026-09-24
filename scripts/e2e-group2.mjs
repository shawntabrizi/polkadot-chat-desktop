#!/usr/bin/env node
// M16 e2e (spec 0011 private groups v2) on devnet: two people through this
// repo's domain code and a pca v2 bot as the third member.
//   npm run e2e:group2 -- [--profile devnet] [--identity-a pcdbenchfinb] [--identity-b pcdeceb] [--pca <polkadot-chat-agents checkout>]
//
// The bot is a NEW throwaway identity, made for this run the way pca's own
// live proof uses a local bot (bot-core/scripts/e2e-groups-v2.mjs): `pca
// create <name> --brain echo --allow <a>` in a scratch PCA_BOTS_DIR, then
// `pca run <name>` from the pca checkout, stopped (and its folder deleted) at
// the end. Never a fleet bot.
//
// The app's database is one per process (Dexie over fake-indexeddb, as in
// e2e-group.mjs), so each person is a child process (`--role a|b`); this
// parent orders the steps. Markers:
//   V2_CREATED          a opens epoch 1 (state on ChState_1) and sends each
//                       member a `welcome`; b and the bot hold epoch 1
//   ONE_SUBMISSION      a's Diagnostics counter rises by exactly 1 submission
//                       (and 1 message) for one group message
//   BOT_REPLY_OK        a and b both take the bot's reply; the bot's
//                       statement is ONE statement on Topic_1 / ChMsgs_1
//   CARRY_OK            b stopped, a sends 3 messages, b restarts and gets all 3
//   REMOVED_LOCKED_OUT  a removes b with 2 submissions; b finds no rekey entry
//                       and cannot open a's next carrier (epoch 2)
//   BOT_EPOCH2_OK       the bot answers a's epoch-2 message on Topic_2
//   HISTORY_OK          a drops the bot's first reply locally, asks the bot
//                       (historyRequest), and the bot's history page brings it back
//   MIGRATED_OK         a v1 (fan-out) room of a and b upgrades in place; b
//                       keeps its v1 row and reads a's v2 message
//   GROUP2_OK
// A step that times out prints `E2E_TIMEOUT <stage>` and the run goes on;
// the end is GROUP2_OK only when every step passed, else GROUP2_INCOMPLETE
// and exit 13. 3 PEER_KEY_UNSUPPORTED; 1 any other failure. Prints no secret.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

if (role) await child();
else await parent();

// ── The parent ─────────────────────────────────────────────────────────────

async function parent() {
  const READY_WAIT_MS = 4 * 60_000;
  const STEP_WAIT_MS = 2 * 60_000;
  const BOT_WAIT_MS = 3 * 60_000;
  const pcaRoot = resolve(flag('pca') ?? join(root, '..', 'polkadot-chat-agents'));
  const pcaCli = join(pcaRoot, 'bot-core', 'cli.mjs');
  if (!existsSync(pcaCli)) {
    console.log(`NO_PCA ${pcaCli} (pass --pca <polkadot-chat-agents checkout>)`);
    process.exit(1);
  }
  // a posts every group statement, so a needs room in its statement allowance.
  // pcde2e (and pcdeceb) are full of never-expiring DM statements from earlier
  // runs and get AccountFull for any group statement (M16, docs/decisions.md);
  // b only reads, so pcdeceb serves.
  const identities = { a: flag('identity-a') ?? 'pcdbenchfinb', b: flag('identity-b') ?? 'pcdeceb' };
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

  // ── The scratch bot: a new identity, local, allowlisting a ──────────────
  const botsDir = mkdtempSync(join(tmpdir(), 'pcd-e2e-group2-bots-'));
  const botName = `pcdgrp${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir };
  console.log(`BOT_CREATE ${botName} (scratch PCA_BOTS_DIR, brain echo, allow ${who.a.username}) at=${at()}`);
  const created = spawnSync(process.execPath, [pcaCli, 'create', botName, '--brain', 'echo', '--allow', who.a.accountHex, '--network', profile, '--wait', '180'], {
    cwd: pcaRoot,
    env: pcaEnv,
    encoding: 'utf8',
    timeout: 6 * 60_000,
  });
  const botConfigFile = join(botsDir, botName, 'config.json');
  const botConfig = existsSync(botConfigFile) ? JSON.parse(readFileSync(botConfigFile, 'utf8')) : null;
  if (created.status !== 0 || !botConfig?.registered) {
    // Only the last lines, and never the secret file: `pca create` prints no key.
    console.log(`BOT_CREATE_FAILED status=${created.status} registered=${botConfig?.registered ?? 'no config'}`);
    for (const line of `${created.stdout ?? ''}${created.stderr ?? ''}`.trim().split('\n').slice(-8)) console.log(`[pca] ${line}`);
    rmSync(botsDir, { recursive: true, force: true });
    process.exit(1);
  }
  const bot = { username: botConfig.username, accountHex: `0x${String(botConfig.account).replace(/^0x/, '')}` };
  console.log(`BOT_REGISTERED ${bot.username} ${bot.accountHex} at=${at()}`);
  // Its own process group: `pca run` starts the bot as a child, and the stop must reach both.
  const botProc = spawn(process.execPath, [pcaCli, 'run', botName], { cwd: pcaRoot, env: pcaEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const botLines = [];
  const botWaiters = [];
  const onBotLine = (line) => {
    botLines.push(line);
    if (/BOT_GROUP2_|BOT_STARTING|_FAILED|ERROR/.test(line)) console.log(`[bot] ${line.slice(0, 220)}`);
    for (const waiter of [...botWaiters]) waiter();
  };
  createInterface({ input: botProc.stdout }).on('line', onBotLine);
  createInterface({ input: botProc.stderr }).on('line', onBotLine);
  const expectBot = (pattern, timeoutMs, from = 0) =>
    new Promise((done) => {
      const check = () => {
        const index = botLines.findIndex((line, i) => i >= from && pattern.test(line));
        if (index < 0) return false;
        botWaiters.splice(botWaiters.indexOf(check), 1);
        clearTimeout(timer);
        done(botLines[index]);
        return true;
      };
      const timer = setTimeout(() => {
        const i = botWaiters.indexOf(check);
        if (i >= 0) botWaiters.splice(i, 1);
        done(null);
      }, timeoutMs);
      if (!check()) botWaiters.push(check);
    });
  const stopBot = () => {
    if (botProc.exitCode === null) {
      try {
        process.kill(-botProc.pid, 'SIGTERM');
      } catch {
        botProc.kill('SIGTERM');
      }
    }
    rmSync(botsDir, { recursive: true, force: true });
  };

  const people = {};
  let failing = false;
  const timeouts = [];
  const stopAll = () => {
    for (const person of Object.values(people)) if (person.proc.exitCode === null) person.proc.kill('SIGTERM');
    stopBot();
  };
  const fail = (code, line) => {
    if (failing) return;
    failing = true;
    console.log(line);
    stopAll();
    setTimeout(() => process.exit(code), 1_500);
  };
  process.on('SIGINT', () => fail(130, 'INTERRUPTED'));

  if (!(await expectBot(/BOT_STARTING/, 60_000))) return fail(13, 'E2E_TIMEOUT the scratch bot starts');

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
    createInterface({ input: proc.stderr }).on('line', (line) => console.log(`[${name}:err] ${line}`));
    proc.on('exit', (code) => {
      if (failing || person.done) return;
      fail(code === 3 ? 3 : 1, `CHILD_FAILED ${name} exit=${code} last="${person.lines.at(-1) ?? ''}"`);
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
  // A value is one word, or a JSON string in quotes (texts).
  const field = (line, key) => line?.match(new RegExp(`\\b${key}=("(?:[^"\\\\]|\\\\.)*"|\\S+)`))?.[1] ?? null;
  const ask = async (name, command, pattern, timeoutMs = STEP_WAIT_MS) => {
    const from = people[name].lines.length;
    send(name, command);
    return expectLine(name, pattern, timeoutMs, from);
  };
  const failed = (entry) => !entry || /_FAILED /.test(entry.line);
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
  console.log(`PEOPLE a=${who.a.username} b=${who.b.username} bot=${bot.username} at=${at()}`);

  // 0. a ↔ b contacts (a's request, b accepts that very one); a opens a chat with the bot.
  const request = await ask('a', 'REQUEST_OTHER', /^REQUEST_SENT |_FAILED /);
  if (failed(request)) return fail(request ? 1 : 13, request?.line ?? 'E2E_TIMEOUT request a → b');
  const accepted = await ask('b', `ACCEPT ${field(request.line, 'id')}`, /^ACCEPTED |_FAILED /);
  if (failed(accepted)) return fail(accepted ? 1 : 13, accepted?.line ?? 'E2E_TIMEOUT b accepts a');
  if (!(await ask('a', 'WAIT_CONTACT', /^CONTACT /))) return fail(13, 'E2E_TIMEOUT a learns the accept');
  const botContact = await ask('a', `OPEN_BOT ${bot.accountHex}`, /^BOT_CONTACT |_FAILED /, BOT_WAIT_MS);
  if (failed(botContact)) return fail(botContact ? 1 : 13, botContact?.line ?? 'E2E_TIMEOUT the bot accepts a');
  console.log(`CONTACTS_OK a↔b, a↔${bot.username} at=${at()}`);

  // 1. a creates the v2 group; b and the bot hold epoch 1.
  const botFrom = botLines.length;
  const create = await ask('a', `CREATE2 ${who.b.accountHex} ${who.b.username} ${bot.accountHex} ${bot.username}`, /^GROUP2_CREATED |_FAILED /);
  if (failed(create)) return fail(create ? 1 : 13, create?.line ?? 'E2E_TIMEOUT create');
  const groupId = field(create.line, 'id');
  const [joined, botJoined] = await Promise.all([ask('b', `WAIT_V2 ${groupId}`, /^JOINED2 /), expectBot(/BOT_GROUP2_JOINED/, BOT_WAIT_MS, botFrom)]);
  if (!joined || !botJoined) timeout(`epoch 1 held (b=${joined ? 'yes' : 'no'} bot=${botJoined ? 'yes' : 'no'})`);
  else console.log(`V2_CREATED group=${groupId} create_statements=${field(create.line, 'statements')} b epoch=${field(joined.line, 'epoch')} bot joined at=${at()}`);

  // 2. One group message = one submission.
  const hello = await ask('a', 'SEND2 hello bot', /^SENT2 |_FAILED /);
  if (failed(hello)) return fail(hello ? 1 : 13, hello?.line ?? 'E2E_TIMEOUT send');
  const since = field(hello.line, 'at');
  if (field(hello.line, 'submissions') !== '1' || field(hello.line, 'messages') !== '1') return fail(1, `ONE_SUBMISSION_BAD ${hello.line}`);
  console.log(`ONE_SUBMISSION submissions=1 messages=1 at=${at()}`);

  // 3. The bot's reply: both take it; it is one statement on Topic_1 / ChMsgs_1.
  const replies = await Promise.all(['a', 'b'].map((name) => ask(name, `WAIT_BOT ${bot.accountHex} ${since} hello bot`, /^BOT_REPLY /, BOT_WAIT_MS)));
  const onTopic1 = await ask('a', `TOPIC_CHECK 1 ${bot.accountHex}`, /^TOPIC /);
  if (replies.some((entry) => entry === null)) timeout(`bot reply (a=${replies[0] ? 'yes' : 'no'} b=${replies[1] ? 'yes' : 'no'})`);
  else if (field(onTopic1?.line, 'msgs') !== '1') return fail(1, `BOT_REPLY_NOT_ONE_STATEMENT ${onTopic1?.line}`);
  else console.log(`BOT_REPLY_OK id=${field(replies[0].line, 'id')} text=${field(replies[0].line, 'text')} bot statements on Topic_1: ChMsgs_1=${field(onTopic1.line, 'msgs')} at=${at()}`);
  const firstBotReply = field(replies[0]?.line, 'id');

  // 4. Carry: b stopped, a sends three (apart, so three statements), b restarts and gets all three.
  if (!(await ask('b', 'STOP', /^STOPPED/))) timeout('b stops');
  const carryIds = [];
  for (const word of ['carry-one', 'carry-two', 'carry-three']) {
    const sent = await ask('a', `SEND2 ${word}`, /^SENT2 |_FAILED /);
    if (!failed(sent)) carryIds.push(field(sent.line, 'id'));
    await delay(1_500);
  }
  if (!(await ask('b', 'START', /^STARTED/))) timeout('b restarts');
  const carried = await ask('b', `WAIT_IDS ${carryIds.join(',')}`, /^GOT_IDS /);
  if (!carried || carryIds.length !== 3) timeout('b gets the three carried messages');
  else console.log(`CARRY_OK b got ${carryIds.length} messages from a's current statement after a restart at=${at()}`);

  // 5. a removes b: 2 submissions; b is locked out of epoch 2.
  const removed = await ask('a', `REMOVE2 ${who.b.accountHex}`, /^REMOVED2 |_FAILED /);
  if (failed(removed)) return fail(removed ? 1 : 13, removed?.line ?? 'E2E_TIMEOUT remove');
  if (field(removed.line, 'submissions') !== '2') return fail(1, `REMOVE_COST ${removed.line}`);
  const locked = await ask('b', `WAIT_LOCKED ${groupId}`, /^LOCKED /);
  const after = await ask('a', 'SEND2 after b left', /^SENT2 |_FAILED /);
  const topic2 = await ask('a', 'TOPIC 2', /^TOPIC_HEX /);
  const tried = topic2 ? await ask('b', `TRY_OPEN ${field(topic2.line, 'topic')} ${who.a.accountHex}`, /^TRIED /) : null;
  if (!locked || failed(after) || !tried) timeout(`removal (locked=${!!locked} sent=${!failed(after)} tried=${!!tried})`);
  else if (field(tried.line, 'opened') !== '0' || field(tried.line, 'statements') === '0') return fail(1, `NOT_LOCKED_OUT ${tried.line}`);
  else console.log(`REMOVED_LOCKED_OUT submissions=2 b: no entry, epoch=${field(locked.line, 'epoch')}, a's epoch-2 statements=${field(tried.line, 'statements')} opened=0 at=${at()}`);

  // 6. The bot answers on epoch 2.
  const reply2 = await ask('a', `WAIT_BOT ${bot.accountHex} ${field(after?.line, 'at') ?? Date.now()} after b left`, /^BOT_REPLY /, BOT_WAIT_MS);
  const onTopic2 = await ask('a', `TOPIC_CHECK 2 ${bot.accountHex}`, /^TOPIC /);
  if (!reply2) timeout('bot reply in epoch 2');
  else if (field(onTopic2?.line, 'msgs') !== '1') return fail(1, `BOT_EPOCH2_NOT_ON_TOPIC2 ${onTopic2?.line}`);
  else console.log(`BOT_EPOCH2_OK text=${field(reply2.line, 'text')} on Topic_2 at=${at()}`);

  // 7. History on request: a forgets the bot's first reply, asks the bot, gets it back.
  const history = firstBotReply ? await ask('a', `HISTORY ${bot.accountHex} ${firstBotReply}`, /^HISTORY_BACK |_FAILED /, BOT_WAIT_MS) : null;
  if (failed(history)) timeout(`history from the bot${history ? ` (${history.line})` : ''}`);
  else console.log(`HISTORY_OK the bot's page brought back id=${firstBotReply} (${field(history.line, 'note')}) at=${at()}`);

  // 8. Migration: a v1 room of a and b, upgraded in place.
  const v1 = await ask('a', `CREATE1 ${who.b.accountHex} ${who.b.username}`, /^GROUP1_CREATED |_FAILED /);
  const v1Id = field(v1?.line, 'id');
  const v1Joined = v1Id ? await ask('b', `WAIT_V1 ${v1Id}`, /^JOINED1 /) : null;
  const v1Said = v1Joined ? await ask('a', `SEND_TO ${v1Id} said in v1`, /^SENT_TO |_FAILED /) : null;
  const v1Got = v1Said && !failed(v1Said) ? await ask('b', `WAIT_ID ${v1Id} ${field(v1Said.line, 'id')}`, /^GOT_ID /) : null;
  const upgraded = v1Got ? await ask('a', `UPGRADE ${v1Id}`, /^UPGRADED |_FAILED /) : null;
  const bV2 = upgraded && !failed(upgraded) ? await ask('b', `WAIT_V2 ${v1Id}`, /^JOINED2 /) : null;
  const v2Said = bV2 ? await ask('a', `SEND_TO ${v1Id} said in v2`, /^SENT_TO |_FAILED /) : null;
  const v2Got = v2Said && !failed(v2Said) ? await ask('b', `WAIT_ID ${v1Id} ${field(v2Said.line, 'id')} ${field(v1Said.line, 'id')}`, /^GOT_ID /) : null;
  if (!v2Got) timeout(`migration (v1=${!!v1Joined} got=${!!v1Got} upgraded=${!!upgraded && !failed(upgraded)} b v2=${!!bV2} v2 got=${!!v2Got})`);
  else console.log(`MIGRATED_OK group=${v1Id} b kept its v1 row (${field(v2Got.line, 'kept')}) and read a's v2 message at=${at()}`);

  if (timeouts.length > 0) return end(`GROUP2_INCOMPLETE ${timeouts.length} step(s) timed out: ${timeouts.join('; ')}`, 13);
  end(`GROUP2_OK at=${at()}`, 0);
}

// ── A child: one person with one identity ──────────────────────────────────

async function child() {
  await import('fake-indexeddb/auto');
  const { register } = await import('tsx/esm/api');
  register();
  const load = (path) => import(pathToFileURL(join(root, path)).href);

  const POLL_MS = 1_000;
  const WAIT_MS = 110_000;
  const BOT_WAIT_MS = 170_000;
  const identityName = flag('identity');
  const otherHex = flag('other');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  const oneWord = (text) => JSON.stringify(String(text).replace(/\s+/g, ' ').slice(0, 60));
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
  const { createChatManager } = await load('src/renderer/domain/chat/manager.ts');
  const { listMessages } = await load('src/renderer/domain/chat/messages.ts');
  const { getGroup } = await load('src/renderer/domain/chat/groups.ts');
  const { isLiveFrame } = await load('src/renderer/domain/chat/content.ts');
  const { deriveEpoch, open, VARIANT } = await load('src/renderer/domain/chat/groupKeys.ts');
  const { decodeGroupData } = await load('src/renderer/domain/chat/groupCodec.ts');
  // M16b: epoch keys live sealed in the `keys` table, not on the group row.
  const { loadGroupKeys } = await load('src/renderer/domain/chat/groupKeyStore.ts');

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
  const startManager = () => createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  manager = await startManager();
  console.log(`READY username=${saved.username}`);

  let groupId = null;
  const peerOf = async (accountHex, label) => {
    const peer = await lookup.getPeerIdentity(bytesOf(accountHex));
    if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${label}`);
    return peer;
  };
  /** Sends a text to `id` and reports what it cost on this manager's meter. */
  const sendCounted = async (id, text) => {
    const before = manager.submissions.snapshot();
    const startedAt = Date.now();
    await manager.sendToGroup(id, { type: 'text', text });
    const row = (await listMessages(groupPeerOf(id))).filter((r) => r.direction === 'outgoing' && r.timestamp >= startedAt - 1).at(-1);
    const after = manager.submissions.snapshot();
    return { row, submissions: after.submissions - before.submissions, messages: after.messages - before.messages };
  };
  /** Statements on the epoch's topic, from the group's key this client holds. */
  const epochOf = async (epoch) => {
    const key = (await loadGroupKeys(groupId)).find((k) => k.epoch === epoch && !k.fork);
    return key ? deriveEpoch(key.key, groupId, epoch) : null;
  };
  const statementsOn = async (topic) => {
    const result = await connection.adapter.queryStatements({ matchAny: [topic] });
    return result.isOk() ? result.value : [];
  };

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        const peer = await peerOf(otherHex, 'other person');
        await manager.sendRequest(peer, 'M16 group e2e');
        const request = (await db.requests.toArray()).filter((row) => row.direction === 'outgoing' && row.peerAccountId === otherHex).sort((x, y) => y.createdAt - x.createdAt)[0];
        console.log(`REQUEST_SENT id=${request.requestId} to=${peer.username}`);
      }
      if (command === 'ACCEPT') {
        const request = await waitFor(() => db.requests.get(rest[0]), WAIT_MS);
        if (!request) console.log(`ACCEPT_FAILED no request ${rest[0]} arrived`);
        else {
          await manager.acceptRequest(rest[0]);
          console.log(`ACCEPTED ${request.peerUsername} id=${rest[0]}`);
        }
      }
      if (command === 'WAIT_CONTACT') {
        const contact = await waitFor(() => db.contacts.get(otherHex), WAIT_MS);
        if (contact) console.log(`CONTACT ${contact.username} devices=${contact.devices.length}`);
      }
      if (command === 'OPEN_BOT') {
        const [botHex] = rest;
        await manager.sendRequest(await peerOf(botHex, 'the scratch bot'), null);
        const contact = await waitFor(() => db.contacts.get(botHex), BOT_WAIT_MS);
        console.log(contact ? `BOT_CONTACT ${contact.username} ${botHex}` : `OPEN_BOT_FAILED the bot did not accept in ${BOT_WAIT_MS / 1000} s`);
      }
      if (command === 'CREATE2') {
        const [bHex, bName, botHex, botName] = rest;
        const before = manager.submissions.snapshot().submissions;
        groupId = await manager.createGroup(`M16 e2e ${new Date().toISOString().slice(11, 19)}`, [
          { account: bHex, username: bName },
          { account: botHex, username: botName },
        ]);
        const group = await getGroup(groupId);
        // The state is one statement; each welcome is one DM (the SDK session merges a batch).
        console.log(`GROUP2_CREATED id=${groupId} v=${group.v} epoch=${group.epoch} statements=${manager.submissions.snapshot().submissions - before} members=${group.members.map((m) => m.username).join(',')}`);
      }
      if (command === 'CREATE1') {
        const [bHex, bName] = rest;
        const id = await manager.createGroup(`M16 v1 ${new Date().toISOString().slice(11, 19)}`, [{ account: bHex, username: bName }], { fanOut: true });
        console.log(`GROUP1_CREATED id=${id}`);
      }
      if (command === 'WAIT_V2') {
        const group = await waitFor(async () => {
          const found = await getGroup(rest[0]);
          return found?.v === 2 && found.state && found.self === 'member' ? found : null;
        }, WAIT_MS);
        if (group) {
          groupId = rest[0];
          console.log(`JOINED2 id=${group.id} epoch=${group.epoch} version=${group.state.version} members=${group.members.map((m) => m.username).join(',')}`);
        }
      }
      if (command === 'WAIT_V1') {
        const group = await waitFor(async () => {
          const found = await getGroup(rest[0]);
          return found && found.v !== 2 && found.self === 'member' ? found : null;
        }, WAIT_MS);
        if (group) console.log(`JOINED1 id=${group.id} version=${group.version}`);
      }
      if (command === 'SEND2') {
        const sent = await sendCounted(groupId, rest.join(' '));
        console.log(`SENT2 id=${sent.row.messageId} at=${sent.row.timestamp} status=${sent.row.status} submissions=${sent.submissions} messages=${sent.messages}`);
      }
      if (command === 'SEND_TO') {
        const [id, ...words] = rest;
        const sent = await sendCounted(id, words.join(' '));
        console.log(`SENT_TO id=${sent.row.messageId} submissions=${sent.submissions}`);
      }
      if (command === 'WAIT_BOT') {
        // The echo bot answers "Echo: <text>": wait for the answer to these words.
        const [botHex, since, ...words] = rest;
        const about = words.join(' ');
        const row = await waitFor(
          async () =>
            (await listMessages(groupPeerOf(groupId))).find(
              (r) =>
                r.direction === 'incoming' &&
                r.senderAccountId === botHex &&
                r.timestamp >= Number(since) - 5_000 &&
                !isLiveFrame(r.content) &&
                r.content.type !== 'deleted' &&
                (r.content.text ?? '').includes(about),
            ) ?? null,
          BOT_WAIT_MS,
        );
        if (row) console.log(`BOT_REPLY id=${row.messageId} type=${row.content.type} text=${oneWord(row.content.text ?? '')}`);
      }
      if (command === 'TOPIC_CHECK') {
        const [epoch, signerHex] = rest;
        const ep = await epochOf(Number(epoch));
        const mine = ep ? (await statementsOn(ep.topic)).filter((s) => (s.proof?.value?.signer ?? '').toLowerCase() === signerHex.toLowerCase()) : [];
        const msgs = ep ? mine.filter((s) => (s.channel ?? '').toLowerCase() === hexOf(ep.channels.msgs)).length : 0;
        console.log(`TOPIC epoch=${epoch} statements=${mine.length} msgs=${msgs}`);
      }
      if (command === 'TOPIC') {
        const ep = await epochOf(Number(rest[0]));
        console.log(`TOPIC_HEX epoch=${rest[0]} topic=${ep ? hexOf(ep.topic) : 'none'}`);
      }
      if (command === 'STOP') {
        manager.dispose();
        manager = null;
        console.log('STOPPED');
      }
      if (command === 'START') {
        manager = await startManager();
        console.log('STARTED');
      }
      if (command === 'WAIT_IDS') {
        const wanted = rest[0].split(',').filter(Boolean);
        const all = await waitFor(async () => ((await Promise.all(wanted.map((id) => db.messages.get(id)))).every(Boolean) ? true : null), WAIT_MS);
        if (all) console.log(`GOT_IDS ${wanted.length}`);
      }
      if (command === 'WAIT_ID') {
        const [id, messageId, keptId] = rest;
        const row = await waitFor(async () => {
          const found = await db.messages.get(messageId);
          return found?.peerAccountId === groupPeerOf(id) ? found : null;
        }, WAIT_MS);
        if (row) console.log(`GOT_ID id=${messageId} kept=${keptId ? String(!!(await db.messages.get(keptId))) : 'n/a'}`);
      }
      if (command === 'REMOVE2') {
        const before = manager.submissions.snapshot().submissions;
        await manager.removeGroupMember(groupId, rest[0]);
        const group = await getGroup(groupId);
        console.log(`REMOVED2 epoch=${group.epoch} submissions=${manager.submissions.snapshot().submissions - before} members=${group.members.map((m) => m.username).join(',')}`);
      }
      if (command === 'WAIT_LOCKED') {
        const group = await waitFor(async () => {
          const found = await getGroup(rest[0]);
          return found?.locked ? found : null;
        }, WAIT_MS);
        if (group) console.log(`LOCKED epoch=${group.epoch} keys=${(await loadGroupKeys(rest[0])).map((k) => k.epoch).join(',')}`);
      }
      if (command === 'TRY_OPEN') {
        // Every key this client ever held for the group, against every statement a signed on the topic.
        const [topicHex, signerHex] = rest;
        const keys = await loadGroupKeys(groupId);
        const found = (await statementsOn(bytesOf(topicHex))).filter((s) => (s.proof?.value?.signer ?? '').toLowerCase() === signerHex.toLowerCase());
        let opened = 0;
        for (const statement of found) {
          const data = decodeGroupData(statement.data);
          if (data.tag === 'rekey') continue;
          for (const key of keys) {
            try {
              await open(deriveEpoch(key.key, groupId, 2).msgKey, { signer: signerHex, epoch: 2, variant: data.tag === 'state' ? VARIANT.state : VARIANT.messages, sealed: data.value });
              opened += 1;
            } catch {
              // Locked out: the tag does not verify.
            }
          }
        }
        console.log(`TRIED statements=${found.length} opened=${opened} watched=${manager.groupTopics().includes(topicHex.toLowerCase())}`);
      }
      if (command === 'HISTORY') {
        const [botHex, messageId] = rest;
        // Simulate a missed message: forget the bot's reply here, then ask the bot for history.
        const group = await getGroup(groupId);
        await db.messages.delete(messageId);
        await db.groups.put({ ...group, seenIds: (group.seenIds ?? []).filter((id) => id !== `${botHex}:${messageId}`) });
        const asked = await manager.requestGroupHistory(groupId, botHex, group.createdAt - 1);
        const back = await waitFor(() => db.messages.get(messageId), WAIT_MS);
        const note = (await listMessages(groupPeerOf(groupId))).filter((r) => r.content.type === 'groupEvent' && /shared/.test(r.content.text)).at(-1);
        console.log(back ? `HISTORY_BACK id=${messageId} asked=${asked} note=${oneWord(note?.content.text ?? 'none')}` : `HISTORY_FAILED no page brought ${messageId} back`);
      }
      if (command === 'UPGRADE') {
        const before = manager.submissions.snapshot().submissions;
        await manager.upgradeGroup(rest[0]);
        const group = await getGroup(rest[0]);
        console.log(`UPGRADED id=${rest[0]} v=${group.v} epoch=${group.epoch} statements=${manager.submissions.snapshot().submissions - before}`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
