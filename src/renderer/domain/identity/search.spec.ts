import { AccountId } from '@polkadot-api/substrate-bindings';
import { describe, expect, it } from 'vitest';

import { NETWORK_PROFILES } from '../../app/network';

import { proofOfComputeWork, searchUsernames } from './search';

const ss58 = AccountId(0);
const self = new Uint8Array(32).fill(0x11);
const other = new Uint8Array(32).fill(0x22);

type Reply = { status: number; body: unknown };
type Call = { url: string; headers: Record<string, string> };

/** Answers each call with the next reply and records what was asked. */
const scriptedFetch = (replies: Reply[], calls: Call[] = []): typeof fetch =>
  (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected fetch');
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;

const page = (rows: unknown[]): Reply => ({ status: 200, body: { usernames: rows, nextCursor: null } });

describe('searchUsernames', () => {
  it('parses rows, decodes the account, and excludes the searching identity', async () => {
    const { results } = await searchUsernames(
      NETWORK_PROFILES.devnet,
      'al',
      self,
      scriptedFetch([
        page([
          { accountId: ss58.dec(self), username: 'alice.01', status: 'ASSIGNED' },
          { accountId: ss58.dec(other), username: 'alistair.02', status: 'ASSIGNED' },
          { accountId: 'not-an-address', username: 'broken' },
          { username: 'no-account' },
        ]),
      ]),
    );
    expect(results.map(r => r.username)).toEqual(['alistair.02']);
    expect(results[0]?.accountId).toEqual(other);
  });

  // "Show more" in the unified search fetches the next page; without the
  // cursor it would fetch the same eight rows again.
  it('passes the page size and cursor, and returns the next cursor', async () => {
    const calls: Call[] = [];
    const first = await searchUsernames(
      NETWORK_PROFILES.devnet,
      'pcd',
      self,
      scriptedFetch([{ status: 200, body: { usernames: [{ accountId: ss58.dec(other), username: 'pcdcolor.05' }], nextCursor: 'NEXT' } }], calls),
      { limit: 8 },
    );
    expect(first.nextCursor).toBe('NEXT');
    expect(calls[0]?.url).toContain('limit=8');
    const last = await searchUsernames(NETWORK_PROFILES.devnet, 'pcd', self, scriptedFetch([page([])], calls), { limit: 8, cursor: first.nextCursor });
    expect(calls[1]?.url).toContain('cursor=NEXT');
    expect(last.nextCursor).toBeNull();
  });

  // A backend that never answers must end in an error ("Search unavailable"),
  // not in "Searching…" forever.
  it('gives up when the backend does not answer in time', async () => {
    const hanging = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    await expect(searchUsernames(NETWORK_PROFILES.devnet, 'pcd', self, hanging, {}, 20)).rejects.toThrow();
  });

  it('fails loudly on an HTTP error or an unexpected body', async () => {
    await expect(searchUsernames(NETWORK_PROFILES.devnet, 'a', self, scriptedFetch([{ status: 500, body: {} }]))).rejects.toThrow('500');
    await expect(searchUsernames(NETWORK_PROFILES.devnet, 'a', self, scriptedFetch([{ status: 200, body: [] }]))).rejects.toThrow('shape');
  });

  // The live backends answer 402 without a proof (checked 2026-09-23); without
  // this path the Search screen finds nobody.
  it('answers a 402 with a solved puzzle and retries once', async () => {
    const puzzle = {
      sessionId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
      timestamp: 1_700_000_000_000,
      difficulty: 6,
      checksum: 'c8828951fd6c123fdbf6501f111d27dd3f260839344a7370e0dd8f20e2c40482',
    };
    const calls: Call[] = [];
    const { results } = await searchUsernames(
      NETWORK_PROFILES.devnet,
      'pcdpeer',
      self,
      scriptedFetch([{ status: 402, body: {} }, { status: 200, body: puzzle }, page([{ accountId: ss58.dec(other), username: 'pcdpeer.47' }])], calls),
    );
    expect(results.map(r => r.username)).toEqual(['pcdpeer.47']);
    expect(calls[1]?.url).toBe('https://polkadot-app.api.polkadotcommunity.foundation/api/v1/poc/issue');

    const header = calls[2]?.headers['Proof-Of-Compute'];
    const [sessionId, timestamp, difficulty, counter, checksum] = atob(header ?? '').split(':');
    expect([sessionId, Number(timestamp), Number(difficulty), checksum]).toEqual([puzzle.sessionId, puzzle.timestamp, puzzle.difficulty, puzzle.checksum]);
    // The server re-checks the work; a counter below the difficulty is refused.
    expect(proofOfComputeWork(puzzle.sessionId, puzzle.timestamp, Number(counter))).toBeGreaterThanOrEqual(puzzle.difficulty);
  });
});

// The backend's own vectors (paritytech/device-uniqueness-backend
// `crates/username-indexer/src/poc/solution.rs`, as copied into
// .refs/polkadot-desktop peer/service.spec.ts): the only proof the preimage
// layout matches the server.
describe('proofOfComputeWork', () => {
  it.each([
    [0, 3],
    [12_345, 0],
  ])('matches the backend work vector at counter %i', (counter, expected) => {
    expect(proofOfComputeWork('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', 1_700_000_000_000, counter)).toBe(expected);
  });
});
