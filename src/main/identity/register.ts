// Copied from .refs/bot-core/lib/register.mjs on 2026-09-23; changes:
// TypeScript with explicit backend response types; keys come from ./keys
// (same math); the lite-person proof runs only the vendored wasm, found through
// resourcePath() (no native PCA_BANDERSNATCH_CLI binary); acquireIdentitySession
// keeps the mnemonic and access-token paths and drops the voucher and saved-
// session paths (this app does not persist a registration session);
// reregisterIdentity, redeemIdentityVoucher, refreshIdentitySession and
// searchUsernames are not ported (not used by the desktop flow); added
// obtainAnonymousSession and checkUsernameAvailable (the mobile app's
// availability call, see docs/milestones/M1.md step 10c). HTTP payloads of the
// ported calls are unchanged.

import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '@noble/hashes/sha2.js';
import { mnemonicToMiniSecret, ss58Address } from '@polkadot-labs/hdkd-helpers';

import { resourcePath } from '../resources';

import { type Sr25519Pair, deriveSr25519PairFromSeed } from './crypto';
import { bytesToHex, deriveIdentityKeys } from './keys';

const MSG_PREFIX = 'pop:people-lite:register using';

const enc = new TextEncoder();
const hexToBytes = (hex: string): Uint8Array => {
  const clean = String(hex).trim().replace(/^0x/i, '');
  // Don't echo the value: some callers pass key material through this path.
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);
};
const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const compactLen = (n: number): Uint8Array => {
  if (n < 1 << 6) return Uint8Array.of(n << 2);
  if (n < 1 << 14) {
    const v = (n << 2) | 1;
    return Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
  }
  throw new Error('compact length too large');
};
const scaleString = (s: string): Uint8Array => {
  const e = enc.encode(s);
  return concatBytes(compactLen(e.length), e);
};

type FetchImpl = typeof fetch;

/** An HTTP failure from the identity backend; `status` is the HTTP status. */
export type BackendError = Error & { status?: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);
const stringField = (value: unknown, key: string): string | null =>
  isRecord(value) && typeof value[key] === 'string' ? value[key] : null;

// ── Lite-person proof (bandersnatch ring-VRF, vendored WASI build) ────────

type LitePersonOutput = { memberKey: string; proofOfOwnership: string };

let wasmModule: WebAssembly.Module | null = null; // compiled once, instantiated per run (WASI starts are single-shot)
let wasiWarningFiltered = false;

/**
 * Runs `bandersnatch lite-person <entropyHex> <messageHex>` from
 * `resources/summit-bandersnatch-cli.wasm` in-process through node:wasi.
 * The output is deterministic: identical bytes to the native binary.
 */
