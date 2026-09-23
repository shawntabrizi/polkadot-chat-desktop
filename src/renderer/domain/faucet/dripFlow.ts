/**
 * The embedded Faucet's "Get 1 PAS" (owner rulings, M12). The Faucet is a
 * local contact whose logic runs in the main process (`main/chain/faucet.ts`):
 * it sends 1 PAS on devnet Asset Hub from the first funded dev account. This
 * module is what the Faucet room shows, kept in its rows (so it survives a
 * closed room and a restart):
 *
 *   idle ──press──▶ pending   one row "Requesting 1 PAS from the faucet…", shimmering
 *   pending ──broadcast──▶ sent   the reference bubble "Dripped 1 PAS from //Bob · submitted"
 *   sent ──states──▶ in block ▶ finalized (or failed); in block adds "Balance now X PAS", once
 *   pending ──an error──▶ the reason, in the error colour
 *   pending ──60 s, no answer──▶ "The faucet did not answer. Try again.", in the error colour
 *
 * While a request is pending or its transfer is only submitted, a press does
 * nothing: no second row, no second transfer.
 */

import type { HexString } from '../../app/bytes';
import { type MessageRow, appDatabase, db } from '../../app/database';
import { formatPas } from '../../../shared/balanceHint';
import type { FaucetDrip, TxStatusEvent } from '../../../shared/desktop-api';
import { type MessageContent, type TxReference, referenceRank } from '../chat/content';
import { addMessage, listMessages, removeMessage } from '../chat/messages';

import { FAUCET_PEER } from './faucet';

/** How long the main process has to broadcast the transfer before the room says it did not. */
export const DRIP_TIMEOUT_MS = 60_000;

const PENDING = 'faucet:pending:';
const DRIP = 'faucet:drip:';
const BALANCE = 'faucet:balance:';
export const PENDING_TEXT = '⏳ Requesting 1 PAS from the faucet…';
export const NO_ANSWER_TEXT = 'The faucet did not answer. Try again.';

const row = (messageId: string, timestamp: number, direction: MessageRow['direction'], content: MessageContent): MessageRow => ({
  messageId,
  peerAccountId: FAUCET_PEER,
  timestamp,
  direction,
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
});

const notice = (messageId: string, timestamp: number, text: string, tone: 'info' | 'error'): MessageRow =>
  row(messageId, timestamp, 'system', { type: 'notice', text, tone });

/** IPC wraps a main-process error ("Error invoking remote method 'faucet:drip': Error: …"); the room shows only the reason. */
const reasonOf = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : 'The faucet did not work.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/** A request is on its way: the pending row, or a transfer that is only submitted. */
export const isDripBusy = (rows: readonly MessageRow[]): boolean =>
  rows.some(
    entry =>
      entry.messageId.startsWith(PENDING) ||
      (entry.messageId.startsWith(DRIP) && entry.content.type === 'transactionReference' && entry.content.reference.status === 'submitted'),
  );

/**
 * A press of "Get 1 PAS". `ignored` while one is busy; else the pending row,
 * then `drip` (the `faucet:drip` IPC). Once broadcast, the pending row
 * becomes the reference bubble; a refusal becomes its reason.
 */
export const startDrip = async (drip: () => Promise<FaucetDrip>, now: number = Date.now()): Promise<'started' | 'ignored' | 'failed'> => {
  const pendingId = `${PENDING}${now}`;
  const claimed = await appDatabase.transaction('rw', [db.messages, db.rooms, db.pendingDeletions], async () => {
    if (isDripBusy(await listMessages(FAUCET_PEER))) return false;
    await addMessage(row(pendingId, now, 'incoming', { type: 'text', text: PENDING_TEXT }), { read: true });
    return true;
  });
  if (!claimed) return 'ignored';
  try {
    const sent = await drip();
    // Timed out meanwhile: the room already said so; a late transfer still shows.
    await removeMessage(pendingId);
    const reference: TxReference = { chainId: sent.chainId, hash: sent.hash, status: 'submitted', block: null, note: `Dripped 1 PAS from ${sent.from}`, intentMessageId: null };
    await addMessage(row(`${DRIP}${sent.hash}`, Math.max(Date.now(), now + 1), 'incoming', { type: 'transactionReference', reference }), { read: true });
    return 'started';
  } catch (cause) {
    const stillPending = await db.messages.get(pendingId);
    await removeMessage(pendingId);
    if (stillPending) await addMessage(notice(`faucet:failed:${now}`, Math.max(Date.now(), now + 1), reasonOf(cause), 'error'), { read: true });
    return 'failed';
  }
};

/** A state of a transfer from the main process: moves the Faucet's reference bubble forward (never back). */
export const applyDripStatus = async (event: TxStatusEvent): Promise<boolean> => {
  const id = `${DRIP}${event.hash}`;
  const current = await db.messages.get(id);
  if (current?.content.type !== 'transactionReference') return false;
  const reference = current.content.reference;
  if (reference.status === 'finalized' || reference.status === 'failed') return false;
  if (event.status !== 'failed' && referenceRank(event.status) <= referenceRank(reference.status)) return false;
  await db.messages.update(id, { content: { type: 'transactionReference', reference: { ...reference, status: event.status, block: event.block ?? reference.block, error: event.error } } });
  return true;
};

/**
 * One step of the clock: a pending request older than 60 s becomes
 * "The faucet did not answer", and a transfer in a block gets
 * "Balance now X PAS" once. `readBalance`: the identity's free Asset Hub
 * balance in planck, at the best block.
 */
export const syncDrip = async (readBalance: () => Promise<bigint>, now: number = Date.now()): Promise<void> => {
  for (const entry of await listMessages(FAUCET_PEER)) {
    if (entry.messageId.startsWith(PENDING) && now - Number(entry.messageId.slice(PENDING.length)) >= DRIP_TIMEOUT_MS) {
      await removeMessage(entry.messageId);
      await addMessage(notice(`faucet:timeout:${entry.messageId.slice(PENDING.length)}`, now, NO_ANSWER_TEXT, 'error'), { read: true });
      continue;
    }
    if (!entry.messageId.startsWith(DRIP) || entry.content.type !== 'transactionReference') continue;
    const { status } = entry.content.reference;
    const balanceId = `${BALANCE}${entry.messageId.slice(DRIP.length)}`;
    if ((status !== 'inBlock' && status !== 'finalized') || (await db.messages.get(balanceId))) continue;
    // A failed read is tried again on the next step.
    const free = await readBalance().catch(() => null);
    if (free !== null) await addMessage(notice(balanceId, Math.max(now, entry.timestamp + 1), `Balance now ${formatPas(free)}`, 'info'), { read: true });
  }
};

/** For specs and the room: the bubble id of a drip's transfer. */
export const dripRowId = (hash: HexString | string): string => `${DRIP}${hash}`;
