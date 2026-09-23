/**
 * The built-in Faucet contact (M10 step 6). Local like the Assistant: no
 * account on chain, nothing on the wire. Its room holds a greeting and one
 * keyboard: "Get test funds" opens the public Paseo faucet with this
 * identity's address filled in, and "Copy my address" copies that address.
 * It describes itself with a spec 0008 `botInfo`, stored like a bot's, so it
 * gets the bot badge, the header line and the Bots search section for free.
 */

import { type FaucetPeerId, type MessageRow, appDatabase, db } from '../../app/database';
import type { BotInfo, ChatButton, MessageContent } from '../chat/content';
import { addMessage } from '../chat/messages';

export const FAUCET_PEER: FaucetPeerId = 'local:faucet';
export const FAUCET_USERNAME = 'Faucet';
export const isFaucetPeer = (peer: string): peer is FaucetPeerId => peer === FAUCET_PEER;

/** The command of the "Copy my address" button; handled here, never sent. */
export const COPY_ADDRESS_COMMAND = 'copy-address';
/** The command of "Get 1 PAS": the room asks the faucet bot (domain/faucet/drip.ts); never sent as is. */
export const DRIP_COMMAND = 'drip';

export const FAUCET_INFO: BotInfo = {
  kind: 0,
  name: FAUCET_USERNAME,
  description: 'Test funds for devnet',
  greeting: 'Get free test tokens (PAS) to try payments and contracts on the test network. They have no value.',
  commands: [],
  version: 1,
};

/**
 * The public Paseo faucet, Asset Hub (parachain 1000), with the address
 * filled in. The query parameters are the ones the faucet's own client reads
 * (`parachain`, `address`: paritytech/polkadot-testnet-faucet
 * `client/src/lib/components/Faucet.svelte`); see docs/decisions.md M10.
 */
export const faucetUrl = (address: string): string =>
  `https://faucet.polkadot.io/?parachain=1000&address=${encodeURIComponent(address)}`;

export const faucetKeyboard = (address: string): ChatButton[][] => [
  [{ label: 'Get 1 PAS', action: { kind: 'command', command: DRIP_COMMAND } }],
  [{ label: 'Get test funds', action: { kind: 'url', url: faucetUrl(address) } }],
  [{ label: 'Copy my address', action: { kind: 'command', command: COPY_ADDRESS_COMMAND } }],
];

const GREETING_ID = 'faucet:greeting';
export const FAUCET_KEYBOARD_ID = 'faucet:keyboard';

const localRow = (messageId: string, timestamp: number, direction: MessageRow['direction'], content: MessageContent): MessageRow => ({
  messageId,
  peerAccountId: FAUCET_PEER,
  timestamp,
  direction,
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
});

/**
 * Makes sure the Faucet's info, room, greeting and keyboard exist for the
 * identity `address` (SS58). Idempotent: run on every start. The keyboard is
 * written again each time, so its link always carries the current address
 * (the rows keep their place and time).
 */
export const ensureFaucet = (address: string, now: number = Date.now()): Promise<void> =>
  appDatabase.transaction('rw', [db.peerInfo, db.messages, db.rooms, db.pendingDeletions], async () => {
    const info = await db.peerInfo.get(FAUCET_PEER);
    if (info?.botInfo?.version !== FAUCET_INFO.version) {
      await db.peerInfo.put({ peerId: FAUCET_PEER, botInfo: FAUCET_INFO, botInfoAt: now, botSignalAt: null, startSentAt: null });
    }
    await addMessage(localRow(GREETING_ID, now, 'system', { type: 'botGreeting', text: FAUCET_INFO.greeting }), { read: true });
    const keyboard: MessageContent = { type: 'buttons', text: 'What do you need?', rows: faucetKeyboard(address), oneShot: false, pressed: null };
    const existing = await db.messages.get(FAUCET_KEYBOARD_ID);
    if (existing) await db.messages.update(FAUCET_KEYBOARD_ID, { content: keyboard });
    else await addMessage(localRow(FAUCET_KEYBOARD_ID, now + 1, 'incoming', keyboard), { read: true });
  });

/** "Get 1 PAS": where the ask went. The bot's answer (a transaction reference) arrives in its own chat. */
export const addDripRow = (username: string, via: 'message' | 'request' | 'pending', now: number = Date.now()): Promise<boolean> =>
  addMessage(
    localRow(`faucet:drip:${now}`, now, 'system', {
      type: 'text',
      text: via === 'pending' ? `You already asked ${username}. Its answer comes in that chat once it accepts.` : `Asked ${username} for 1 PAS. The transfer shows in that chat.`,
    }),
    { read: true },
  );

/** "Copy my address": the confirmation row, after the address went to the clipboard. */
export const addCopiedRow = (now: number = Date.now()): Promise<boolean> =>
  addMessage(localRow(`faucet:copied:${now}`, now, 'system', { type: 'text', text: 'Your address is copied. Paste it in any faucet.' }), { read: true });
