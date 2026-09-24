/**
 * Spec 0012: the Bulletin chain as this app uses it. Store encrypted chunks
 * with `TransactionStorage.store`, read the account's storage authorization,
 * and fetch chunks by CID. Main process only: the Bulletin signer is derived
 * from the identity mnemonic, which never leaves this process.
 *
 * PLAN.md "Best block first": a chunk is stored when a best block holds its
 * `Stored` event; reads are at the best block; finality is never awaited.
 *
 * Authorization: the identity is not a person, so it cannot claim storage on
 * the People chain (spec 0012 Unresolved 1). On devnet only, the public dev
 * key `//Eve` (an `AllowedAuthorizer` there, checked 2026-09-24) grants
 * 100 transactions / 64 MiB when the account has too little. No other
 * profile authorizes on its own.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { bulletinDevnet } from '@polkadot-api/descriptors';
import { mnemonicToMiniSecret, ss58Address } from '@polkadot-labs/hdkd-helpers';
import { type PolkadotClient, type TxEvent, createClient } from 'polkadot-api';
import { getTxCreator } from 'polkadot-api/tx-creator';
import { getWsProvider } from 'polkadot-api/ws';

import { READ_TIMEOUT_MS, awaitBestRuntime, retryOnNextEndpoint, withTimeout } from '../../shared/chainRead';
import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';
import { deriveSr25519PairFromSeed } from '../identity/crypto';
import { metadataCache } from '../metadataCache';

import { devPair } from './faucet';

const typedApi = (client: PolkadotClient) => client.getTypedApi(bulletinDevnet);

/** The path the phone apps and pca use for the Bulletin upload key (spec 0012 "Which account signs"). */
export const BULLETIN_SIGNER_PATH = '//allowance//bulletin//chat';
/** Devnet grant per top-up (milestone M15 step 3). */
export const DEVNET_GRANT = { transactions: 100, bytes: 64n * 1024n * 1024n } as const;
export const DEVNET_BULLETIN_GENESIS = NETWORK_PROFILES.devnet.bulletin?.genesis ?? '';
export const BULLETIN_DEVNET_ONLY = 'Automatic Bulletin storage grants run on the devnet Bulletin chain only.';
/** Bulletin's block time (6 s), to turn an expiry block into a date. */
const BLOCK_MS = 6_000;
/** Spec 0012 "Retry": a chunk not in a best block within 60 s is resubmitted, up to 3 times. */
export const STORE_WAIT_MS = 60_000;
export const RETRY_BACKOFF_MS = [10_000, 30_000, 90_000] as const;
/** Spec 0012 "Download flow": 30 s per source. */
export const FETCH_TIMEOUT_MS = 30_000;
/** 2 MiB `MaxTransactionSize`; a larger chunk is never stored or fetched. */
export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/** `faucet:drip`'s counterpart: an automatic grant only for the devnet Bulletin genesis. */
export const assertDevnetBulletin = (genesis: unknown): string => {
  if (typeof genesis !== 'string' || genesis.toLowerCase() !== DEVNET_BULLETIN_GENESIS.toLowerCase()) throw new Error(BULLETIN_DEVNET_ONLY);
  return genesis;
};

export type BulletinChain = {
  genesis: string;
  gateway: string;
  profile: NetworkProfileId;
  client: PolkadotClient;
  api: ReturnType<typeof typedApi>;
  switchEndpoint: () => void;
  destroy: () => void;
};

export async function openBulletin(profileId: NetworkProfileId): Promise<BulletinChain> {
  const profile = NETWORK_PROFILES[profileId];
  if (!profile.bulletin) throw new Error(`The ${profile.label} network has no Bulletin connection in this app, so attachments are off.`);
  const provider = getWsProvider([...profile.bulletin.endpoints]);
  const client = createClient(provider, metadataCache());
  const chain: BulletinChain = {
    genesis: profile.bulletin.genesis,
    gateway: profile.bulletin.gateway,
    profile: profileId,
    client,
    api: typedApi(client),
    switchEndpoint: () => provider.switch(),
    destroy: () => client.destroy(),
  };
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(client), chain.switchEndpoint);
  } catch (error) {
    client.destroy();
    throw error;
  }
  return chain;
}