export async function runLitePerson(entropyHex: string, messageHex: string): Promise<LitePersonOutput> {
  // node:wasi emits an ExperimentalWarning on import; filter that one warning only.
  if (!wasiWarningFiltered) {
    wasiWarningFiltered = true;
    const orig = process.emitWarning.bind(process);
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      if (String(warning).includes('WASI')) return;
      (orig as (warning: string | Error, ...rest: unknown[]) => void)(warning, ...rest);
    }) as typeof process.emitWarning;
  }
  const { WASI } = await import('node:wasi');
  wasmModule ??= await WebAssembly.compile(readFileSync(resourcePath('summit-bandersnatch-cli.wasm')));
  const tmp = join(tmpdir(), `bandersnatch-${process.pid}-${Date.now()}.out`);
  const fd = openSync(tmp, 'w+', 0o600); // not world-readable while the proof is written
  try {
    const wasi = new WASI({
      version: 'preview1',
      args: ['bandersnatch', 'lite-person', entropyHex, messageHex],
      stdout: fd,
      stderr: fd,
    });
    const instance = await WebAssembly.instantiate(wasmModule, wasi.getImportObject() as WebAssembly.Imports);
    const code = wasi.start(instance);
    const out = readFileSync(tmp, 'utf8').trim();
    if (code !== 0) throw new Error(`identity proof helper failed (exit ${code}): ${out}`);
    const parsed: unknown = JSON.parse(out);
    const memberKey = stringField(parsed, 'memberKey');
    const proofOfOwnership = stringField(parsed, 'proofOfOwnership');
    if (memberKey == null || proofOfOwnership == null) throw new Error('identity proof helper returned an unexpected result');
    return { memberKey, proofOfOwnership };
  } finally {
    closeSync(fd);
    rmSync(tmp, { force: true });
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────

async function jsonFetch(url: URL, options: RequestInit, fetchImpl: FetchImpl = fetch): Promise<unknown> {
  const res = await fetchImpl(url, options);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const error: BackendError = new Error(`${res.status} ${res.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const canonicalBackendUrl = (backendUrl: string): string => new URL(backendUrl).href;
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

// ── Auth session (Products Devnet: client-proof with the wallet key) ─────

export type IdentitySession = { backendUrl: string; token: string; refreshToken: string | null };

function tokenPair(data: unknown, operation: string): { token: string; refreshToken: string } {
  const token = stringField(data, 'token')?.trim() ?? '';
  const refreshToken = stringField(data, 'refreshToken')?.trim() ?? '';
  if (!token || !refreshToken) throw new Error(`identity backend did not return a complete token pair after ${operation}`);
  return { token, refreshToken };
}

function decodeChallenge(value: unknown): Uint8Array {
  const encoded = typeof value === 'string' ? value.trim() : '';
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('identity backend returned an invalid authentication challenge');
  }
  const challenge = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (challenge.length === 0 || base64(challenge) !== encoded) {
    throw new Error('identity backend returned an invalid authentication challenge');
  }
  return challenge;
}

export async function requestIdentityChallenge({ backendUrl, fetchImpl = fetch }: { backendUrl: string; fetchImpl?: FetchImpl }): Promise<Uint8Array> {
  const data = await jsonFetch(new URL('/api/v1/auth/challenges', backendUrl), { method: 'POST' }, fetchImpl);
  return decodeChallenge(isRecord(data) ? data.challenge : null);
}

async function issueIdentitySession({
  backendUrl,
  client,
  fetchImpl = fetch,
}: {
  backendUrl: string;
  client: Sr25519Pair;
  fetchImpl?: FetchImpl;
}): Promise<{ token: string; refreshToken: string }> {
  const challenge = await requestIdentityChallenge({ backendUrl, fetchImpl });
  const body = '{}';
  const bodyBytes = enc.encode(body);
  const clientDataHash = sha256(concatBytes(challenge, client.publicKey, sha256(bodyBytes)));
  const clientProof = client.sign(clientDataHash);
  const data = await jsonFetch(
    new URL('/api/v1/auth/token', backendUrl),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Auth-ClientId': base64(client.publicKey),
        'Auth-ClientProof': base64(clientProof),
        'Auth-Challenge': base64(challenge),
      },
      body,
    },
    fetchImpl,
  );
  return tokenPair(data, 'client-proof enrollment');
}

// Products Devnet runs its attestation layer in soft mode: proving possession
// of the //wallet SR25519 key mints the bearer username writes need.
export async function obtainIdentitySession({
  backendUrl,
  mnemonic,
  fetchImpl = fetch,
}: {
  backendUrl: string;
  mnemonic: string;
  fetchImpl?: FetchImpl;
}): Promise<{ token: string; refreshToken: string }> {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) {
    throw new Error('automatic identity enrollment requires the mnemonic');
  }
  const client = deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic), '//wallet');
  return issueIdentitySession({ backendUrl, client, fetchImpl });
}

/**
 * A session for reads before any identity exists (the availability check):
 * a throwaway client key, as register.mjs `identityClient` does without a
 * mnemonic. Both backends require a bearer for `usernames/available`.
 */
export async function obtainAnonymousSession({ backendUrl, fetchImpl = fetch }: { backendUrl: string; fetchImpl?: FetchImpl }): Promise<{ token: string; refreshToken: string }> {
  const client = deriveSr25519PairFromSeed(new Uint8Array(randomBytes(32)), '');
  return issueIdentitySession({ backendUrl, client, fetchImpl });
}

/** True when a JWT expires within a minute (or already has); false when it cannot be read. */
export function jwtExpiresSoon(token: string, now = Date.now()): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
    return isRecord(payload) && typeof payload.exp === 'number' && payload.exp * 1000 <= now + 60_000;
  } catch {
    return false;
  }
}

/** A bearer session: the given access token, else one minted with the wallet key, else null. */
export async function acquireIdentitySession({
  backendUrl,
  mnemonic = null,
  accessToken = null,
  fetchImpl = fetch,
}: {
  backendUrl: string;
  mnemonic?: string | null;
  accessToken?: string | null;
  fetchImpl?: FetchImpl;
}): Promise<IdentitySession | null> {
  const directToken = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (directToken) return { token: directToken, refreshToken: null, backendUrl: canonicalBackendUrl(backendUrl) };
  if (!mnemonic) return null;
  const enrolled = await obtainIdentitySession({ backendUrl, mnemonic, fetchImpl });
  return { backendUrl: canonicalBackendUrl(backendUrl), ...enrolled };
}

// ── Username availability (what the mobile app calls) ────────────────────

export type UsernameAvailability = {
  status: 'AVAILABLE' | 'TAKEN';
  /** The numbers still free for this name, e.g. `[1, 2, 42]` for `name.01`, `name.02`, `name.42`. */
  availableDigits: number[];
};

/** `POST /api/v1/usernames/available?version=v1` with `{"usernames":["<name>"]}`. */
export async function checkUsernameAvailable({
  backendUrl,
  username,
  token,
  fetchImpl = fetch,
}: {
  backendUrl: string;
  username: string;
  token: string;
  fetchImpl?: FetchImpl;
}): Promise<UsernameAvailability> {
  const url = new URL('/api/v1/usernames/available', backendUrl);
  url.searchParams.set('version', 'v1');
  const data = await jsonFetch(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ usernames: [username] }),
    },
    fetchImpl,
  );
  const entry = isRecord(data) && data._tag === 'v1' && isRecord(data.value) ? data.value[username] : null;
  if (!isRecord(entry) || (entry.status !== 'AVAILABLE' && entry.status !== 'TAKEN')) {
    throw new Error('identity backend returned an unexpected availability answer');
  }
  const digits = Array.isArray(entry.availableDigits) ? entry.availableDigits : [];
  return {
    status: entry.status,
    availableDigits: digits.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 99),
  };
}

// ── Registration ─────────────────────────────────────────────────────────

/** The backend's rule: at least 6 lowercase letters, optionally `.NN`. */
export function normalizeUsername(raw: unknown): { base: string; digits: string | null } {
  const m = /^([a-z]{6,})(?:\.(\d{2}))?$/.exec(String(raw ?? '').trim().replace(/^@/, ''));
  if (!m) throw new Error(`username must be at least 6 lowercase letters (got "${String(raw)}")`);
  return { base: m[1] ?? '', digits: m[2] ?? null };
}

export type RegisterResult = {
  account: string;
  address: string;
  identifierKey: string;
  /** What the backend assigned (it picks the number when none was asked for). */
  username: string;
  submitted: unknown;
};

export async function registerIdentity({
  mnemonic,
  username,
  digits = null,
  backendUrl,
  ss58Prefix = 42,
  identityToken = null,
  fetchImpl = fetch,
}: {
  mnemonic: string;
  username: string;
  digits?: string | null;
  backendUrl: string;
  ss58Prefix?: number;
  identityToken?: string | null;
  fetchImpl?: FetchImpl;
}): Promise<RegisterResult> {
  const { base, digits: parsedDigits } = normalizeUsername(username);
  const preferredDigits = digits ?? parsedDigits;

  const { accountId, sign, identifierKey65: identifierKey, liteEntropy } = deriveIdentityKeys(mnemonic);

  const attesterData = await jsonFetch(new URL('/api/v1/attester', backendUrl), { method: 'GET' }, fetchImpl);
  const attester = stringField(attesterData, 'attester');
  if (!attester) throw new Error('identity backend did not return an attester');

  const memberOnly = await runLitePerson(bytesToHex(liteEntropy), bytesToHex(concatBytes(enc.encode(MSG_PREFIX), accountId, new Uint8Array(32))));
  const ringVrfKey = memberOnly.memberKey;
  const liteMessage = concatBytes(enc.encode(MSG_PREFIX), accountId, hexToBytes(ringVrfKey));
  const litePerson = await runLitePerson(bytesToHex(liteEntropy), bytesToHex(liteMessage));

  const resourcesSig = concatBytes(accountId, hexToBytes(attester), identifierKey, scaleString(base), Uint8Array.of(0));
  const payload: Record<string, string> = {
    candidateAccountId: ss58Address(accountId, ss58Prefix),
    username: base,
    candidateSignature: bytesToHex(sign(liteMessage)),
    ringVrfKey,
    proofOfOwnership: litePerson.proofOfOwnership,
    consumerRegistrationSignature: bytesToHex(sign(resourcesSig)),
    identifierKey: bytesToHex(identifierKey),
  };
  // The backend rejects a null preferredDigits; only send it when chosen,
  // otherwise let the backend auto-assign an available number.
  if (preferredDigits) payload.preferredDigits = preferredDigits;

  const submitted = await jsonFetch(
    new URL('/api/v1/usernames', backendUrl),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(identityToken ? { authorization: `Bearer ${identityToken}` } : {}),
      },
      body: JSON.stringify(payload),
    },
    fetchImpl,
  );

  return {
    account: bytesToHex(accountId),
    address: ss58Address(accountId, ss58Prefix),
    identifierKey: bytesToHex(identifierKey),
    username: stringField(submitted, 'username') ?? (preferredDigits ? `${base}.${preferredDigits}` : base),
    submitted,
  };
}

// ── Attestation ──────────────────────────────────────────────────────────

export type AttestationDirectory = { identifierKeyFor: (accountHex: string) => Promise<string | null> };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  // Observe the original promise so a late rejection does not go unhandled.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/** Poll the directory until the account's identifier key is on chain. */
export async function waitForAttestation(
  directory: AttestationDirectory,
  accountHex: string,
  { timeoutMs = 180_000, pollMs = 5_000, onTick }: { timeoutMs?: number; pollMs?: number; onTick?: () => void } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let identifierKey: string | null = null;
    try {
      identifierKey = await withTimeout(directory.identifierKeyFor(accountHex), pollMs, 'attestation check');
    } catch {
      /* transient or timed out */
    }
    if (identifierKey != null) return true;
    if (Date.now() >= deadline) return false;
    onTick?.();
    await new Promise(r => setTimeout(r, pollMs));
  }
}
