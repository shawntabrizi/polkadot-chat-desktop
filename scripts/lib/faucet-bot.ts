// Moved from src/renderer/domain/faucet/drip.ts on 2026-09-23 (M12): the app's
// Faucet is an embedded bot now (main/chain/faucet.ts), so talking to the pca
// faucet bot lives only in the test scripts (e2e-meter, e2e-flip).

/**
 * Test funds from the pca faucet bot: no transaction of ours. It asks the
 * devnet faucet bot `pcdfaucet.NN` (pca, `/drip <address>`), which transfers
 * from `//Alice` and answers with a spec 0007 `transactionReference` in its
 * own chat. The bot's two digits are not fixed, so it is found through the
 * username search, as a person would find it.
 */

import type { HexString } from '../../src/renderer/app/bytes';
import { bytesToHex } from '../../src/renderer/app/bytes';
import type { ContactRow, RequestRow } from '../../src/renderer/app/database';
import type { PeerIdentity } from '../../src/renderer/domain/identity/lookup';
import type { SearchResult } from '../../src/renderer/domain/identity/search';

export const FAUCET_BOT_NAME = 'pcdfaucet';
const FAUCET_BOT = /^pcdfaucet\.\d{2}$/;

/** The command the bot answers (pca `bot-core/lib/faucet.mjs`). */
export const dripCommand = (address: string): string => `/drip ${address}`;

export type DripDeps = {
  contacts: () => Promise<ContactRow[]>;
  requests: () => Promise<RequestRow[]>;
  search: (prefix: string) => Promise<SearchResult[]>;
  getPeerIdentity: (accountId: Uint8Array) => Promise<PeerIdentity | null>;
  sendMessage: (peer: HexString, text: string) => Promise<void>;
  sendRequest: (peer: PeerIdentity, welcomeMessage: string) => Promise<void>;
};

/** Where the ask went: a message in the existing chat, or the first message of a new request. */
export type DripResult = { username: string; peer: HexString; via: 'message' | 'request' | 'pending' };

export const requestDrip = async (deps: DripDeps, address: string): Promise<DripResult> => {
  const text = dripCommand(address);
  const contact = (await deps.contacts()).find(row => FAUCET_BOT.test(row.username));
  if (contact) {
    await deps.sendMessage(contact.accountId, text);
    return { username: contact.username, peer: contact.accountId, via: 'message' };
  }
  const pending = (await deps.requests()).find(row => row.direction === 'outgoing' && row.status === 'pending' && FAUCET_BOT.test(row.peerUsername));
  // The request already carries a /drip; the bot answers it when it accepts.
  if (pending) return { username: pending.peerUsername, peer: pending.peerAccountId, via: 'pending' };
  const hit = (await deps.search(FAUCET_BOT_NAME)).find(row => FAUCET_BOT.test(row.username));
  if (!hit) throw new Error('The faucet bot is not on the network right now.');
  const peer = await deps.getPeerIdentity(hit.accountId);
  if (!peer) throw new Error('The faucet bot has no chat key yet.');
  // pca answers a request's first message like any message, so the drip rides with the request.
  await deps.sendRequest(peer, text);
  return { username: hit.username, peer: bytesToHex(hit.accountId), via: 'request' };
};
