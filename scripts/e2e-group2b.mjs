#!/usr/bin/env node
// M16b e2e (spec 0011 supergroup features) on devnet: two people through this
// repo's domain code and a throwaway pca v2 bot as the third member.
//   npm run e2e:group2b -- [--profile devnet] [--identity-a pcdbenchfinb] [--identity-b pcdbenchfina] [--pca <polkadot-chat-agents checkout>] [--register-wait <s>]
//
// a and b are the identities with room in their statement allowance (review
// M16: pcde2e and pcdeceb are full of never-expiring DM statements and get
// AccountFull for any group statement). a posts the states; b posts carriers,
// and in the last step (as an admin) a rekey and a state.
//
// The bot is a NEW identity made for this run, as in e2e-group2: `pca create
// <name> --brain echo --allow <a>` in a scratch PCA_BOTS_DIR, `pca run` from
// the pca checkout, stopped and its folder deleted at the end. Never a fleet bot.
//
// Each person is a child process (`--role a|b`, one Dexie over fake-indexeddb
// each); this parent orders the steps. b and a have NO chat before the join:
// the invite link is b's only way in. Markers:
//   JOIN_APPROVED   a copies an invite link (policy 1); b opens it: a chat
//                   request to a with the capability in its opener; a's client
//                   accepts it at once, b sends joinRequest, a's queue shows b,
//                   b hears "pending"; a approves (one state) and b holds the group
//   HISTORY_OK      b has a's and the bot's messages from before it joined and
//                   the line "History shared by <a>"
//   DERIVED_NAME_OK the group was made with NO name (owner ask 2026-09-24): a
//                   showed the bot's name alone at creation; after b joins, a
//                   shows "<b>, <bot>" and b shows "<a>, <bot>" (sorted, never
//                   oneself); a's creation waited until the bot's devices were
//                   known to support groups (the capability-gated picker)
//   RENAME_OK       a names the group (one state statement); b's state has the
//                   name and b's room has the line "<a> named the group “X”"
//   PIN_OK          a pins a message (one state); b's state lists the pin
//   SLOW_OK         slow mode 10 s: b's second message waits on b's side
//                   (nothing submitted for 3 s), a carrier b forges too soon is
//                   hidden by a, and b's held message reaches a after the 10 s
//   PROMOTED_OK     a makes b an admin (one state); b sees its role
//   BOT_REMOVED_OK  b (admin) removes the bot: 2 submissions; a moves to epoch
//                   2 without the bot, by b's state
//   GROUP2B_OK
// A step that times out prints `E2E_TIMEOUT <stage>`; the run ends
// GROUP2B_INCOMPLETE and exit 13 when any step timed out. 3
// PEER_KEY_UNSUPPORTED; 1 any other failure. Prints no secret.

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
  const SLOW_SECS = 10;
  const pcaRoot = resolve(flag('pca') ?? join(root, '..', 'polkadot-chat-agents'));
  const pcaCli = join(pcaRoot, 'bot-core', 'cli.mjs');
  if (!existsSync(pcaCli)) {
    console.log(`NO_PCA ${pcaCli} (pass --pca <polkadot-chat-agents checkout>)`);
    process.exit(1);
  }
  const identities = { a: flag('identity-a') ?? 'pcdbenchfinb', b: flag('identity-b') ?? 'pcdbenchfina' };
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
  const botsDir = mkdtempSync(join(tmpdir(), 'pcd-e2e-group2b-bots-'));
  const botName = `pcdgrp${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir };
  console.log(`BOT_CREATE ${botName} (scratch PCA_BOTS_DIR, brain echo, allow ${who.a.username}) at=${at()}`);
  const created = spawnSync(process.execPath, [pcaCli, 'create', botName, '--brain', 'echo', '--allow', who.a.accountHex, '--network', profile, '--wait', flag('register-wait') ?? '180'], {
    cwd: pcaRoot,
    env: pcaEnv,
    encoding: 'utf8',
    timeout: (Number(flag('register-wait') ?? 180) + 180) * 1000,
  });
  const botConfigFile = join(botsDir, botName, 'config.json');
  const botConfig = existsSync(botConfigFile) ? JSON.parse(readFileSync(botConfigFile, 'utf8')) : null;
  if (created.status !== 0 || !botConfig?.registered) {
    console.log(`BOT_CREATE_FAILED status=${created.status} registered=${botConfig?.registered ?? 'no config'}`);
    for (const line of `${created.stdout ?? ''}${created.stderr ?? ''}`.trim().split('\n').slice(-8)) console.log(`[pca] ${line}`);
    rmSync(botsDir, { recursive: true, force: true });
    process.exit(1);
  }
  const bot = { username: botConfig.username, accountHex: `0x${String(botConfig.account).replace(/^0x/, '')}` };
  console.log(`BOT_REGISTERED ${bot.username} ${bot.accountHex} at=${at()}`);
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
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identities[name], '--profile', profile], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const person = { name, proc, lines: [], waiters: [] };
    people[name] = person;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      console.log(`[${name}] ${line.replace(/\blink=\S+/, 'link=<not echoed>')}`);
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

  // 0. a opens a chat with the bot and makes the group with it; history for newcomers on.
  const botContact = await ask('a', `OPEN_BOT ${bot.accountHex}`, /^BOT_CONTACT |_FAILED /, BOT_WAIT_MS);
  if (failed(botContact)) return fail(botContact ? 1 : 13, botContact?.line ?? 'E2E_TIMEOUT the bot accepts a');
  const botFrom = botLines.length;
  const create = await ask('a', `CREATE2 ${bot.accountHex} ${bot.username}`, /^GROUP2_CREATED |_FAILED /);
  if (failed(create)) return fail(create ? 1 : 13, create?.line ?? 'E2E_TIMEOUT create');
  const groupId = field(create.line, 'id');
  if (!(await expectBot(/BOT_GROUP2_JOINED/, BOT_WAIT_MS, botFrom))) return fail(13, 'E2E_TIMEOUT the bot holds epoch 1');
  const shareOn = await ask('a', 'SETTINGS {"historyShare":100}', /^SETTINGS_DONE |_FAILED /);
  if (failed(shareOn)) return fail(shareOn ? 1 : 13, shareOn?.line ?? 'E2E_TIMEOUT history on');
  // Two messages from before b: a's, and the bot's answer to it.
  const before = await ask('a', 'SEND2 said before b joined', /^SENT2 |_FAILED /);
  if (failed(before)) return fail(before ? 1 : 13, before?.line ?? 'E2E_TIMEOUT send');
  const botBefore = await ask('a', `WAIT_BOT ${bot.accountHex} ${field(before.line, 'at')} said before b joined`, /^BOT_REPLY /, BOT_WAIT_MS);
  if (!botBefore) timeout('the bot answers before b joins');
  console.log(`GROUP_READY group=${groupId} a=${field(before.line, 'id')} bot=${field(botBefore?.line, 'id')} at=${at()}`);

  // 1. Invite link, policy 1: b asks, a approves.
  const invite = await ask('a', 'INVITE', /^INVITE |_FAILED /);
  if (failed(invite)) return fail(invite ? 1 : 13, invite?.line ?? 'E2E_TIMEOUT invite');
  const joinSent = await ask('b', `JOIN ${field(invite.line, 'link')}`, /^JOIN_SENT |_FAILED /);
  if (failed(joinSent)) return fail(joinSent ? 1 : 13, joinSent?.line ?? 'E2E_TIMEOUT b opens the link');
  const [queued, pendingB] = await Promise.all([
    ask('a', `WAIT_JOIN_REQUEST ${who.b.accountHex}`, /^JOIN_QUEUED /, BOT_WAIT_MS),
    ask('b', 'WAIT_JOIN_STATUS pending', /^JOIN_STATUS /, BOT_WAIT_MS),
  ]);
  if (!queued || !pendingB) timeout(`join request (a queued=${!!queued} b pending=${!!pendingB})`);
  const approved = queued ? await ask('a', `APPROVE ${who.b.accountHex}`, /^APPROVED |_FAILED /) : null;
  const joined = approved && !failed(approved) ? await ask('b', `WAIT_V2 ${groupId}`, /^JOINED2 /) : null;
  if (!joined) timeout(`b joins (approved=${!!approved && !failed(approved)})`);
  else
    console.log(
      `JOIN_APPROVED policy=${field(invite.line, 'policy')} a accepted the chat request itself (${field(queued.line, 'contact')}), b heard pending, approve cost ${field(approved.line, 'submissions')} submissions (the state; the welcome and the history ride the DM), b epoch=${field(joined.line, 'epoch')} at=${at()}`,
    );

  // 2. History from before b joined.
  const history = joined ? await ask('b', `WAIT_HISTORY ${field(before.line, 'id')},${field(botBefore?.line, 'id') ?? ''} ${who.a.username}`, /^HISTORY |_FAILED /) : null;
  if (failed(history)) timeout(`history for b${history ? ` (${history.line})` : ''}`);
  else console.log(`HISTORY_OK b has both earlier messages and the line ${field(history.line, 'note')} at=${at()}`);

  // 2b. The derived name (the group has no name), then a rename.
  const expectName = (...names) => [...names].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }) || x.localeCompare(y)).join(', ');
  const [nameA, nameB] = joined ? await Promise.all([ask('a', 'NAME', /^NAME /), ask('b', 'NAME', /^NAME /)]) : [null, null];
  const createdName = field(create.line, 'derived');
  if (!nameA || !nameB) timeout('the derived names');
  else if (
    JSON.parse(createdName) !== bot.username ||
    JSON.parse(field(nameA.line, 'shown')) !== expectName(who.b.username, bot.username) ||
    JSON.parse(field(nameB.line, 'shown')) !== expectName(who.a.username, bot.username) ||
    field(nameA.line, 'stored') !== '""'
  )
    return fail(1, `DERIVED_NAME_BAD created=${createdName} a="${nameA.line}" b="${nameB.line}"`);
  else console.log(`DERIVED_NAME_OK created unnamed; a saw ${createdName} at creation, now a sees ${field(nameA.line, 'shown')} and b sees ${field(nameB.line, 'shown')} at=${at()}`);
  const newName = `Trail crew ${new Date().toISOString().slice(11, 19)}`;
  const renamed = nameA ? await ask('a', `RENAME ${newName}`, /^RENAMED |_FAILED /) : null;
  const renameSeen = renamed && !failed(renamed) ? await ask('b', `WAIT_RENAME ${who.a.username} ${newName}`, /^RENAME_SEEN /) : null;
  if (!renameSeen) timeout(`rename (${renamed?.line ?? 'not asked'})`);
  else console.log(`RENAME_OK cost ${field(renamed.line, 'submissions')} statement(s); b shows ${field(renameSeen.line, 'shown')} with the line ${field(renameSeen.line, 'line')} at=${at()}`);

  // 3. a pins its first message; b holds the pin.
  const pin = joined ? await ask('a', `PIN ${field(before.line, 'id')}`, /^PINNED |_FAILED /) : null;
  const pinned = pin && !failed(pin) ? await ask('b', `WAIT_PIN ${field(before.line, 'id')}`, /^PIN_SEEN /) : null;
  if (!pinned) timeout(`pin (a pinned=${!!pin && !failed(pin)})`);
  else console.log(`PIN_OK cost ${field(pin.line, 'submissions')} statement(s); b's state pins ${field(pinned.line, 'pinned')} at=${at()}`);

  // 4. Slow mode 10 s.
  const slow = joined ? await ask('a', `SETTINGS {"slowModeSecs":${SLOW_SECS}}`, /^SETTINGS_DONE |_FAILED /) : null;
  const slowSeen = slow && !failed(slow) ? await ask('b', `WAIT_SLOW ${SLOW_SECS}`, /^SLOW_SEEN /) : null;
  let slowOk = false;
  if (slowSeen) {
    const first = await ask('b', 'SEND2 slow one', /^SENT2 |_FAILED /);
    const held = !failed(first) ? await ask('b', 'SEND_HELD slow two', /^HELD /, 30_000) : null;
    const gotFirst = !failed(first) ? await ask('a', `WAIT_TEXT slow one`, /^GOT_TEXT /) : null;
    const forged = held ? await ask('b', 'FORGE too soon', /^FORGED |_FAILED /) : null;
    const hidden = forged && !failed(forged) ? await ask('a', `EXPECT_HIDDEN ${field(forged.line, 'id')}`, /^HIDDEN |SHOWN /, 30_000) : null;
    const gotHeld = held ? await ask('a', 'WAIT_TEXT slow two', /^GOT_TEXT /) : null;
    const sentAt = Number(field(first?.line, 'at'));
    const gap = gotHeld ? (Number(field(gotHeld.line, 'received')) - sentAt) / 1000 : null;
    if (!held || !gotFirst || !hidden || !gotHeld) timeout(`slow mode (held=${!!held} first=${!!gotFirst} hidden=${hidden?.line ?? 'no'} second=${!!gotHeld})`);
    else if (field(held.line, 'submissions') !== '0' || !/^HIDDEN /.test(hidden.line) || gap < SLOW_SECS - 1) return fail(1, `SLOW_BAD held="${held.line}" hidden="${hidden.line}" gap=${gap}`);
    else {
      slowOk = true;
      console.log(`SLOW_OK b's second message waited (0 submissions in 3 s), a hid the forged one, the held one reached a ${gap.toFixed(1)} s after the first at=${at()}`);
    }
  } else timeout(`slow mode on (a=${!!slow && !failed(slow)})`);
  if (slowOk) await ask('a', 'SETTINGS {"slowModeSecs":0}', /^SETTINGS_DONE |_FAILED /);

  // 5. a makes b an admin; b removes the bot.
  const promote = joined ? await ask('a', `PROMOTE ${who.b.accountHex}`, /^PROMOTED |_FAILED /) : null;
  const role = promote && !failed(promote) ? await ask('b', 'WAIT_ROLE 1', /^ROLE /) : null;
  if (!role) timeout(`promote (a=${!!promote && !failed(promote)})`);
  else console.log(`PROMOTED_OK cost ${field(promote.line, 'submissions')} statement(s); b is ${field(role.line, 'role')} with flags ${field(role.line, 'flags')} at=${at()}`);
  const botFrom2 = botLines.length;
  const removed = role ? await ask('b', `REMOVE2 ${bot.accountHex}`, /^REMOVED2 |_FAILED /) : null;
  const aSees = removed && !failed(removed) ? await ask('a', `WAIT_GONE ${bot.accountHex}`, /^GONE /) : null;
  if (!aSees) timeout(`b removes the bot (${removed?.line ?? 'no answer'})`);
  else if (field(removed.line, 'submissions') !== '2') return fail(1, `REMOVE_COST ${removed.line}`);
  else if (field(aSees.line, 'signer') !== who.b.accountHex) return fail(1, `REMOVED_BY_SOMEONE_ELSE ${aSees.line}`);
  else {
    const botSaw = await expectBot(/BOT_GROUP2_(KEY_REQUEST|REMOVED|REKEY)/, 20_000, botFrom2);
    console.log(`BOT_REMOVED_OK by b in 2 submissions; a epoch=${field(aSees.line, 'epoch')} members=${field(aSees.line, 'members')} signer=b (${who.b.username}); bot: ${botSaw ? botSaw.slice(0, 60) : 'no log line in 20 s'} at=${at()}`);
  }

  if (timeouts.length > 0) return end(`GROUP2B_INCOMPLETE ${timeouts.length} step(s) timed out: ${timeouts.join('; ')}`, 13);
  end(`GROUP2B_OK at=${at()}`, 0);
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
  const { groupDisplayName, readSelfAccount } = await load('src/renderer/domain/chat/groupNames.ts');
  const { loadGroupSupport } = await load('src/renderer/domain/chat/capabilities.ts');
  const { isLiveFrame } = await load('src/renderer/domain/chat/content.ts');
  const { VARIANT, createGroupExpiryAllocator, deriveEpoch, seal } = await load('src/renderer/domain/chat/groupKeys.ts');
  const { encodeGroupData, encodeGroupMessages } = await load('src/renderer/domain/chat/groupCodec.ts');
  const { loadGroupKeys } = await load('src/renderer/domain/chat/groupKeyStore.ts');
  const { ChatMessageCodec } = await load('src/renderer/domain/chat/identityEvents.ts');
  const { createSr25519Prover, submitStatementOnce } = await import('@novasamatech/statement-store');

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

  let groupId = null;
  const peerOf = async (accountHex, label) => {
    const peer = await lookup.getPeerIdentity(bytesOf(accountHex));
    if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${label}`);
    return peer;
  };
  const cost = async (work) => {
    const before = manager.submissions.snapshot().submissions;
    await work();
    return manager.submissions.snapshot().submissions - before;
  };
  const rows = () => listMessages(groupPeerOf(groupId));
  const textRow = async (text) => (await rows()).find((r) => !isLiveFrame(r.content) && r.content.type !== 'deleted' && (r.content.text ?? '') === text) ?? null;
  const me = async () => (await getGroup(groupId))?.state?.members.find((m) => m.account === saved.accountHex) ?? null;
  // The name the room header, the list and notifications show (the UI's own function).
  const shownName = async () => groupDisplayName(await getGroup(groupId), await readSelfAccount(), await db.contacts.toArray());

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'OPEN_BOT') {
        const [botHex] = rest;
        await manager.sendRequest(await peerOf(botHex, 'the scratch bot'), null);
        const contact = await waitFor(() => db.contacts.get(botHex), BOT_WAIT_MS);
        console.log(contact ? `BOT_CONTACT ${contact.username} ${botHex}` : `OPEN_BOT_FAILED the bot did not accept in ${BOT_WAIT_MS / 1000} s`);
      }
      if (command === 'CREATE2') {
        const [botHex, botName] = rest;
        // The picker takes the bot only once its devices are known to support groups (its set, or its botInfo).
        const support = await waitFor(async () => {
          const [contact, info] = await Promise.all([db.contacts.get(botHex), db.peerInfo.get(botHex)]);
          const found = await loadGroupSupport(botHex, contact?.devices ?? [], (info?.botInfo ?? null) !== null, bytesOf(botHex));
          return found === 'ready' ? found : null;
        }, BOT_WAIT_MS);
        console.log(`BOT_GROUP_SUPPORT ${support ?? 'not known in time'}`);
        // Owner ask 2026-09-24: no name; the group shows its members' names.
        const statements = await cost(async () => {
          groupId = await manager.createGroup('', [{ account: botHex, username: botName }]);
        });
        const group = await getGroup(groupId);
        console.log(`GROUP2_CREATED id=${groupId} epoch=${group.epoch} statements=${statements} derived=${JSON.stringify(await shownName())}`);
      }
      if (command === 'NAME') {
        const group = await getGroup(groupId);
        console.log(`NAME shown=${JSON.stringify(await shownName())} stored=${JSON.stringify(group?.name ?? null)} members=${group?.members.length}`);
      }
      if (command === 'RENAME') {
        const name = rest.join(' ');
        const statements = await cost(() => manager.setGroupSettings(groupId, { name }));
        console.log(`RENAMED submissions=${statements} name=${JSON.stringify((await getGroup(groupId)).state.name)}`);
      }
      if (command === 'WAIT_RENAME') {
        const [actor, ...words] = rest;
        const name = words.join(' ');
        const line = `${actor} named the group “${name}”`;
        const found = await waitFor(async () => {
          const group = await getGroup(groupId);
          return group?.name === name && (await rows()).find((r) => r.content.type === 'groupEvent' && r.content.text.split(' · ').includes(line));
        }, WAIT_MS);
        if (found) console.log(`RENAME_SEEN shown=${JSON.stringify(await shownName())} line=${JSON.stringify(line)}`);
      }
      if (command === 'SETTINGS') {
        const settings = JSON.parse(rest.join(' '));
        const statements = await cost(() => manager.setGroupSettings(groupId, settings));
        const state = (await getGroup(groupId)).state;
        console.log(`SETTINGS_DONE statements=${statements} slow=${state.slowModeSecs} history=${state.historyShare} policy=${state.joinPolicy}`);
      }
      if (command === 'SEND2') {
        const text = rest.join(' ');
        const startedAt = Date.now();
        const statements = await cost(() => manager.sendToGroup(groupId, { type: 'text', text }));
        const row = (await rows()).filter((r) => r.direction === 'outgoing' && r.timestamp >= startedAt - 1).at(-1);
        console.log(`SENT2 id=${row.messageId} at=${row.timestamp} status=${row.status} submissions=${statements}`);
      }
      if (command === 'SEND_HELD') {
        // Slow mode: the send is queued, not refused; nothing may go out while the interval runs.
        const text = rest.join(' ');
        const before = manager.submissions.snapshot().submissions;
        void manager.sendToGroup(groupId, { type: 'text', text }).catch((error) => console.log(`SEND_HELD_FAILED ${error.message}`));
        await delay(3_000);
        const row = await textRow(text);
        console.log(`HELD submissions=${manager.submissions.snapshot().submissions - before} status=${row?.status ?? 'none'}`);
      }
      if (command === 'FORGE') {
        // A modified client that skips its own slow-mode wait: one carrier sealed and signed by this
        // member directly, a second later than its last statement so the store takes it.
        const text = rest.join(' ');
        const group = await getGroup(groupId);
        const key = (await loadGroupKeys(groupId)).find((k) => k.epoch === group.epoch && !k.fork);
        const ep = deriveEpoch(key.key, groupId, group.epoch);
        const messageId = `forged-${Date.now()}`;
        const message = ChatMessageCodec.enc({ messageId, timestamp: BigInt(Date.now()), versioned: { tag: 'v1', value: { tag: 'text', value: text } } });
        const signer = hexOf(deviceKeys.statementAccountPublicKey);
        const sealed = await seal(ep.msgKey, { signer, epoch: ep.epoch, variant: VARIANT.messages, plaintext: encodeGroupMessages(saved.accountHex, [message]) });
        const result = await submitStatementOnce({
          statementStore: connection.adapter,
          prover: createSr25519Prover(deviceKeys.statementAccountSeed),
          allocator: createGroupExpiryAllocator(() => Date.now() + 1_000),
          channel: ep.channels.msgs,
          topics: [ep.topic],
          data: encodeGroupData({ tag: 'messages', value: sealed }),
        });
        if (result.isErr()) throw result.error;
        console.log(`FORGED id=${messageId}`);
      }
      if (command === 'EXPECT_HIDDEN') {
        // Long enough for the forged carrier to arrive and be judged (the subscription, then a sweep).
        await delay(8_000);
        const shown = await db.messages.get(rest[0]);
        console.log(shown ? `SHOWN id=${rest[0]}` : `HIDDEN id=${rest[0]}`);
      }
      if (command === 'WAIT_TEXT') {
        const text = rest.join(' ');
        const row = await waitFor(() => textRow(text), WAIT_MS);
        if (row) console.log(`GOT_TEXT id=${row.messageId} received=${Date.now()} text=${oneWord(text)}`);
      }
      if (command === 'WAIT_BOT') {
        const [botHex, since, ...words] = rest;
        const about = words.join(' ');
        const row = await waitFor(
          async () =>
            (await rows()).find(
              (r) => r.direction === 'incoming' && r.senderAccountId === botHex && r.timestamp >= Number(since) - 5_000 && !isLiveFrame(r.content) && (r.content.text ?? '').includes(about),
            ) ?? null,
          BOT_WAIT_MS,
        );
        if (row) console.log(`BOT_REPLY id=${row.messageId} text=${oneWord(row.content.text ?? '')}`);
      }
      if (command === 'INVITE') {
        let link = '';
        const statements = await cost(async () => {
          link = await manager.createGroupInvite(groupId);
        });
        const state = (await getGroup(groupId)).state;
        // The link is a join capability (no key) for this run's throwaway group; the parent hands it to b and does not echo it.
        console.log(`INVITE link=${link} policy=${state.joinPolicy} invites=${state.invites.length} statements=${statements}`);
      }
      if (command === 'JOIN') {
        const result = await manager.joinGroupByLink(rest[0]);
        groupId = result.groupId;
        const join = await db.groupJoins.get(groupId);
        console.log(`JOIN_SENT group=${groupId} status=${join?.status ?? 'none'} contact_before=${!!(await db.contacts.get(join?.admin ?? '0x'))}`);
      }
      if (command === 'WAIT_JOIN_REQUEST') {
        const group = await waitFor(async () => {
          const found = await getGroup(groupId);
          return found?.joinRequests?.some((r) => r.account === rest[0]) ? found : null;
        }, WAIT_MS);
        const contact = await db.contacts.get(rest[0]);
        if (group) console.log(`JOIN_QUEUED from=${group.joinRequests.find((r) => r.account === rest[0]).username} contact=${contact?.joinedVia ? 'auto-accepted' : 'none'}`);
      }
      if (command === 'WAIT_JOIN_STATUS') {
        const join = await waitFor(async () => {
          const found = await db.groupJoins.get(groupId);
          return found?.status === rest[0] ? found : null;
        }, WAIT_MS);
        if (join) console.log(`JOIN_STATUS ${join.status}`);
      }
      if (command === 'APPROVE') {
        const statements = await cost(() => manager.approveGroupJoin(groupId, rest[0]));
        console.log(`APPROVED submissions=${statements} members=${(await getGroup(groupId)).state.members.length}`);
      }
      if (command === 'WAIT_V2') {
        const group = await waitFor(async () => {
          const found = await getGroup(rest[0]);
          return found?.v === 2 && found.state && found.self === 'member' ? found : null;
        }, WAIT_MS);
        if (group) console.log(`JOINED2 id=${group.id} epoch=${group.epoch} version=${group.state.version} members=${group.members.map((m) => m.username).join(',')}`);
      }
      if (command === 'WAIT_HISTORY') {
        const ids = rest[0].split(',').filter(Boolean);
        const sharer = rest[1];
        const found = await waitFor(async () => {
          const all = await rows();
          const note = all.find((r) => r.content.type === 'groupEvent' && r.content.text === `History shared by ${sharer}`);
          return ids.every((id) => all.some((r) => r.messageId === id)) && note ? note : null;
        }, WAIT_MS);
        console.log(found ? `HISTORY ids=${ids.length} note=${oneWord(found.content.text)}` : `HISTORY_FAILED ids or the line missing`);
      }
      if (command === 'PIN') {
        const statements = await cost(() => manager.pinGroupMessage(groupId, rest[0], true));
        console.log(`PINNED submissions=${statements}`);
      }
      if (command === 'WAIT_PIN') {
        const group = await waitFor(async () => {
          const found = await getGroup(groupId);
          return found?.state?.pinned.includes(rest[0]) ? found : null;
        }, WAIT_MS);
        if (group) console.log(`PIN_SEEN pinned=${group.state.pinned.length}`);
      }
      if (command === 'WAIT_SLOW') {
        const group = await waitFor(async () => {
          const found = await getGroup(groupId);
          return found?.state?.slowModeSecs === Number(rest[0]) ? found : null;
        }, WAIT_MS);
        if (group) console.log(`SLOW_SEEN secs=${group.state.slowModeSecs}`);
      }
      if (command === 'PROMOTE') {
        const statements = await cost(() => manager.setGroupRole(groupId, rest[0], 1));
        console.log(`PROMOTED submissions=${statements}`);
      }
      if (command === 'WAIT_ROLE') {
        const member = await waitFor(async () => {
          const found = await me();
          return found?.role === Number(rest[0]) ? found : null;
        }, WAIT_MS);
        if (member) console.log(`ROLE role=${member.role === 1 ? 'admin' : member.role} flags=0x${member.permissions.toString(16)}`);
      }
      if (command === 'REMOVE2') {
        const statements = await cost(() => manager.removeGroupMember(groupId, rest[0]));
        const group = await getGroup(groupId);
        console.log(`REMOVED2 epoch=${group.epoch} submissions=${statements} members=${group.members.map((m) => m.username).join(',')}`);
      }
      if (command === 'WAIT_GONE') {
        const group = await waitFor(async () => {
          const found = await getGroup(groupId);
          return found?.state && !found.state.members.some((m) => m.account === rest[0]) ? found : null;
        }, WAIT_MS);
        if (group) console.log(`GONE epoch=${group.epoch} members=${group.state.members.length} signer=${group.stateSigner}`);
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
