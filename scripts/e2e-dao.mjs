#!/usr/bin/env node
// M14 e2e (DAO chat) on devnet: two people through this repo's domain code
// and main-process signer, and a throwaway pca DAO bot as the group's admin.
//   npm run e2e:dao -- [--profile devnet] [--identity-a pcdrevchibacbfcc] [--identity-b pcdbenchzzlx]
//                      [--pca <polkadot-chat-agents checkout with the M14 commit>] [--contract 0x…] [--voting 90]
//
// a and b are identities with room in their statement allowance (review M16:
// pcde2e and pcdeceb get AccountFull for any group statement; by M14 pcdbenchfinb and
// pcdbenchfina too). The bot is a
// NEW identity made for this run (`pca create <name> --brain echo --public`
// in a scratch PCA_BOTS_DIR), started with BOT_DAO_CONTRACT, stopped and its
// folder deleted at the end. Never a fleet bot. Funds come from the public dev
// accounts (//Alice first) through the pca checkout's own chain module: the bot (it
// signs setMembers and propose), a and b when they are low, and the group's
// treasury on the Dao contract.
//
// Each person is a child process (`--role a|b`, one Dexie over fake-indexeddb
// each; the Asset Hub signer is src/main/chain/assetHub.ts with the identity's
// key, as the app wires it). Markers:
//   GROUP_READY   a and b chat; a makes the v2 group with b and the bot and
//                 makes the bot an admin; a dev account funds the treasury
//   PROPOSED      a sends /propose; both hold the bot's proposal card, pinned
//   VOTED         a and b press "Vote yes" in the group room path: dry-run,
//                 sign, ONE statement (the reference on the group topic); the
//                 other member holds that reference; the card shows the
//                 bot's tally
//   CLOSED        after the deadline the card says passed; Execute and
//                 Withdraw stake arrive
//   EXECUTED      a presses Execute; b's free balance rises by the amount;
//                 the card says Executed
//   WITHDRAWN     b presses Withdraw stake; b's card says the stake is back
//   DAO_OK
// A step that times out prints `E2E_TIMEOUT <stage>`; the run ends
// DAO_INCOMPLETE and exit 13 when any step failed. 3 PEER_KEY_UNSUPPORTED;
// 1 any other failure. Prints no secret.

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
  const PAS = 10_000_000_000n;
  const AMOUNT = PAS / 5n;
  const VOTING_SECS = Number(flag('voting') ?? 90);
  const CONTRACT = flag('contract') ?? '0x073f0e29750b26286befd15619d24ee77e014d87';
  const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk'; // the public Substrate dev phrase, not a secret
  const pcaRoot = resolve(flag('pca') ?? join(root, '..', 'polkadot-chat-agents'));
  const pcaCli = join(pcaRoot, 'bot-core', 'cli.mjs');
  const pcaDao = join(pcaRoot, 'bot-core', 'lib', 'dao.mjs');
  if (!existsSync(pcaCli) || !existsSync(pcaDao)) {
    console.log(`NO_PCA_DAO ${pcaRoot} (pass --pca <a polkadot-chat-agents checkout with the M14 Dao bot>)`);
    process.exit(1);
  }
  const identities = { a: flag('identity-a') ?? 'pcdrevchibacbfcc', b: flag('identity-b') ?? 'pcdbenchzzlx' };
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

  // ── Funds: the pca checkout's chain module and the public dev accounts ──
  const revive = await import(pathToFileURL(join(pcaRoot, 'bot-core', 'lib', 'revive-chain.mjs')).href);
  const { deriveSr25519PairFromMnemonic } = await import(pathToFileURL(join(pcaRoot, 'bot-core', 'vendor', 'lib', 'wallet-keys.mjs')).href);
  const chain = revive.createReviveChain({ endpoints: ['wss://asset-hub-paseo-rpc.n.dwellir.com', 'wss://sys.turboflakes.io/asset-hub-paseo'] });
  const pas = (plancks) => `${(Number(plancks) / Number(PAS)).toFixed(4)} PAS`;
  // Other agents sign with the same dev accounts (a nonce race drops a
  // transfer): each funding tries //Alice, then the next dev account.
  const devs = ['//Alice', '//Bob', '//Charlie', '//Dave', '//Eve', '//Ferdie'].map((path) => ({ path, pair: deriveSr25519PairFromMnemonic(DEV_PHRASE, path) }));
  const fromDev = async (what, submit) => {
    for (const dev of devs) {
      try {
        const res = await submit(dev.pair);
        if (res.ok) return { ...res, from: dev.path };
        console.log(`FUND_RETRY ${what} ${dev.path}: ${res.error}`);
      } catch (error) {
        console.log(`FUND_RETRY ${what} ${dev.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ok: false, error: 'every dev account failed' };
  };
  for (const name of ['a', 'b']) {
    const free = await chain.freeBalance(who[name].accountHex);
    if (free >= PAS / 2n) continue;
    const res = await fromDev(name, (pair) => chain.transfer(pair, { to: who[name].accountHex, amount: PAS }));
    console.log(`FUND ${name} had ${pas(free)}: ${res.ok ? `+1 PAS from ${res.from} block=${res.block}` : `failed ${res.error}`}`);
  }

  // ── The scratch DAO bot ──
  const botsDir = mkdtempSync(join(tmpdir(), 'pcd-e2e-dao-bots-'));
  const botName = `pcddao${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir, PCA_NO_UPDATE_CHECK: '1' };
  // --public as pca's own e2e-dao: a private bot's `create` also provisions a Bulletin file
  // allowance, which hung for 6 minutes in the first run; this bot sends no files.
  console.log(`BOT_CREATE ${botName} (scratch PCA_BOTS_DIR, brain echo, public) at=${at()}`);
  let created = spawnSync(process.execPath, [pcaCli, 'create', botName, '--brain', 'echo', '--public', '--network', profile, '--wait', '180'], {
    cwd: pcaRoot,
    env: pcaEnv,
    encoding: 'utf8',
    timeout: 6 * 60_000,
  });
  const botConfigFile = join(botsDir, botName, 'config.json');
  const readBotConfig = () => (existsSync(botConfigFile) ? JSON.parse(readFileSync(botConfigFile, 'utf8')) : null);
  // The backend's attestation took 22 min on 2026-09-24, and one long wait died with
  // its socket: ask again (`pca register`, a fresh connection each time) for up to 30 min.
  const registerUntil = Date.now() + 30 * 60_000;
  while (created.status === 0 && readBotConfig() && !readBotConfig().registered && Date.now() < registerUntil) {
    console.log(`BOT_UNCONFIRMED ${botName} asks again at=${at()}`);
    created = spawnSync(process.execPath, [pcaCli, 'register', botName, '--wait', '180'], { cwd: pcaRoot, env: pcaEnv, encoding: 'utf8', timeout: 6 * 60_000 });
  }
  const botConfig = readBotConfig();
  if (created.status !== 0 || !botConfig?.registered) {
    console.log(`BOT_CREATE_FAILED status=${created.status} registered=${botConfig?.registered ?? 'no config'}`);
    for (const line of `${created.stdout ?? ''}${created.stderr ?? ''}`.trim().split('\n').slice(-8)) console.log(`[pca] ${line}`);
    rmSync(botsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    chain.destroy();
    process.exit(1);
  }
  const bot = { username: botConfig.username, accountHex: `0x${String(botConfig.account).replace(/^0x/, '')}` };
  console.log(`BOT_REGISTERED ${bot.username} ${bot.accountHex} at=${at()}`);
  const botFund = await fromDev('the bot', (pair) => chain.transfer(pair, { to: bot.accountHex, amount: 2n * PAS }));
  if (!botFund.ok) console.log(`BOT_FUND_FAILED ${botFund.error}`);
  else console.log(`BOT_FUNDED 2 PAS from ${botFund.from} block=${botFund.block}`);
  // The bot's first statement fails `noAllowance` until the identity backend's
  // attestation writes `:statement_allowance:<account>` (efficiency.md
  // "Allowance facts"; seen taking over 6 min on 2026-09-24): wait for it at the best head.
  {
    const { NETWORK_PROFILES } = await import(pathToFileURL(join(root, 'src/renderer/app/network.ts')).href);
    const { createClient } = await import('polkadot-api');
    const { getWsProvider } = await import('polkadot-api/ws');
    const people = createClient(getWsProvider([...NETWORK_PROFILES[profile].peopleEndpoints]));
    const key = `0x${Buffer.from(':statement_allowance:').toString('hex')}${bot.accountHex.slice(2)}`;
    const until = Date.now() + 15 * 60_000;
    let allowance = null;
    while (Date.now() < until) {
      allowance = await people._request('state_getStorage', [key]).catch(() => null);
      if (allowance) break;
      await delay(5_000);
    }
    people.destroy();
    console.log(allowance ? `BOT_ALLOWANCE ${allowance} at=${at()}` : `BOT_ALLOWANCE_MISSING after 15 min at=${at()}`);
  }
  const botProc = spawn(process.execPath, [pcaCli, 'run', botName], {
    cwd: pcaRoot,
    env: { ...pcaEnv, BOT_DAO_CONTRACT: CONTRACT, BOT_DAO_VOTING_SECS: String(VOTING_SECS) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const botLines = [];
  const botWaiters = [];
  const onBotLine = (line) => {
    botLines.push(line);
    if (/BOT_DAO_|BOT_STARTING|_FAILED|ERROR/.test(line)) console.log(`[bot] ${line.slice(0, 220)}`);
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

  const people = {};
  let failing = false;
  const problems = [];
  const stopAll = () => {
    for (const person of Object.values(people)) if (person.proc.exitCode === null) person.proc.kill('SIGTERM');
    if (botProc.exitCode === null) {
      try {
        process.kill(-botProc.pid, 'SIGTERM');
      } catch {
        botProc.kill('SIGTERM');
      }
    }
    rmSync(botsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    try {
      chain.destroy();
    } catch {
      // closing
    }
  };
  const fail = (code, line) => {
    if (failing) return;
    failing = true;
    console.log(line);
    for (const botLine of botLines.filter((l) => /BOT_DAO_/.test(l)).slice(-6)) console.log(`[bot] ${botLine.slice(0, 260)}`);
    stopAll();
    setTimeout(() => process.exit(code), 1_500);
  };
  process.on('SIGINT', () => fail(130, 'INTERRUPTED'));

  if (!(await expectBot(/BOT_DAO_WATCHING/, 120_000))) return fail(13, 'E2E_TIMEOUT the scratch DAO bot watches the contract');

  for (const name of ['a', 'b']) {
    const other = name === 'a' ? 'b' : 'a';
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--role', name, '--identity', identities[name], '--other', who[other].accountHex, '--profile', profile], {
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
  const field = (line, key) => line?.match(new RegExp(`\\b${key}=("(?:[^"\\\\]|\\\\.)*"|\\S+)`))?.[1]?.replace(/^"|"$/g, '') ?? null;
  const ask = async (name, command, pattern, timeoutMs = STEP_WAIT_MS) => {
    const from = people[name].lines.length;
    send(name, command);
    return expectLine(name, pattern, timeoutMs, from);
  };
  const failed = (entry) => !entry || /_FAILED /.test(entry.line);
  const problem = (stage) => {
    problems.push(stage);
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
  console.log(`PEOPLE a=${who.a.username} (${field(ready[0].line, 'free')}) b=${who.b.username} (${field(ready[1].line, 'free')}) bot=${bot.username} at=${at()}`);

  // ── 0. The group: a and b chat, a makes the group with b and the bot, the bot becomes an admin.
  const request = await ask('a', 'REQUEST_OTHER', /^REQUEST_SENT |_FAILED /);
  if (failed(request)) return fail(request ? 1 : 13, request?.line ?? 'E2E_TIMEOUT a asks b');
  const accepted = await ask('b', `ACCEPT ${field(request.line, 'id')}`, /^ACCEPTED |_FAILED /);
  if (failed(accepted)) return fail(accepted ? 1 : 13, accepted?.line ?? 'E2E_TIMEOUT b accepts');
  if (!(await ask('a', 'WAIT_CONTACT', /^CONTACT /))) return fail(13, 'E2E_TIMEOUT a learns the accept');
  const botContact = await ask('a', `OPEN_BOT ${bot.accountHex}`, /^BOT_CONTACT |_FAILED /, BOT_WAIT_MS);
  if (failed(botContact)) return fail(botContact ? 1 : 13, botContact?.line ?? 'E2E_TIMEOUT the bot accepts a');
  const botFrom = botLines.length;
  const create = await ask('a', `CREATE2 ${who.b.accountHex} ${who.b.username} ${bot.accountHex} ${bot.username}`, /^GROUP2_CREATED |_FAILED /);
  if (failed(create)) return fail(create ? 1 : 13, create?.line ?? 'E2E_TIMEOUT create');
  const groupId = field(create.line, 'id');
  const [bJoined, botJoined] = await Promise.all([ask('b', `WAIT_V2 ${groupId}`, /^JOINED2 /), expectBot(/BOT_GROUP2_JOINED/, BOT_WAIT_MS, botFrom)]);
  if (!bJoined || !botJoined) return fail(13, `E2E_TIMEOUT the group reaches b (${!!bJoined}) and the bot (${!!botJoined})`);
  const promote = await ask('a', `PROMOTE ${bot.accountHex}`, /^PROMOTED |_FAILED /);
  if (failed(promote)) return fail(promote ? 1 : 13, promote?.line ?? 'E2E_TIMEOUT a makes the bot an admin');
  const treasury = await fromDev('the treasury', (pair) => chain.callContract(pair, { dest: CONTRACT, calldata: revive.daoCalldata.fund(revive.daoGroupKey(groupId)), value: PAS / 2n }));
  if (!treasury.ok) return fail(1, `TREASURY_FAILED ${treasury.error}`);
  console.log(`GROUP_READY group=${groupId} bot admin (${field(promote.line, 'submissions')} statement) treasury +0.5 PAS from ${treasury.from} block=${treasury.block} at=${at()}`);

  // ── 1. /propose: both hold the card, pinned.
  const proposeText = `/propose M14 desktop e2e | 0.2 PAS to ${who.b.username}`;
  const proposeSent = await ask('a', `SEND2 ${proposeText}`, /^SENT2 |_FAILED /);
  if (failed(proposeSent)) return fail(proposeSent ? 1 : 13, proposeSent?.line ?? 'E2E_TIMEOUT a sends /propose');
  const cards = await Promise.all(['a', 'b'].map((name) => ask(name, `WAIT_PROPOSAL ${bot.accountHex}`, /^PROPOSAL |_FAILED /, BOT_WAIT_MS)));
  if (cards.some(failed)) return fail(13, `E2E_TIMEOUT the proposal card (a=${cards[0]?.line ?? 'none'} b=${cards[1]?.line ?? 'none'})`);
  const proposalId = field(cards[0].line, 'message');
  const number = field(cards[0].line, 'num');
  console.log(`PROPOSED #${number} card on both, pinned (a ${field(cards[0].line, 'pinned')}, b ${field(cards[1].line, 'pinned')}), closes in ${field(cards[0].line, 'left')} at=${at()}`);
  if (field(cards[0].line, 'pinned') !== 'true' || field(cards[1].line, 'pinned') !== 'true') problem('the proposal is pinned for both');

  // ── 2. Votes: the tx button pressed in the group room path.
  for (const [k, [voter, other]] of [['a', 'b'], ['b', 'a']].entries()) {
    const pressed = await ask(voter, `PRESS ${proposalId} Vote yes (stake 0.1 PAS)`, /^PRESSED |_FAILED /, STEP_WAIT_MS);
    if (failed(pressed)) {
      problem(`${voter} votes (${pressed?.line ?? 'no answer'})`);
      continue;
    }
    const [seen, tally] = await Promise.all([
      ask(other, `WAIT_REF ${who[voter].accountHex} ${field(pressed.line, 'hash')}`, /^REF_SEEN /),
      // The bot's tally line counts this vote: "yes … (1 vote)", then "(2 votes)".
      ask(voter, `WAIT_CARD ${proposalId} (${k + 1} vote`, /^CARD /, BOT_WAIT_MS),
    ]);
    if (!seen || !tally) problem(`${voter}'s vote reaches ${other} (${!!seen}) and the bot's tally (${!!tally})`);
    else if (field(pressed.line, 'statements') !== '1') problem(`${voter}'s vote cost ${field(pressed.line, 'statements')} statements, not 1`);
    else
      console.log(
        `VOTED ${voter} yes block=${field(pressed.line, 'block')} caps=${field(pressed.line, 'caps')} statements=1; ${other} holds the reference from ${voter}; card: "${field(tally.line, 'tally')}" mine=${field(tally.line, 'mine')} at=${at()}`,
      );
  }

  // ── 3. The deadline: the bot's result.
  const closed = await ask('a', `WAIT_PHASE ${proposalId} passed`, /^CARD |_FAILED /, (VOTING_SECS + 120) * 1000);
  if (!closed) {
    problem('the result after the deadline');
    return end(`DAO_INCOMPLETE ${problems.length} step(s) failed: ${problems.join('; ')}`, 13);
  }
  console.log(`CLOSED card phase=${field(closed.line, 'phase')} tally="${field(closed.line, 'tally')}" at=${at()}`);

  // ── 4. Execute: b is paid.
  const before = await chain.freeBalance(who.b.accountHex);
  const execute = await ask('a', `PRESS latest Execute`, /^PRESSED |_FAILED /, STEP_WAIT_MS);
  if (failed(execute)) problem(`a executes (${execute?.line ?? 'no answer'})`);
  else {
    const after = await chain.freeBalance(who.b.accountHex);
    const executed = await ask('b', `WAIT_PHASE ${proposalId} executed`, /^CARD |_FAILED /, BOT_WAIT_MS);
    if (after - before !== AMOUNT) problem(`b's balance moved ${pas(after - before)}, not ${pas(AMOUNT)}`);
    else if (!executed) problem("b's card says Executed");
    else console.log(`EXECUTED by a block=${field(execute.line, 'block')}; b +${pas(after - before)}; b's card: ${field(executed.line, 'phase')} at=${at()}`);
  }

  // ── 5. b withdraws its stake.
  const withdraw = await ask('b', `PRESS latest Withdraw stake`, /^PRESSED |_FAILED /, STEP_WAIT_MS);
  if (failed(withdraw)) problem(`b withdraws (${withdraw?.line ?? 'no answer'})`);
  else {
    const card = await ask('b', `CARD ${proposalId}`, /^CARD /);
    if (field(card?.line, 'withdrawn') !== 'true') problem(`b's card does not say the stake is back (${card?.line ?? 'none'})`);
    else console.log(`WITHDRAWN b block=${field(withdraw.line, 'block')}; card mine="${field(card.line, 'mine')}" at=${at()}`);
  }

  if (problems.length > 0) return end(`DAO_INCOMPLETE ${problems.length} step(s) failed: ${problems.join('; ')}`, 13);
  end(`DAO_OK at=${at()}`, 0);
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
  const IN_BLOCK_WAIT_MS = 90_000;
  const identityName = flag('identity');
  const otherHex = flag('other');
  const hexOf = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
  const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  const quoted = (text) => JSON.stringify(String(text ?? '').replace(/\s+/g, ' ').slice(0, 120));
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
  const { mineLine, proposalHead, proposalPhase, proposalViews, timeLeft } = await load('src/renderer/domain/chat/proposals.ts');
  const { createTxRunner, referenceNote } = await load('src/renderer/domain/chain/transactions.ts');
  const { openAssetHub, createTxService } = await load('src/main/chain/assetHub.ts');
  const { decodeTxIntent, formatUnits } = await load('src/shared/txIntent.ts');

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
    chain = await openAssetHub(profile);
  } catch (error) {
    finish(1, `CHAIN_CONNECT_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  service = createTxService(chain, { publicKey: selfKeys.accountId, sign: selfKeys.sign });
  await seedSelfIdentity(
    { statementSeed: selfKeys.walletSecret64, chatPrivateKey: selfKeys.chatPrivateKey, deviceEncryptionPrivateKey: selfKeys.deviceEncryptionPrivateKey },
    selfKeys.accountId,
  );
  const [identity, deviceKeys] = await Promise.all([readUserIdentity(), getDeviceKeys()]);
  if (!identity) finish(1, 'SEED_FAIL no identity row after seeding');
  const lookup = createIdentityLookup(connection);
  manager = await createChatManager({ identity, deviceKeys, statementStore: connection.adapter, lookup, onConnectionStatus: connection.onStatus, username: saved.username });
  // As App.tsx wires it: the renderer's runner over the main process's signer.
  runner = createTxRunner({ chain: { sign: service.sign, onTxStatus: service.onStatus }, sendReference: manager.sendReference, recordReference: manager.recordReference });
  console.log(`READY username=${saved.username} free=${formatUnits(BigInt((await service.balance()).free))}PAS`);

  let groupId = null;
  const peerOf = async (accountHex, label) => {
    const peer = await lookup.getPeerIdentity(bytesOf(accountHex));
    if (!peer) finish(3, `PEER_KEY_UNSUPPORTED ${label}`);
    return peer;
  };
  const rows = () => listMessages(groupPeerOf(groupId));
  const cardLine = async (messageId) => {
    const view = proposalViews(await rows()).get(messageId);
    if (!view) return null;
    return `CARD phase=${proposalPhase(view, Date.now())} tally=${quoted(view.tally ?? '')} mine=${quoted(mineLine(view) ?? '')} withdrawn=${view.withdrawn}`;
  };

  const commands = createInterface({ input: process.stdin });
  for await (const line of commands) {
    const [command, ...rest] = line.trim().split(/\s+/);
    try {
      if (command === 'EXIT') finish(0, 'EXIT');
      if (command === 'REQUEST_OTHER') {
        await manager.sendRequest(await peerOf(otherHex, 'other person'), 'M14 DAO e2e');
        const request = (await db.requests.toArray()).filter((row) => row.direction === 'outgoing' && row.peerAccountId === otherHex).sort((x, y) => y.createdAt - x.createdAt)[0];
        console.log(`REQUEST_SENT id=${request.requestId}`);
      }
      if (command === 'ACCEPT') {
        const request = await waitFor(() => db.requests.get(rest[0]), WAIT_MS);
        if (!request) console.log(`ACCEPT_FAILED no request ${rest[0]} arrived`);
        else {
          await manager.acceptRequest(rest[0]);
          console.log(`ACCEPTED ${request.peerUsername}`);
        }
      }
      if (command === 'WAIT_CONTACT') {
        const contact = await waitFor(() => db.contacts.get(otherHex), WAIT_MS);
        if (contact) console.log(`CONTACT ${contact.username}`);
      }
      if (command === 'OPEN_BOT') {
        await manager.sendRequest(await peerOf(rest[0], 'the scratch bot'), null);
        const contact = await waitFor(() => db.contacts.get(rest[0]), BOT_WAIT_MS);
        console.log(contact ? `BOT_CONTACT ${contact.username}` : `OPEN_BOT_FAILED the bot did not accept in ${BOT_WAIT_MS / 1000} s`);
      }
      if (command === 'CREATE2') {
        const [bHex, bName, botHex, botName] = rest;
        groupId = await manager.createGroup(`M14 DAO ${new Date().toISOString().slice(11, 19)}`, [
          { account: bHex, username: bName },
          { account: botHex, username: botName },
        ]);
        console.log(`GROUP2_CREATED id=${groupId}`);
      }
      if (command === 'WAIT_V2') {
        const group = await waitFor(async () => {
          const found = await getGroup(rest[0]);
          return found?.v === 2 && found.state && found.self === 'member' ? found : null;
        }, WAIT_MS);
        if (group) {
          groupId = group.id;
          console.log(`JOINED2 id=${group.id} epoch=${group.epoch}`);
        }
      }
      if (command === 'PROMOTE') {
        const before = manager.submissions.snapshot().submissions;
        await manager.setGroupRole(groupId, rest[0], 1);
        console.log(`PROMOTED submissions=${manager.submissions.snapshot().submissions - before}`);
      }
      if (command === 'SEND2') {
        await manager.sendToGroup(groupId, { type: 'text', text: rest.join(' ') });
        console.log('SENT2 ok');
      }
      if (command === 'WAIT_PROPOSAL') {
        const botHex = rest[0];
        const found = await waitFor(async () => {
          const row = (await rows()).find((r) => r.senderAccountId === botHex && proposalHead(r));
          const pinned = row ? (await getGroup(groupId))?.state?.pinned.includes(row.messageId) : false;
          return row && pinned ? row : null;
        }, WAIT_MS * 2);
        if (!found) console.log('WAIT_PROPOSAL_FAILED no pinned proposal from the bot');
        else {
          const head = proposalHead(found);
          console.log(`PROPOSAL message=${found.messageId} num=${head.id} pinned=true left=${quoted(timeLeft((head.deadline ?? 0) - Date.now()))}`);
        }
      }
      if (command === 'PRESS') {
        // The group room's press of a `tx` button (GroupRoom.tsx): dry-run, then sign, reference to the group.
        const [target, ...words] = rest;
        const label = words.join(' ');
        const all = await rows();
        const row =
          target === 'latest'
            ? [...all].reverse().find((r) => r.direction === 'incoming' && r.content.type === 'buttons' && r.content.rows.flat().some((b) => b.label === label))
            : all.find((r) => r.messageId === target);
        const position = (() => {
          for (const [r, buttons] of (row?.content.rows ?? []).entries()) for (const [i, button] of buttons.entries()) if (button.label === label && button.action.kind === 'tx') return { r, i, button };
          return null;
        })();
        if (!position) {
          console.log(`PRESS_FAILED no "${label}" tx button`);
          continue;
        }
        const intent = decodeTxIntent(position.button.action.intent);
        const dryRun = await service.dryRun(position.button.action.intent);
        const caps = dryRun.caps ? `deposit:${formatUnits(BigInt(dryRun.caps.deposit))},gas:x${dryRun.caps.gasFactor}` : '-';
        if (!dryRun.ok) {
          console.log(`PRESS_FAILED dry-run refused: ${dryRun.error}`);
          continue;
        }
        const peer = groupPeerOf(groupId);
        const before = manager.submissions.snapshot().submissions;
        const hash = await runner.run({ peer, dryRunId: dryRun.id, chainId: intent.chainId, note: referenceNote(intent.display), intentMessageId: row.messageId });
        await manager.pressButton(peer, row.messageId, position.r, position.i);
        const own = await waitFor(async () => {
          const ref = (await rows()).find((r) => r.direction === 'outgoing' && r.content.type === 'transactionReference' && r.content.reference.hash === hash);
          const status = ref?.content.reference.status;
          return (status === 'inBlock' || status === 'finalized' || status === 'failed') && ref.status !== 'sending' ? ref : null;
        }, IN_BLOCK_WAIT_MS);
        if (!own) console.log(`PRESS_FAILED "${label}" not in a block in ${IN_BLOCK_WAIT_MS / 1000} s`);
        else if (own.content.reference.status === 'failed') console.log(`PRESS_FAILED "${label}" ${own.content.reference.error ?? 'the chain refused it'}`);
        else console.log(`PRESSED label=${quoted(label)} hash=${hash} block=${own.content.reference.block} caps=${caps} statements=${manager.submissions.snapshot().submissions - before}`);
      }
      if (command === 'WAIT_REF') {
        const [fromHex, hash] = rest;
        const ref = await waitFor(
          async () => (await rows()).find((r) => r.direction === 'incoming' && r.senderAccountId === fromHex && r.content.type === 'transactionReference' && r.content.reference.hash === hash) ?? null,
          WAIT_MS,
        );
        if (ref) console.log(`REF_SEEN note=${quoted(ref.content.reference.note)} status=${ref.content.reference.status}`);
      }
      if (command === 'WAIT_CARD') {
        const [messageId, ...words] = rest;
        const text = words.join(' ');
        const found = await waitFor(async () => !!proposalViews(await rows()).get(messageId)?.tally?.includes(text), WAIT_MS * 2);
        if (found) console.log(await cardLine(messageId));
      }
      if (command === 'WAIT_PHASE') {
        const [messageId, phase] = rest;
        const found = await waitFor(async () => {
          const view = proposalViews(await rows()).get(messageId);
          return view && proposalPhase(view, Date.now()) === phase;
        }, 4 * WAIT_MS);
        if (found) console.log(await cardLine(messageId));
        else console.log(`WAIT_PHASE_FAILED ${(await cardLine(messageId)) ?? 'no card'}`);
      }
      if (command === 'CARD') {
        const line = await waitFor(async () => {
          const card = await cardLine(rest[0]);
          return card?.includes('withdrawn=true') ? card : null;
        }, 20_000);
        console.log(line ?? (await cardLine(rest[0])) ?? 'CARD none');
      }
    } catch (error) {
      console.log(`${command}_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
