#!/usr/bin/env node
// The e2e identity pool (owner ask 2026-09-24). A devnet identity takes 1–30+
// min to be attested, so runs keep identities ready under `.agent-runs/pool/`:
//   pool/index.json               one entry per identity: name, username,
//                                 accountHex, registeredAt (claimed),
//                                 attestedAt (first seen at the best block, or
//                                 null), usedAt, slotsUsedEstimate
//   pool/identity-<name>/identity.json   the identity file (mode 0600)
// `takeIdentity()` hands out an unused one at once (never waits on the
// backend) and links `.agent-runs/identity-<name>` to it, where every script
// reads `--identity <name>`. It takes only one whose `Resources.Consumers`
// entry is at the best block now, so a claim the backend attests late is used
// as soon as it lands. An identity whose `usedAt` is 14 days old is unused
// again: its statements have expired. `refillPool(n)` claims n new ones in
// parallel and watches every pending claim. The group scripts take from the
// pool first, register live only when it has nothing attested, and start a
// background refill when they exit.
//   node scripts/lib/identityPool.mjs refill <n>   top up to n unused, attested or pending (npm run pool:refill)
//   node scripts/lib/identityPool.mjs status
// Prints no secret.

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { root } from './app.mjs';
import { attestedNow, claimIdentity, fundIdentity } from './freshIdentity.mjs';

const RUNS = join(root, '.agent-runs');
const POOL = join(RUNS, 'pool');
const INDEX = join(POOL, 'index.json');
const LOCK = join(POOL, 'index.lock');
const REFILL_LOCK = join(POOL, 'refill.lock');
const REFILL_LOG = join(POOL, 'refill.log');
/** Chat statements expire after 14 days; then the allowance is free again. */
const REUSE_AFTER_MS = 14 * 24 * 60 * 60_000;
/** A rough count of live statements one group run leaves: two DM peers (2 each) and two groups (up to 3 each). */
const RUN_SLOTS = 10;
const POOL_PREFIX = 'pcdpool';
const BACKGROUND_TARGET = 4;
const REFILL_BUDGET_MS = 30 * 60_000;
/** A claim not attested in an hour no longer counts toward the refill target (it may still land and be taken). */
const PENDING_MAX_MS = 60 * 60_000;
const WATCH_MS = 10_000;

const delay = ms => new Promise(done => setTimeout(done, ms));
const message = error => (error instanceof Error ? error.message : String(error));

