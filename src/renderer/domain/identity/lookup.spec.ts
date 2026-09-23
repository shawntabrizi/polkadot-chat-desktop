import type { Identity, IdentityRepository } from '@novasamatech/host-papp';
import type { LazyClient } from '@novasamatech/statement-store';
import { errAsync, okAsync } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import { NEVER, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBestBlockIdentityAdapter, fromRepository } from './lookup';

const account = new Uint8Array(32).fill(0x33);
const key = `0x${'ab'.repeat(32)}` as const;

const repo = (identity: Identity | null, fail = false): IdentityRepository => ({
  getIdentity: () => (fail ? errAsync(new Error('rpc down')) : okAsync(identity)),
  getIdentities: () => okAsync({}),
  watchIdentity: () => NEVER,
});

const identity = (overrides: Partial<Identity>): Identity => ({
  accountId: 'x',
  fullUsername: 'alice',
  liteUsername: 'alice-lite',
  credibility: { type: 'Lite' },
  identifierKey: key,
  ...overrides,
});

describe('identity lookup', () => {
  // host-papp's RPC adapter decodes the account with polkadot-api
  // `AccountId().dec`, which takes hex; an SS58 string made every live lookup fail.
  it('asks the repository with the account as 0x-hex, which the SDK adapter can decode', async () => {
    const asked: string[] = [];
    const recording: IdentityRepository = { ...repo(identity({})), getIdentity: accountId => (asked.push(accountId), okAsync(identity({}))) };
    await fromRepository(recording).getPeerIdentity(account);
    expect(asked).toEqual([`0x${'33'.repeat(32)}`]);
    expect(() => AccountId().dec(asked[0]!)).not.toThrow();
  });

  // The SDK already unwraps the RFC-0004 container: what comes back is the
  // 32-byte X25519 key, used as-is.
  it('returns the username and the 32-byte chat key the SDK unwrapped', async () => {
    const peer = await fromRepository(repo(identity({}))).getPeerIdentity(account);
    expect(peer?.username).toBe('alice');
    expect(peer?.chatPublicKey).toHaveLength(32);
    expect(peer?.chatPublicKey[0]).toBe(0xab);
  });

  it('falls back to the lite username', async () => {
    const peer = await fromRepository(repo(identity({ fullUsername: null }))).getPeerIdentity(account);
    expect(peer?.username).toBe('alice-lite');
  });

  it('is null without a record, without a usable key, or when the chain read fails', async () => {
    expect(await fromRepository(repo(null)).getPeerIdentity(account)).toBeNull();
    expect(await fromRepository(repo(identity({ identifierKey: null }))).getPeerIdentity(account)).toBeNull();
    expect(await fromRepository(repo(identity({ identifierKey: '0x0102' }))).getPeerIdentity(account)).toBeNull();
    expect(await fromRepository(repo(null, true)).getPeerIdentity(account)).toBeNull();
  });
});

describe('best-block identity adapter', () => {
  const accountHex = `0x${'33'.repeat(32)}`;
  const raw = {
    identifier_key: `0x00${'ab'.repeat(32)}${'00'.repeat(32)}`,
    full_username: new TextEncoder().encode('alicebob.07'),
    lite_username: new TextEncoder().encode('alicebob'),
    credibility: { type: 'Lite' as const },
  };

  /** A People client whose Consumers entry records the block each read asked for. */
  const fakeConnection = ({ hangFirstRead = false } = {}) => {
    const reads: { at: string }[] = [];
    let hang = hangFirstRead;
    const switchEndpoint = vi.fn();
    const client = {
      bestBlocks$: of([{ hash: '0xbest', number: 7 }]),
      getMetadata: async () => new Uint8Array([1]),
      getUnsafeApi: () => ({
        query: {
          Resources: {
            Consumers: {
              getValues: (_keys: unknown, options: { at: string }) => {
                reads.push(options);
                if (hang) {
                  hang = false;
                  return new Promise(() => undefined);
                }
                return Promise.resolve([raw]);
              },
              watchValue: () => NEVER,
            },
          },
        },
      }),
    };
    const lazyClient = { getClient: () => client } as unknown as LazyClient;
    return { connection: { lazyClient, switchEndpoint }, reads, switchEndpoint };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  // host-papp's own adapter reads at the finalized head, so a peer who had just
  // signed up looked unknown for the finality lag (PLAN.md "Best block first").
  it('reads Resources.Consumers at the best block and unwraps the chat key', async () => {
    const { connection, reads } = fakeConnection();
    const result = await createBestBlockIdentityAdapter(connection).readIdentities([accountHex]);
    expect(reads).toEqual([{ at: 'best' }]);
    expect(result._unsafeUnwrap()[accountHex]).toMatchObject({ fullUsername: 'alicebob.07', identifierKey: `0x${'ab'.repeat(32)}` });
  });

  it('retries a timed-out read once on the next endpoint', async () => {
    vi.useFakeTimers();
    const { connection, reads, switchEndpoint } = fakeConnection({ hangFirstRead: true });
    const reading = createBestBlockIdentityAdapter(connection).readIdentities([accountHex]);
    await vi.advanceTimersByTimeAsync(15_001);
    const result = await reading;
    expect(result.isOk()).toBe(true);
    expect(switchEndpoint).toHaveBeenCalledOnce();
    expect(reads).toHaveLength(2);
  });
});
