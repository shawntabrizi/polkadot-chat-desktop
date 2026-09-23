import { AccountId } from '@polkadot-api/substrate-bindings';
import { describe, expect, it } from 'vitest';

import { NETWORK_PROFILES } from '../../app/network';

import { searchUsernames } from './search';

const ss58 = AccountId(0);
const self = new Uint8Array(32).fill(0x11);
const other = new Uint8Array(32).fill(0x22);

const fakeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

describe('searchUsernames', () => {
  it('parses rows, decodes the account, and excludes the searching identity', async () => {
    const results = await searchUsernames(
      NETWORK_PROFILES.devnet,
      'al',
      self,
      fakeFetch([
        { candidateAccountId: ss58.dec(self), username: 'alice', status: 'ASSIGNED' },
        { candidateAccountId: ss58.dec(other), username: 'alistair', status: 'ASSIGNED' },
        { candidateAccountId: 'not-an-address', username: 'broken' },
        { username: 'no-account' },
      ]),
    );
    expect(results.map(r => r.username)).toEqual(['alistair']);
    expect(results[0]?.accountId).toEqual(other);
  });

  it('fails loudly on an HTTP error or an unexpected body', async () => {
    await expect(searchUsernames(NETWORK_PROFILES.devnet, 'a', self, fakeFetch([], false))).rejects.toThrow('500');
    await expect(searchUsernames(NETWORK_PROFILES.devnet, 'a', self, fakeFetch({ rows: [] }))).rejects.toThrow('shape');
  });
});