export type BulletinSigner = { publicKey: Uint8Array; sign: (message: Uint8Array) => Uint8Array };

/** The identity's Bulletin account: `//allowance//bulletin//chat` from its root seed. */
export const bulletinSigner = (mnemonic: string): BulletinSigner => {
  const pair = deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic), BULLETIN_SIGNER_PATH);
  return { publicKey: pair.publicKey, sign: pair.sign };
};

// ── Pure parts (tested) ─────────────────────────────────────────────────────

const hex = (bytes: Uint8Array): `0x${string}` => `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (value: string): Uint8Array => Uint8Array.from(value.replace(/^0x/i, '').match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);

export const contentHash = (bytes: Uint8Array): Uint8Array => blake2b(bytes, { dkLen: 32 });

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** CIDv1 raw blake2b-256, base32 (the same as the renderer's `cidOf`). */
export const cidOf = (hash: Uint8Array): string => {
  const bytes = Uint8Array.of(0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20, ...hash);
  let out = 'b';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
};

/** What `account_authorization` says, in the numbers the client meters with. */
export type BulletinAllowance = {
  transactionsLeft: number;
  bytesLeft: bigint;
  /** The block the authorization expires at, and an estimate of when (ms since epoch). */
  expiresAtBlock: number;
  refillsAt: number;
};

type RawAuthorization = {
  expires_at: number;
  bytes_allowance: bigint;
  bytes_used: bigint;
  transactions_allowance: number;
  transactions_used: number;
};

export const allowanceOf = (raw: RawAuthorization | undefined, bestBlock: number, now: number): BulletinAllowance | null => {
  if (!raw) return null;
  const bytesLeft = raw.bytes_allowance > raw.bytes_used ? raw.bytes_allowance - raw.bytes_used : 0n;
  return {
    transactionsLeft: Math.max(0, raw.transactions_allowance - raw.transactions_used),
    bytesLeft,
    expiresAtBlock: raw.expires_at,
    refillsAt: now + Math.max(0, raw.expires_at - bestBlock) * BLOCK_MS,
  };
};

const megabytes = (bytes: bigint): string => (Number(bytes) / (1024 * 1024)).toFixed(1);

/**
 * Spec 0012 "Budget check": the chain would take an over-budget store at low
 * priority, so the client refuses it. Null when `chunks` fit.
 */
export const budgetProblem = (allowance: BulletinAllowance | null, chunkSizes: readonly number[]): string | null => {
  if (!allowance) return 'This account has no Bulletin storage yet.';
  const bytes = chunkSizes.reduce((sum, size) => sum + BigInt(size), 0n);
  if (allowance.transactionsLeft >= chunkSizes.length && allowance.bytesLeft >= bytes) return null;
  const date = new Date(allowance.refillsAt).toISOString().slice(0, 10);
  return `Not enough Bulletin storage left: ${megabytes(allowance.bytesLeft)} MB. It refills on ${date}.`;
};

export type StoreAttempt = 'stored' | 'failed' | 'timeout';

export type StoreSteps = {
  /** Submits the chunk once and resolves with what a best block said, or `timeout` after `STORE_WAIT_MS`. */
  submit: () => Promise<StoreAttempt>;
  /** `TransactionByContentHash` at the best block: the chunk is on chain already. */
  isStored: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Spec 0012 "Retry" for one chunk: submit; on a timeout or a failure, check
 * the chain first (a store that landed is not stored twice), then wait 10 s,
 * 30 s, 90 s and submit again. After 3 retries the upload fails.
 */
export async function storeWithRetry(steps: StoreSteps): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const result = await steps.submit().catch((): StoreAttempt => 'failed');
    if (result === 'stored') return;
    if (await steps.isStored().catch(() => false)) return;
    const backoff = RETRY_BACKOFF_MS[attempt];
    if (backoff === undefined) throw new Error('Upload failed: a chunk did not reach the Bulletin chain.');
    await steps.sleep(backoff);
  }
}

export type FetchSource = { name: 'bitswap' | 'mirror' | 'gateway'; get: (cid: string) => Promise<Uint8Array> };

/**
 * Spec 0012 "Source order" (measured on devnet): `bitswap_v1_get` is fast for
 * small chunks but takes ~30 s for 2 MB, where the gateway takes 6–8 s. So a
 * chunk over 512 KB tries the gateway first and bitswap last; the mirror (if
 * any) stays in the middle. The caller knows the chunk's size; main does not.
 */
export const sourceOrder = <T extends { name: FetchSource['name'] }>(sources: readonly T[], gatewayFirst: boolean): T[] => {
  const rank = (name: FetchSource['name']) => (name === 'mirror' ? 1 : (name === 'gateway') === gatewayFirst ? 0 : 2);
  return [...sources].sort((x, y) => rank(x.name) - rank(y.name));
};

/**
 * Spec 0012 "Download flow" step 3–4: each source in order, 30 s each; bytes
 * whose blake2b-256 is not the listed hash are dropped and the next source is
 * tried (every source is untrusted). Rejects when none gave the chunk.
 */
export async function fetchVerified(hash: Uint8Array, sources: readonly FetchSource[], timeoutMs = FETCH_TIMEOUT_MS): Promise<{ bytes: Uint8Array; source: FetchSource['name'] }> {
  const cid = cidOf(hash);
  const reasons: string[] = [];
  for (const source of sources) {
    try {
      const bytes = await withTimeout(source.get(cid), timeoutMs, source.name);
      if (bytes.length > MAX_CHUNK_BYTES) reasons.push(`${source.name}: too large`);
      else if (hex(contentHash(bytes)) !== hex(hash)) reasons.push(`${source.name}: wrong bytes`);
      else return { bytes, source: source.name };
    } catch (error) {
      reasons.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No source had the chunk (${reasons.join('; ')}).`);
}

