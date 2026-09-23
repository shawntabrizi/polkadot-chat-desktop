import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';
import { listMessages } from '../chat/messages';

import { COPY_ADDRESS_COMMAND, DRIP_COMMAND, FAUCET_INFO, FAUCET_KEYBOARD_ID, FAUCET_PEER, addCopiedRow, ensureFaucet, faucetKeyboard, faucetUrl } from './faucet';

const ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('the Faucet keyboard (M10 step 6)', () => {
  it('opens the public Paseo faucet on Asset Hub with the address filled in', () => {
    const url = new URL(faucetUrl(ADDRESS));
    expect(url.origin).toBe('https://faucet.polkadot.io');
    expect(url.searchParams.get('parachain')).toBe('1000');
    expect(url.searchParams.get('address')).toBe(ADDRESS);
  });

  it('has "Get 1 PAS" (the faucet bot), "Get test funds" as a url button and "Copy my address", nothing else', () => {
    expect(faucetKeyboard(ADDRESS)).toEqual([
      [{ label: 'Get 1 PAS', action: { kind: 'command', command: DRIP_COMMAND } }],
      [{ label: 'Get test funds', action: { kind: 'url', url: faucetUrl(ADDRESS) } }],
      [{ label: 'Copy my address', action: { kind: 'command', command: COPY_ADDRESS_COMMAND } }],
    ]);
  });

  it('describes itself as a bot (badge kind 0) with the devnet line', () => {
    expect(FAUCET_INFO).toMatchObject({ kind: 0, name: 'Faucet', description: 'Test funds for devnet', commands: [] });
  });
});

describe('ensureFaucet', () => {
  it('creates the info, the room, the greeting and the keyboard, with nothing unread', async () => {
    await ensureFaucet(ADDRESS, 1000);
    expect((await db.peerInfo.get(FAUCET_PEER))?.botInfo).toEqual(FAUCET_INFO);
    const rows = await listMessages(FAUCET_PEER);
    expect(rows.map(row => [row.direction, row.content.type])).toEqual([
      ['system', 'botGreeting'],
      ['incoming', 'buttons'],
    ]);
    expect((await db.rooms.get(FAUCET_PEER))?.unreadCount).toBe(0);
  });

  it('is idempotent, and a second run with another address rewrites the link in place', async () => {
    await ensureFaucet(ADDRESS, 1000);
    await ensureFaucet('5other', 2000);
    const rows = await listMessages(FAUCET_PEER);
    expect(rows).toHaveLength(2);
    const keyboard = await db.messages.get(FAUCET_KEYBOARD_ID);
    expect(keyboard?.timestamp).toBe(1001);
    expect(keyboard?.content.type === 'buttons' ? keyboard.content.rows[1]?.[0]?.action : null).toEqual({ kind: 'url', url: faucetUrl('5other') });
  });

  it('confirms a copy with a system row and never shows the address in it', async () => {
    await ensureFaucet(ADDRESS, 1000);
    await addCopiedRow(3000);
    const last = (await listMessages(FAUCET_PEER)).at(-1);
    expect(last?.direction).toBe('system');
    expect(JSON.stringify(last?.content)).not.toContain(ADDRESS);
  });
});
