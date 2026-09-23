import type { Identity, IdentityRepository } from '@novasamatech/host-papp';
import { errAsync, okAsync } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import { NEVER } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { fromRepository } from './lookup';

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
