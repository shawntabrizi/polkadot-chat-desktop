/**
 * Username search against the identity backend. Mirrors
 * polkadot-desktop src/domains/chat/p2p/peer/gateway.ts (`searchUsernames`,
 * proof of compute) and peer/service.ts (self exclusion, the work function).
 *
 * The backend may answer 402: it then wants a solved puzzle from
 * `POST /api/v1/poc/issue` in a `Proof-Of-Compute` header. The work is a
 * sha256 search over a 32-byte preimage; difficulty 16–18 is well under a
 * second of hashing.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { AccountId } from '@polkadot-api/substrate-bindings';

import { bytesEqual } from '../../app/bytes';
import { type NetworkProfile, proofOfComputeUrl, usernameSearchUrl } from '../../app/network';

export type SearchResult = {
  /** SS58 as the backend minted it; decoded to bytes for everything else. */
  candidateAccountId: string;
  accountId: Uint8Array;
  username: string;
};

const ss58ToBytes = AccountId().enc;

/** Above this the search would block for many seconds; the backends issue 16–18. */
const MAX_DIFFICULTY = 24;
/** Counters between yields, so the screen stays responsive while mining. */
const MINE_CHUNK = 4_096;
/**
 * A search that has not answered by then fails, so the screen says "Search
 * unavailable" instead of "Searching…" forever (seen on devnet 2026-09-23:
 * requests that hung for more than 30 s).
 */
const SEARCH_TIMEOUT_MS = 15_000;

// The backend response is a trust boundary: rows missing a field this app
// reads are dropped, extra fields are ignored.
const parseRow = (row: unknown): SearchResult | null => {
  if (typeof row !== 'object' || row === null) return null;
  const { accountId, username } = row as Record<string, unknown>;
  if (typeof accountId !== 'string' || typeof username !== 'string') return null;
  try {
    return { candidateAccountId: accountId, accountId: ss58ToBytes(accountId), username };
  } catch {
    return null;
  }
};

type Puzzle = { sessionId: string; timestamp: number; difficulty: number; checksum: string };

const parsePuzzle = (body: unknown): Puzzle => {
  const { sessionId, timestamp, difficulty, checksum } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof sessionId !== 'string' ||
    !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(sessionId) ||
    typeof timestamp !== 'number' ||
    !Number.isInteger(timestamp) ||
    typeof difficulty !== 'number' ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 32 ||
    typeof checksum !== 'string' ||
    !/^[0-9a-f]{64}$/.test(checksum)
  ) {
    throw new Error('username search: the backend issued a malformed puzzle');
  }
  return { sessionId, timestamp, difficulty, checksum };
};

/**
 * Leading zero bits of sha256(uuid bytes ‖ timestamp u64be ‖ counter u64be),
 * counted over the first big-endian u32 only, as the backend counts them.
 */
export const proofOfComputeWork = (sessionId: string, timestampMs: number, counter: number): number => {
  const preimage = new Uint8Array(32);
  const hex = sessionId.replaceAll('-', '');
  for (let i = 0; i < 16; i++) preimage[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(preimage.buffer);
  view.setBigUint64(16, BigInt(timestampMs), false);
  view.setBigUint64(24, BigInt(counter), false);
  const digest = sha256(preimage);
  return Math.clz32(((digest[0] ?? 0) << 24) | ((digest[1] ?? 0) << 16) | ((digest[2] ?? 0) << 8) | (digest[3] ?? 0));
};

/** The `Proof-Of-Compute` header value: standard base64 of the solution fields. */
const solve = async (puzzle: Puzzle, signal: AbortSignal): Promise<string> => {
  if (puzzle.difficulty > MAX_DIFFICULTY) throw new Error('Search is temporarily unavailable.');
  let counter = 0;
  while (proofOfComputeWork(puzzle.sessionId, puzzle.timestamp, counter) < puzzle.difficulty) {
    counter += 1;
    if (counter % MINE_CHUNK === 0) {
      // The search's time limit covers the mining too.
      signal.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return btoa(`${puzzle.sessionId}:${puzzle.timestamp}:${puzzle.difficulty}:${counter}:${puzzle.checksum}`);
};

/** One page of hits and the cursor of the next page (null on the last one). */
export type SearchPage = { results: SearchResult[]; nextCursor: string | null };

export const searchUsernames = async (
  profile: NetworkProfile,
  prefix: string,
  selfIdentityAccountId: Uint8Array,
  fetchFn: typeof fetch = fetch,
  page: { limit?: number; cursor?: string | null } = {},
  timeoutMs: number = SEARCH_TIMEOUT_MS,
): Promise<SearchPage> => {
  const url = usernameSearchUrl(profile, prefix, page);
  const signal = AbortSignal.timeout(timeoutMs);
  let response = await fetchFn(url, { headers: { Accept: 'application/json' }, signal });
  if (response.status === 402) {
    // One puzzle per search; a second 402 means the proof was refused.
    const issued = await fetchFn(proofOfComputeUrl(profile), { method: 'POST', signal });
    if (!issued.ok) throw new Error(`username search: puzzle request failed: ${issued.status}`);
    const proof = await solve(parsePuzzle(await issued.json()), signal);
    response = await fetchFn(url, { headers: { Accept: 'application/json', 'Proof-Of-Compute': proof }, signal });
  }
  if (response.status === 429) throw new Error('Too many searches. Try again in a moment.');
  if (!response.ok) throw new Error(`username search failed: ${response.status}`);
  const body = (await response.json()) as { usernames?: unknown; nextCursor?: unknown } | null;
  const rows = body?.usernames;
  if (!Array.isArray(rows)) throw new Error('username search: unexpected response shape');
  const results = rows
    .map(parseRow)
    .filter((row): row is SearchResult => row !== null)
    // Usernames resolve to the identity account, so a search for our own name
    // returns us. Self-chat is not a flow; drop it.
    .filter(row => !bytesEqual(row.accountId, selfIdentityAccountId));
  const nextCursor = typeof body?.nextCursor === 'string' && body.nextCursor !== '' ? body.nextCursor : null;
  return { results, nextCursor };
};
