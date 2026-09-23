import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';

import type { BotInfo } from './content';
import { listMessages, listRooms } from './messages';
import { applyBotInfo, getPeerInfo, greetingRowId, listBots, markBotSignal, markStartSent, shouldSendStart } from './peerInfo';

const PEER = '0xaa' as const;

const info = (overrides: Partial<BotInfo> = {}): BotInfo => ({
  kind: 0,
  name: 'Guide',
  description: 'Polkadot support guide',
  greeting: 'Hi! Ask me about Polkadot.',
  commands: [{ name: 'staking', description: 'Staking basics' }],
  version: 1,
  ...overrides,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('applyBotInfo (spec 0008 recipient: latest version wins)', () => {
  it('stores the first info and adds its greeting once, as a read system row', async () => {
    expect(await applyBotInfo(PEER, info(), 100)).toBe('first');
    expect((await getPeerInfo(PEER))?.botInfo).toEqual(info());
    const rows = await listMessages(PEER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ messageId: greetingRowId(PEER), direction: 'system', content: { type: 'botGreeting', text: 'Hi! Ask me about Polkadot.' } });
    // A greeting is not a message the user has to read.
    expect((await listRooms())[0]?.unreadCount).toBe(0);
  });

  it('replaces the info on a higher version, without a second greeting', async () => {
    await applyBotInfo(PEER, info(), 100);
    expect(await applyBotInfo(PEER, info({ version: 2, description: 'New words', greeting: 'Hello again' }), 200)).toBe('updated');
    expect((await getPeerInfo(PEER))?.botInfo?.description).toBe('New words');
    expect((await listMessages(PEER)).filter(row => row.content.type === 'botGreeting')).toHaveLength(1);
  });

  it('ignores a lower version (a replay must not roll the description back)', async () => {
    await applyBotInfo(PEER, info({ version: 5, description: 'v5' }), 100);
    expect(await applyBotInfo(PEER, info({ version: 4, description: 'v4' }), 200)).toBe('older');
    const row = await getPeerInfo(PEER);
    expect(row?.botInfo?.description).toBe('v5');
    expect(row?.botInfoAt).toBe(100);
  });

  it('keeps the stored document on the same version but records that it arrived again (the answer to /start)', async () => {
    await applyBotInfo(PEER, info(), 100);
    expect(await applyBotInfo(PEER, info({ description: 'changed without a bump' }), 300)).toBe('same');
    const row = await getPeerInfo(PEER);
    expect(row?.botInfo?.description).toBe('Polkadot support guide');
    expect(row?.botInfoAt).toBe(300);
  });

  it('adds no row for an empty greeting', async () => {
    await applyBotInfo(PEER, info({ greeting: '  ' }), 100);
    expect(await listMessages(PEER)).toHaveLength(0);
  });

  it('keeps the bot signal and the /start mark when info arrives later', async () => {
    await markBotSignal(PEER, 10);
    await markStartSent(PEER, 20);
    await applyBotInfo(PEER, info(), 30);
    expect(await getPeerInfo(PEER)).toMatchObject({ botSignalAt: 10, startSentAt: 20, botInfoAt: 30 });
  });
});

describe('shouldSendStart (M10 step 4)', () => {
  it('is true only for a peer that acts like a bot, has sent no botInfo, and got no /start yet', async () => {
    expect(shouldSendStart(undefined)).toBe(false);
    await markBotSignal(PEER, 10);
    await markBotSignal(PEER, 99);
    expect((await getPeerInfo(PEER))?.botSignalAt).toBe(10);
    expect(shouldSendStart(await getPeerInfo(PEER))).toBe(true);
    await markStartSent(PEER, 20);
    // Once, ever.
    expect(shouldSendStart(await getPeerInfo(PEER))).toBe(false);
  });

  it('is false for a bot that already described itself', async () => {
    await markBotSignal(PEER, 10);
    await applyBotInfo(PEER, info(), 11);
    expect(shouldSendStart(await getPeerInfo(PEER))).toBe(false);
  });

  it('is false for a person (no content on the identity channel)', async () => {
    await db.peerInfo.put({ peerId: PEER, botInfo: null, botInfoAt: null, botSignalAt: null, startSentAt: null });
    expect(shouldSendStart(await getPeerInfo(PEER))).toBe(false);
  });
});

describe('listBots', () => {
  it('lists only peers with a botInfo', async () => {
    await applyBotInfo(PEER, info(), 1);
    await markBotSignal('0xbb', 1);
    expect((await listBots()).map(row => row.peerId)).toEqual([PEER]);
  });
});
