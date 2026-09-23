import { describe, expect, it } from 'vitest';

import type { ContactRow, RequestRow } from '../../app/database';

import { type DripDeps, requestDrip } from './drip';

const ADDRESS = '5H4Lootcg7w7A4xgsPFDabSiEqFUTpdykagVckcwcx6kyQYW';
const BOT = new Uint8Array(32).fill(9);

const deps = (overrides: Partial<DripDeps> = {}) => {
  const calls: string[] = [];
  const base: DripDeps = {
    contacts: async () => [],
    requests: async () => [],
    search: async () => [
      { candidateAccountId: 'x', accountId: new Uint8Array(32).fill(1), username: 'pcdfaucetfake.10' },
      { candidateAccountId: 'y', accountId: BOT, username: 'pcdfaucet.07' },
    ],
    getPeerIdentity: async accountId => ({ accountId, username: 'pcdfaucet.07', chatPublicKey: new Uint8Array(32) }),
    sendMessage: async (peer, text) => void calls.push(`message ${peer} ${text}`),
    sendRequest: async (peer, text) => void calls.push(`request ${peer.username} ${text}`),
    ...overrides,
  };
  return { base, calls };
};

describe('requestDrip (M11 step 6)', () => {
  // The bot only acts on the exact command with the address: anything else is a chat message.
  it('asks the faucet bot found by search, with /drip and the address as the request message', async () => {
    const { base, calls } = deps();
    const result = await requestDrip(base, ADDRESS);
    expect(result).toMatchObject({ username: 'pcdfaucet.07', via: 'request' });
    expect(calls).toEqual([`request pcdfaucet.07 /drip ${ADDRESS}`]);
  });

  it('writes in the existing chat when the bot is already a contact, and does not search', async () => {
    const contact = { accountId: '0x09', username: 'pcdfaucet.07' } as unknown as ContactRow;
    const { base, calls } = deps({ contacts: async () => [contact], search: async () => { throw new Error('must not search'); } });
    expect(await requestDrip(base, ADDRESS)).toMatchObject({ via: 'message', peer: '0x09' });
    expect(calls).toEqual([`message 0x09 /drip ${ADDRESS}`]);
  });

  it('does not send a second request while the first one waits', async () => {
    const pending = { direction: 'outgoing', status: 'pending', peerUsername: 'pcdfaucet.07', peerAccountId: '0x09' } as unknown as RequestRow;
    const { base, calls } = deps({ requests: async () => [pending] });
    expect(await requestDrip(base, ADDRESS)).toMatchObject({ via: 'pending' });
    expect(calls).toEqual([]);
  });

  it('says so when no faucet bot is found', async () => {
    const { base } = deps({ search: async () => [] });
    await expect(requestDrip(base, ADDRESS)).rejects.toThrow('not on the network');
  });
});