const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : []);
const writeIndex = entries => {
  writeFileSync(`${INDEX}.tmp`, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(`${INDEX}.tmp`, INDEX);
};

/** One writer at a time: two runs that take at once must not get the same identity. */
const withIndex = async fn => {
  mkdirSync(POOL, { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      closeSync(openSync(LOCK, 'wx'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // A lock older than 30 s belongs to a process that died holding it.
      if (Date.now() - statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs > 30_000) rmSync(LOCK, { force: true });
      await delay(50 + Math.random() * 100);
    }
  }
  try {
    const entries = readIndex();
    const result = await fn(entries);
    writeIndex(entries);
    return result;
  } finally {
    rmSync(LOCK, { force: true });
  }
};

const unused = (entry, now) => entry.usedAt === null || now - entry.usedAt >= REUSE_AFTER_MS;

/**
 * An unused pool identity, marked used now, or null when the pool has none.
 * Only one whose `Resources.Consumers` entry is at the best block now: on
 * 2026-09-24 attested devnet identities vanished from the chain for a while
 * and came back. One read per candidate, never a wait on the backend. Links
 * `.agent-runs/identity-<name>` to its file so `--identity <name>` finds it.
 */
export async function takeIdentity(slots = RUN_SLOTS, { profile = 'devnet', log = line => console.log(line) } = {}) {
  const order = (x, y) => (x.attestedAt === null) - (y.attestedAt === null) || (x.usedAt ?? 0) - (y.usedAt ?? 0) || x.registeredAt - y.registeredAt;
  const candidates = readIndex()
    .filter(e => unused(e, Date.now()))
    .sort(order);
  if (candidates.length === 0) return null;
  const onChain = await attestedNow(candidates.map(e => e.accountHex), { profile }).catch(() => new Set());
  for (const candidate of candidates) {
    if (!onChain.has(candidate.accountHex)) {
      if (candidate.attestedAt !== null) log(`POOL_SKIP ${candidate.username} not at the best block now`);
      continue;
    }
    const taken = await withIndex(entries => {
      const entry = entries.find(e => e.name === candidate.name);
      const now = Date.now();
      // Another run may have taken it since the read above.
      if (!entry || !unused(entry, now)) return null;
      entry.attestedAt ??= now;
      // Past 14 days the old statements are gone: the estimate starts again.
      entry.slotsUsedEstimate = (entry.usedAt === null ? entry.slotsUsedEstimate : 0) + slots;
      entry.usedAt = now;
      return { ...entry };
    });
    if (!taken) continue;
    const link = join(RUNS, `identity-${taken.name}`);
    if (!existsSync(link)) symlinkSync(relative(RUNS, join(POOL, `identity-${taken.name}`)), link);
    return taken;
  }
  return null;
}

/** Identity folders in the pool that the index does not list (a refill that died): listed as pending claims. */
const adoptOrphans = () =>
  withIndex(entries => {
    const known = new Set(entries.map(e => e.name));
    for (const folder of readdirSync(POOL).filter(f => f.startsWith('identity-'))) {
      const name = folder.slice('identity-'.length);
      const file = join(POOL, folder, 'identity.json');
      if (known.has(name) || !existsSync(file)) continue;
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      entries.push({ name, username: saved.username, accountHex: saved.accountHex, registeredAt: statSync(file).mtimeMs, attestedAt: null, usedAt: null, slotsUsedEstimate: 0 });
    }
  });

/** One new claim, listed in the pool at once as pending. */
const claimIntoPool = async profile => {
  const claim = await claimIdentity(POOL_PREFIX, { profile, dir: POOL });
  await withIndex(entries => {
    entries.push({ ...claim, registeredAt: Date.now(), attestedAt: null, usedAt: null, slotsUsedEstimate: 0 });
  });
  return claim;
};

/**
 * Claims `n` new identities in parallel into the pool (each listed at once as
 * pending), then watches every pending claim in the pool, old ones too, until
 * the n new ones are attested or 30 min have passed. Logs each attestation
 * with its time since the claim.
 */
export async function refillPool(n, { profile = 'devnet', budgetMs = REFILL_BUDGET_MS, log = line => console.log(line) } = {}) {
  const started = Date.now();
  await adoptOrphans();
  const results = await Promise.allSettled(Array.from({ length: n }, () => claimIntoPool(profile)));
  const claimed = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  for (const r of results) if (r.status === 'rejected') log(`POOL_CLAIM_FAILED ${message(r.reason)}`);
  log(`POOL_CLAIMED ${claimed.length}/${n} in=${((Date.now() - started) / 1000).toFixed(1)}s`);
  const mine = new Set(claimed.map(c => c.accountHex));
  const times = [];
  while (Date.now() - started < budgetMs) {
    const pending = readIndex().filter(e => e.attestedAt === null && Date.now() - e.registeredAt < PENDING_MAX_MS);
    if (pending.length === 0) break;
    const onChain = await attestedNow(pending.map(e => e.accountHex), { profile }).catch(() => new Set());
    await withIndex(entries => {
      const now = Date.now();
      for (const entry of entries) {
        if (entry.attestedAt !== null || !onChain.has(entry.accountHex)) continue;
        entry.attestedAt = now;
        if (mine.has(entry.accountHex)) times.push(now - entry.registeredAt);
        log(`POOL_ATTESTED ${entry.username} after=${((now - entry.registeredAt) / 1000).toFixed(0)}s${mine.has(entry.accountHex) ? '' : ' (an older claim)'}`);
      }
    });
    if (n > 0 && times.length >= claimed.length) break;
    await delay(WATCH_MS);
  }
  const sum = times.reduce((a, b) => a + b, 0);
  log(`POOL_REFILLED claimed=${claimed.length} attested=${times.length} wall=${((Date.now() - started) / 1000).toFixed(1)}s sum_of_each=${(sum / 1000).toFixed(1)}s`);
  return times.length;
}

export const poolStatus = () => {
  const now = Date.now();
  const free = readIndex().filter(e => unused(e, now));
  const ready = free.filter(e => e.attestedAt !== null).length;
  const pending = free.filter(e => e.attestedAt === null && now - e.registeredAt < PENDING_MAX_MS).length;
  return { total: readIndex().length, ready, pending };
};

/** A detached `refill <target>` that outlives the caller; skipped while another refill runs. */
export const refillInBackground = (target = BACKGROUND_TARGET) => {
  mkdirSync(POOL, { recursive: true, mode: 0o700 });
  const out = openSync(REFILL_LOG, 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'refill', String(target)], { cwd: root, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  closeSync(out);
};

/**
 * A pool identity at once; when none is attested, one new claim goes into the
 * pool (a live registration) and the first pool identity attested after that
 * is taken: ours, or an older claim that lands first. Up to 30 min.
 */
async function obtainIdentity(profile) {
  const pooled = await takeIdentity(RUN_SLOTS, { profile });
  if (pooled) return { ...pooled, from: 'pool' };
  const started = Date.now();
  await claimIntoPool(profile).then(
    claim => console.log(`IDENTITY_CLAIMED ${claim.username} (the pool had none attested)`),
    error => console.log(`IDENTITY_CLAIM_FAILED ${message(error)}`),
  );
  while (Date.now() - started < REFILL_BUDGET_MS) {
    await delay(WATCH_MS);
    const taken = await takeIdentity(RUN_SLOTS, { profile, log: () => undefined });
    if (taken) return { ...taken, from: 'live', ms: Date.now() - started };
  }
  throw new Error(`no pool identity attested in ${REFILL_BUDGET_MS / 60_000} min`);
}

/**
 * The two people of a group e2e run: `--identity-a` / `--identity-b` when
 * given (reused as they are), else one from the pool each, else a live
 * registration through the pool (`obtainIdentity`; both at the same time). `fundPas` > 0 funds each new one.
 * Prints `IDENTITY_FRESH a=<username> b=<username> from=pool|live|given`.
 * When the process exits, a background refill tops the pool up to 4.
 * Exits 1 with `IDENTITY_FAILED` when a live registration runs out of time.
 */
export async function groupIdentities(flag, { profile = 'devnet', fundPas = 0 } = {}) {
  const given = { a: flag('identity-a') ?? null, b: flag('identity-b') ?? null };
  process.once('exit', () => refillInBackground());
  const started = Date.now();
  try {
    const got = await Promise.all(
      ['a', 'b'].map(async role => {
        if (given[role]) return { name: given[role], username: `${given[role]}(given)`, from: 'given' };
        const identity = await obtainIdentity(profile);
        if (fundPas > 0) {
          const funded = await fundIdentity(identity.accountHex, fundPas, { profile });
          console.log(`IDENTITY_FUNDED ${role}=${identity.username} +${fundPas} PAS from=${funded.from} block=#${funded.block}`);
        }
        return identity;
      }),
    );
    const [a, b] = got;
    console.log(`IDENTITY_FRESH a=${a.username} b=${b.username} from=${a.from},${b.from} in=${((Date.now() - started) / 1000).toFixed(1)}s pool=${JSON.stringify(poolStatus())}`);
    return { a: a.name, b: b.name };
  } catch (error) {
    console.log(`IDENTITY_FAILED ${message(error)}`);
    process.exit(1);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, count] = process.argv.slice(2);
  if (command === 'status') {
    console.log(`POOL ${JSON.stringify(poolStatus())}`);
    process.exit(0);
  }
  if (command !== 'refill' || !(Number(count) > 0)) {
    console.error('usage: node scripts/lib/identityPool.mjs refill <n> | status');
    process.exit(2);
  }
  // One refill at a time: a second one (another run's exit) sees the first and stops.
  mkdirSync(POOL, { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(REFILL_LOCK, 'wx'));
  } catch {
    const pid = Number(readFileSync(REFILL_LOCK, 'utf8')) || 0;
    const alive = (() => {
      try {
        return pid > 0 && process.kill(pid, 0);
      } catch {
        return false;
      }
    })();
    if (alive) {
      console.log(`POOL_REFILL_SKIPPED refill ${pid} is running`);
      process.exit(0);
    }
  }
  writeFileSync(REFILL_LOCK, String(process.pid));
  await adoptOrphans();
  const before = poolStatus();
  const missing = Math.max(0, Number(count) - before.ready - before.pending);
  console.log(`POOL_REFILL ${new Date().toISOString()} ${JSON.stringify(before)} target=${count} claiming=${missing}`);
  try {
    // With nothing to claim, the refill still watches the pending claims.
    await refillPool(missing);
  } finally {
    rmSync(REFILL_LOCK, { force: true });
  }
  console.log(`POOL ${JSON.stringify(poolStatus())}`);
  process.exit(0);
}