/** A mirror or gateway prefix from a message: https only, bounded. */
export const httpsPrefix = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
};

const httpGet = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_CHUNK_BYTES) throw new Error('too large');
  return new Uint8Array(await response.arrayBuffer());
};

// ── The service ─────────────────────────────────────────────────────────────

export type StoreProgress = { stored: number; total: number };
/** Where a chunk is: the best block whose `Stored` event named it, or null when the chain had it already. */
export type StoredChunk = { hash: `0x${string}`; block: number | null };

export type BulletinService = {
  address: string;
  genesis: string;
  /** The account's authorization at the best block, or null. */
  allowance: () => Promise<BulletinAllowance | null>;
  /**
   * The budget for `chunkSizes`: on devnet, a `//Eve` grant first when the
   * account has too little; elsewhere only the check. Rejects with the
   * refusal text when it does not fit.
   */
  ensureBudget: (chunkSizes: readonly number[]) => Promise<BulletinAllowance>;
  /**
   * Stores each chunk (nonces in sequence, all in flight) and resolves when
   * a best block holds every `Stored`. Chunks the chain already has are not
   * stored again. `onProgress` gets each step.
   */
  store: (ciphertexts: readonly Uint8Array[], onProgress?: (progress: StoreProgress) => void) => Promise<StoredChunk[]>;
  /**
   * One chunk by its hash: RPC `bitswap_v1_get`, then `mirror`, then the
   * gateway; the gateway first when `gatewayFirst` (a chunk over 512 KB, see
   * `sourceOrder`); or only `only`.
   */
  fetchChunk: (hash: Uint8Array, mirror: string | null, only?: FetchSource['name'], gatewayFirst?: boolean) => Promise<{ bytes: Uint8Array; source: FetchSource['name'] }>;
  dispose: () => void;
};

