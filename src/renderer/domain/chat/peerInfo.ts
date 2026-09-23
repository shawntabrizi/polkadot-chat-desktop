/**
 * Per-peer knowledge beyond the contact row (M10): the spec 0008 `botInfo`
 * a bot sent about itself, and the two facts the automatic `/start` needs.
 *
 * `botInfo`: the highest `version` wins; a lower one is ignored (a replay, or
 * a bot that went back). The greeting becomes one system-style row the first
 * time a peer's info arrives, never again.
 */

import { type PeerId, type PeerInfoRow, appDatabase, db } from '../../app/database';

import type { BotInfo } from './content';
import { addMessage } from './messages';

export const getPeerInfo = (peer: PeerId): Promise<PeerInfoRow | undefined> => db.peerInfo.get(peer);

const emptyRow = (peer: PeerId): PeerInfoRow => ({ peerId: peer, botInfo: null, botInfoAt: null, botSignalAt: null, startSentAt: null });

/**
 * `first`: the peer's first info (the greeting row was added); `updated`: a
 * higher version replaced the stored one; `same`: the stored version again;
 * `older`: a lower version, ignored.
 */
export type BotInfoResult = 'first' | 'updated' | 'same' | 'older';

/** The system-style greeting row of a peer; one per peer, so a fixed id. */
export const greetingRowId = (peer: PeerId): string => `bot-greeting:${peer}`;

export const applyBotInfo = (peer: PeerId, info: BotInfo, arrivedAt: number): Promise<BotInfoResult> =>
  appDatabase.transaction('rw', [db.peerInfo, db.messages, db.rooms, db.pendingDeletions], async () => {
    const row = (await db.peerInfo.get(peer)) ?? emptyRow(peer);
    const stored = row.botInfo;
    if (stored && info.version < stored.version) return 'older';
    const result: BotInfoResult = !stored ? 'first' : info.version > stored.version ? 'updated' : 'same';
    await db.peerInfo.put({ ...row, botInfo: result === 'same' ? stored : info, botInfoAt: arrivedAt });
    if (result === 'first' && info.greeting.trim() !== '') {
      await addMessage(
        {
          messageId: greetingRowId(peer),
          peerAccountId: peer,
          timestamp: arrivedAt,
          direction: 'system',
          status: 'received',
          content: { type: 'botGreeting', text: info.greeting },
          reactions: [],
          editedAt: null,
        },
        { read: true },
      );
    }
    return result;
  });

/** The peer sent content on the identity channel (see `PeerInfoRow.botSignalAt`). The first time stands. */
export const markBotSignal = (peer: PeerId, at: number): Promise<void> =>
  appDatabase.transaction('rw', db.peerInfo, async () => {
    const row = (await db.peerInfo.get(peer)) ?? emptyRow(peer);
    if (row.botSignalAt === null) await db.peerInfo.put({ ...row, botSignalAt: at });
  });

export const markStartSent = (peer: PeerId, at: number): Promise<void> =>
  appDatabase.transaction('rw', db.peerInfo, async () => {
    const row = (await db.peerInfo.get(peer)) ?? emptyRow(peer);
    await db.peerInfo.put({ ...row, startSentAt: at });
  });

/**
 * M10 step 4: send `/start` once, on its own, to a peer that acts like a bot
 * (content on the identity channel) but has sent no `botInfo`: an older bot
 * answers with its help text, a newer one with `botInfo`. Never to a peer
 * with no bot signal: a person would get a stray "/start".
 */
export const shouldSendStart = (row: PeerInfoRow | undefined): boolean =>
  row !== undefined && row.botInfo === null && row.botSignalAt !== null && row.startSentAt === null;

/** Every peer with a `botInfo`: the search's Bots section. */
export const listBots = async (): Promise<PeerInfoRow[]> => (await db.peerInfo.toArray()).filter(row => row.botInfo !== null);
