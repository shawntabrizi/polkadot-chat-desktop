// Fresh e2e identities (2026-09-24). Each group run takes 14-day statement
// slots, and the shared test identities are full (AccountFull). So a run uses
// new devnet identities: first from the pool (scripts/lib/identityPool.mjs,
// registered ahead), else registered here, the way e2e-demo does
// (src/main/identity/service.ts through tsx). The helper waits for the
// attestation (`Resources.Consumers` at the best block): the statement
// allowance comes with it, 20–65 s after registration
// (docs/spec/efficiency.md), but up to 30 min on 2026-09-24. The identity file
// is `<dir>/identity-<name>/identity.json` (mode 0600); `dir` defaults to
// `.agent-runs`, the place every e2e script reads with `--identity <name>`.
// Prints no secret.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { tsImport } from 'tsx/esm/api';

import { root } from './app.mjs';

const BUDGET_MS = 30 * 60_000;
/** How long one claim may wait for its attestation before a new name is claimed too. */
const ATTEMPT_MS = 8 * 60_000;
/** The backend's requests have no timeout of their own: a claim that hangs this long counts as failed. */
const CLAIM_MS = 2 * 60_000;
const RETRY_PAUSE_MS = 15_000;
const POLL_MS = 5_000;

const load = path => tsImport(join(root, path), import.meta.url);
const delay = ms => new Promise(done => setTimeout(done, ms));
const letters = n => Array.from(randomBytes(n), byte => String.fromCharCode(97 + (byte % 26))).join('');
const bytesOf = hex => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
const message = error => (error instanceof Error ? error.message : String(error));

const within = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, fail) => (timer = setTimeout(() => fail(new Error(`${what}: no answer in ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(timer));
};

/**
 * Claims `<prefix><6 letters>` on `profile` and saves it to
 * `<dir>/identity-<name>/identity.json`; does not wait for the attestation.
 * Throws when the backend refuses or does not answer in 2 min.
 */
export async function claimIdentity(prefix, { profile = 'devnet', dir = join(root, '.agent-runs'), timeoutMs = CLAIM_MS } = {}) {
  const { createIdentity } = await load('src/main/identity/service.ts');
  const name = `${prefix}${letters(6)}`;
  const file = join(dir, `identity-${name}`, 'identity.json');
  const store = {
    load: () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null),
    save: identity => {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, `${JSON.stringify({ version: 1, ...identity }, null, 2)}\n`, { mode: 0o600 });
    },
  };
  try {
    const result = await within(createIdentity({ username: name, digits: null, profile, store, attestationTimeoutMs: 1 }), timeoutMs, 'the identity backend');
    return { name, username: result.username, accountHex: result.accountHex };
  } catch (error) {
    throw new Error(`${name}: ${message(error)}`, { cause: error });
  }
}

/**
 * Registers `<prefix><6 letters>` on `profile` and waits until its
 * `Resources.Consumers` entry is at the best block. A claim not attested in
 * 8 min is joined by a new claim; every claim of this call is watched, and
 * the first one attested is used (on 2026-09-24 some took over 30 min).
 * Returns `{ name, username, accountHex, ms, attempts }`: `name` is the
 * folder key (`--identity-a <name>` reuses it), `username` the claimed `name.NN`.
 */
export async function freshIdentity(prefix, { profile = 'devnet', dir = join(root, '.agent-runs'), budgetMs = BUDGET_MS, log = line => console.log(line) } = {}) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const { withPeopleDirectory } = await load('src/main/identity/directory.ts');
  const claims = [];
  /** The first claim whose key is at the best block, polled until `until`. */
  const firstAttested = until =>
    withPeopleDirectory(profile, async directory => {
      while (Date.now() < until) {
        for (const claim of claims) if (await directory.identifierKeyFor(claim.accountHex).catch(() => null)) return claim;
        await delay(POLL_MS);
      }
      return null;
    }).catch(() => null);
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const claim = await claimIdentity(prefix, { profile, dir, timeoutMs: Math.min(CLAIM_MS, Math.max(1, deadline - Date.now())) });
      claims.push(claim);
      log(`IDENTITY_CLAIMED ${claim.name} ${claim.username} attempt=${attempts} at=${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      log(`IDENTITY_RETRY attempt=${attempts}: ${message(error)}`);
    }
    if (claims.length === 0) {
      await delay(RETRY_PAUSE_MS);
      continue;
    }
    const found = await firstAttested(Math.min(deadline, Date.now() + ATTEMPT_MS));
    if (!found) continue;
    const ms = Date.now() - started;
    log(`IDENTITY_REGISTERED ${found.name} ${found.username} claims=${claims.length} in=${(ms / 1000).toFixed(1)}s`);
    return { ...found, ms, attempts };
  }
  throw new Error(`no fresh identity attested in ${budgetMs / 60_000} min (${claims.length} claims, ${attempts} attempts)`);
}

/** Sends `pas` PAS to `accountHex` from the public dev accounts (scripts/lib/devFund.ts); waits for the best block. */
export async function fundIdentity(accountHex, pas, { profile = 'devnet' } = {}) {
  const { openAssetHub } = await load('src/main/chain/assetHub.ts');
  const { fund } = await load('scripts/lib/devFund.ts');
  const chain = await openAssetHub(profile);
  try {
    return await fund(chain, bytesOf(accountHex), pas);
  } finally {
    chain.destroy();
  }
}

/** Which of `accountHexes` have a `Resources.Consumers` entry at the best block now (one read each, no wait). */
export async function attestedNow(accountHexes, { profile = 'devnet' } = {}) {
  const { withPeopleDirectory } = await load('src/main/identity/directory.ts');
  return withPeopleDirectory(profile, async directory => {
    const found = new Set();
    for (const accountHex of accountHexes) if (await directory.identifierKeyFor(accountHex).catch(() => null)) found.add(accountHex);
    return found;
  });
}