type Log = (line: string) => void;

export function createBulletinService(
  chain: BulletinChain,
  signer: BulletinSigner,
  { onTransaction = () => undefined, log = line => console.info(line), now = Date.now }: { onTransaction?: () => void; log?: Log; now?: () => number } = {},
): BulletinService {
  const address = ss58Address(signer.publicKey, 42);
  const creator = getTxCreator(signer.publicKey, 'Sr25519', signer.sign);
  const read = <T>(label: string, fn: () => Promise<T>): Promise<T> => retryOnNextEndpoint(() => withTimeout(fn(), READ_TIMEOUT_MS, label), chain.switchEndpoint);
  const bestNumber = async (): Promise<number> => (await chain.client.getBestBlocks())[0]?.number ?? 0;

  const allowance = async (): Promise<BulletinAllowance | null> => {
    const raw = await read('bulletin authorization', () => chain.api.apis.BulletinTransactionStorageApi.account_authorization(address, { at: 'best' }));
    return allowanceOf(raw, await bestNumber(), now());
  };

  /** Waits for the first best block that holds `tx`'s events; `timeout` after `STORE_WAIT_MS`. */
  const submitOnce = (
    tx: { createSubmitAndWatch: (c: typeof creator, o?: { nonce?: number }) => { subscribe: (o: object) => { unsubscribe: () => void } } },
    nonce: number | undefined,
    check: (events: unknown[]) => boolean,
    onBlock: (block: number) => void,
  ): Promise<StoreAttempt> =>
    new Promise(resolve => {
      let done = false;
      const finish = (result: StoreAttempt) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        subscription.unsubscribe();
        resolve(result);
      };
      const timer = setTimeout(() => finish('timeout'), STORE_WAIT_MS);
      const subscription = tx.createSubmitAndWatch(creator, nonce === undefined ? undefined : { nonce }).subscribe({
        next: (event: TxEvent) => {
          if (event.type === 'broadcasted') onTransaction();
          if (event.type !== 'inBestBlock') return;
          const stored = event.ok && check(event.events as unknown[]);
          if (stored) onBlock(event.block.number);
          finish(stored ? 'stored' : 'failed');
        },
        error: () => finish('failed'),
      });
    });

  const storedEventFor = (hash: string) => (events: unknown[]): boolean =>
    events.some(record => {
      const event = record as { type?: string; value?: { type?: string; value?: { content_hash?: string } } };
      return event.type === 'TransactionStorage' && event.value?.type === 'Stored' && event.value.value?.content_hash?.toLowerCase() === hash;
    });

  const isStored = async (hash: `0x${string}`): Promise<boolean> =>
    (await read('bulletin content hash', () => chain.api.query.TransactionStorage.TransactionByContentHash.getValue(hash, { at: 'best' }))) !== undefined;

  // The pool's next nonce (the chain's plus pending), so chunks in flight do not collide.
  const nextNonce = async (): Promise<number> => chain.client._request<number, [string]>('system_accountNextIndex', [address]);

  const ensureBudget = async (chunkSizes: readonly number[]): Promise<BulletinAllowance> => {
    let current = await allowance();
    if (!budgetProblem(current, chunkSizes)) return current as BulletinAllowance;
    if (chain.genesis.toLowerCase() === DEVNET_BULLETIN_GENESIS.toLowerCase()) {
      assertDevnetBulletin(chain.genesis);
      const eve = devPair('Eve');
      const grant = chain.api.tx.TransactionStorage.authorize_account({ who: address, transactions: DEVNET_GRANT.transactions, bytes: DEVNET_GRANT.bytes });
      const eveCreator = getTxCreator(eve.publicKey, 'Sr25519', eve.sign);
      log(`[bulletin] devnet: //Eve authorizes ${address} for ${DEVNET_GRANT.transactions} transactions / ${megabytes(DEVNET_GRANT.bytes)} MB`);
      const result = await new Promise<StoreAttempt>(resolve => {
        const timer = setTimeout(() => resolve('timeout'), STORE_WAIT_MS);
        const subscription = grant.createSubmitAndWatch(eveCreator).subscribe({
          next: (event: TxEvent) => {
            if (event.type === 'broadcasted') onTransaction();
            if (event.type !== 'inBestBlock') return;
            clearTimeout(timer);
            subscription.unsubscribe();
            resolve(event.ok ? 'stored' : 'failed');
          },
          error: () => {
            clearTimeout(timer);
            resolve('failed');
          },
        });
      });
      if (result !== 'stored') throw new Error(`The devnet storage grant did not land (${result}).`);
      current = await allowance();
    }
    const problem = budgetProblem(current, chunkSizes);
    if (problem) throw new Error(problem);
    return current as BulletinAllowance;
  };

  const store = async (ciphertexts: readonly Uint8Array[], onProgress: (progress: StoreProgress) => void = () => undefined): Promise<StoredChunk[]> => {
    if (ciphertexts.length === 0) return [];
    if (ciphertexts.some(c => c.length < 1 || c.length > MAX_CHUNK_BYTES)) throw new Error('A chunk is empty or larger than 2 MiB.');
    const hashes = ciphertexts.map(c => hex(contentHash(c)));
    const result: StoredChunk[] = hashes.map(hash => ({ hash, block: null }));
    const total = ciphertexts.length;
    let stored = 0;
    onProgress({ stored, total });
    // Chunks the chain has already (a retry, or a re-store of the same file) are done.
    const present = await Promise.all(hashes.map(isStored));
    const missing = ciphertexts.map((_c, i) => i).filter(i => !present[i]);
    stored = total - missing.length;
    onProgress({ stored, total });
    if (missing.length === 0) return result;
    await ensureBudget(missing.map(i => (ciphertexts[i] as Uint8Array).length));
    const base = await nextNonce();
    await Promise.all(
      missing.map(async (index, k) => {
        const hash = hashes[index] as `0x${string}`;
        const tx = chain.api.tx.TransactionStorage.store({ data: ciphertexts[index] as Uint8Array });
        let first = true;
        await storeWithRetry({
          submit: async () => {
            // The first try uses the nonce in sequence; a resubmit asks the pool again.
            const nonce = first ? base + k : await nextNonce();
            first = false;
            return submitOnce(tx as never, nonce, storedEventFor(hash), block => {
              result[index] = { hash, block };
            });
          },
          isStored: () => isStored(hash),
          sleep: ms => new Promise(done => setTimeout(done, ms)),
        });
        stored += 1;
        onProgress({ stored, total });
      }),
    );
    return result;
  };

  const fetchChunk = (hash: Uint8Array, mirror: string | null, only?: FetchSource['name'], gatewayFirst = false) => {
    if (hash.length !== 32) return Promise.reject(new Error('A content hash is 32 bytes.'));
    const sources: FetchSource[] = [
      { name: 'bitswap', get: async cid => fromHex(await chain.client._request<string, [string]>('bitswap_v1_get', [cid])) },
    ];
    const safeMirror = httpsPrefix(mirror);
    if (safeMirror) sources.push({ name: 'mirror', get: cid => httpGet(`${safeMirror}${cid}`) });
    sources.push({ name: 'gateway', get: cid => httpGet(`${chain.gateway}${cid}`) });
    return fetchVerified(hash, only ? sources.filter(source => source.name === only) : sourceOrder(sources, gatewayFirst));
  };

  return { address, genesis: chain.genesis, allowance, ensureBudget, store, fetchChunk, dispose: () => undefined };
}
