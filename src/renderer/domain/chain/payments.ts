/**
 * M12g: PAS between people in a 1:1 chat, with no new wire kind.
 *
 * - **Send**: a `TxIntent` of `Balances.transfer_keep_alive(peer, amount)`
 *   that only this client sees; it goes through the same dry-run, strip and
 *   runner as a bot's `tx` button. The one `transactionReference` carries
 *   the note "Sent 1 PAS · <words>", so any client shows what it was.
 * - **Request**: a spec 0006 `buttons` message with one spec 0007 `tx`
 *   button whose intent pays the requester: "Requested 1 PAS · <words>",
 *   button "Pay 1 PAS". A phone renders it as any `tx` button.
 * - **Paid**: the payer's reference carries `req:<request messageId>` first
 *   in its note (`requestIdOfNote`). The requester shows "Paid" only when
 *   such a reference is in a block AND the chain's `Balances.Transfer`
 *   events of that extrinsic moved at least the amount from the peer to us:
 *   a reference alone is a claim (spec 0007 bot rules), the chain is proof.
 *
 * Pure rules, plus two small flows with their effects injected, so the e2e
 * runs the same code as the room.
 */

import type { MessageRow } from '../../app/database';
import type { ChainTransfer } from '../../../shared/desktop-api';
import { CALL_KIND_RAW, MAX_TITLE, PAS_DECIMALS, TX_INTENT_VERSION, decodeTxIntent, encodeTxIntent, formatUnits } from '../../../shared/txIntent';
import { MAX_REFERENCE_NOTE, type TxReference, type TxStatus, noteWords, referenceLine, requestIdOfNote } from '../chat/content';
import type { ButtonWire } from '../chat/identityEvents';

export const PAYMENT_ASSET = 'PAS';
/** The person's note on a send or a request. */
export const MAX_PAYMENT_NOTE = 120;
/** A request can be paid for this long. */
export const REQUEST_TTL_MS = 7 * 24 * 60 * 60_000;
/** A send's intent is local and signed within minutes; the strip's dry-run is valid for two. */
export const SEND_TTL_MS = 10 * 60_000;
/** Amounts are typed with at most this many decimals (the strip and the bubbles show 4). */
export const AMOUNT_DECIMALS = 4;

const clip = (text: string, max: number): string => {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
};

/** "1.25" → planck; null for anything that is not a positive amount with at most 4 decimals. */
export const parsePas = (text: string): bigint | null => {
  const match = /^(\d{1,12})(?:[.,](\d{1,4}))?$/.exec(text.trim());
  if (!match) return null;
  const [, whole = '0', fraction = ''] = match;
  const planck = BigInt(whole) * 10n ** BigInt(PAS_DECIMALS) + BigInt(fraction.padEnd(PAS_DECIMALS, '0'));
  return planck > 0n ? planck : null;
};

/** "1", "0.2": the amount as people read it. */
export const pas = (planck: bigint): string => formatUnits(planck, PAS_DECIMALS, AMOUNT_DECIMALS);

/** The person's note: trimmed, one line, at most 120 characters. */
export const cleanNote = (note: string): string => clip(note.replace(/\s+/g, ' ').trim(), MAX_PAYMENT_NOTE);

const withWords = (head: string, note: string): string => (note ? `${head} · ${note}` : head);

// ── Intents ─────────────────────────────────────────────────────────────────

type IntentInput = { chainId: string; callData: Uint8Array; amount: bigint; title: string; description: string; expiresAt: number };

/** One raw `transfer_keep_alive` call; `value` states the amount so the dry-run counts it against the balance. */
export const transferIntent = ({ chainId, callData, amount, title, description, expiresAt }: IntentInput): Uint8Array =>
  encodeTxIntent({
    version: TX_INTENT_VERSION,
    chainId,
    calls: [{ kind: CALL_KIND_RAW, to: undefined, data: callData, value: amount, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
    display: { title: clip(title, MAX_TITLE), description, amount: pas(amount), asset: PAYMENT_ASSET },
    dryRunRequired: true,
    expiresAt: BigInt(expiresAt),
  });

/** "Pay alice.01 1 PAS": the title of a request's intent, and what a decline names. */
export const requestTitle = (requester: string, amount: bigint): string => clip(`Pay ${requester} ${pas(amount)} ${PAYMENT_ASSET}`, MAX_TITLE);

/** The `buttons` message of a request: readable text for any client, one `tx` button. */
export const requestButtons = (intent: Uint8Array, amount: bigint, note: string): { text: string; rows: ButtonWire[][]; oneShot: boolean } => ({
  text: withWords(`Requested ${pas(amount)} ${PAYMENT_ASSET}`, note),
  rows: [[{ label: `Pay ${pas(amount)} ${PAYMENT_ASSET}`, action: { tag: 'tx', value: intent } }]],
  // Not one-shot: a failed payment can be tried again.
  oneShot: false,
});

export type PaymentRequest = {
  messageId: string;
  timestamp: number;
  own: boolean;
  amount: bigint;
  /** The requester's words (the intent's description). */
  note: string;
  title: string;
  expiresAt: number;
  intent: Uint8Array;
};

/**
 * A request as this client sends it: one `buttons` row with one `tx` button,
 * one raw call that moves a PAS amount, and the "Requested " text. Anything
 * else is a bot's keyboard and keeps the M11 behaviour.
 */
export const paymentRequestOf = (row: MessageRow): PaymentRequest | null => {
  if (row.content.type !== 'buttons' || row.direction === 'system') return null;
  const [only, ...more] = row.content.rows;
  const button = only?.length === 1 && more.length === 0 ? only[0] : undefined;
  if (button?.action.kind !== 'tx' || !row.content.text.startsWith('Requested ')) return null;
  const intent = decodeTxIntent(button.action.intent);
  const call = intent?.calls.length === 1 ? intent.calls[0] : undefined;
  if (!intent || !call || call.kind !== CALL_KIND_RAW || call.value <= 0n || intent.display.asset !== PAYMENT_ASSET) return null;
  return {
    messageId: row.messageId,
    timestamp: row.timestamp,
    own: row.direction === 'outgoing',
    amount: call.value,
    note: intent.display.description,
    title: intent.display.title,
    expiresAt: Number(intent.expiresAt),
    intent: button.action.intent,
  };
};

/**
 * Before the payer signs: the request's call must be exactly
 * `transfer_keep_alive(requester, amount)` as this chain encodes it, and the
 * amount on the button must be that amount. Else it is not paid as a request.
 */
export const requestProblem = async (request: PaymentRequest, requester: string, transferCall: (to: string, amount: string) => Promise<Uint8Array>): Promise<string | null> => {
  const intent = decodeTxIntent(request.intent);
  const call = intent?.calls[0];
  if (!intent || !call) return 'This request cannot be read.';
  const expected = await transferCall(requester, String(request.amount));
  const same = expected.length === call.data.length && expected.every((byte, i) => byte === call.data[i]);
  if (!same) return 'This request does not pay the person who sent it, so this app will not sign it.';
  if (intent.display.amount !== pas(request.amount)) return 'The amount on this request does not match its transfer.';
  return null;
};

// ── Notes on the wire ───────────────────────────────────────────────────────

/** The note of a request's payment: `req:<messageId>` first, then the request's words. */
export const requestPaymentNote = (requestId: string, note: string): string => clip(`req:${requestId}${note ? ` ${note}` : ''}`, MAX_REFERENCE_NOTE);

/** The note of a direct send: "Sent 1 PAS · lunch". */
export const sendNote = (amount: bigint, note: string): string => clip(withWords(`Sent ${pas(amount)} ${PAYMENT_ASSET}`, note), MAX_REFERENCE_NOTE);

/** A direct send's note read back: the amount as written, and the words. */
export const sentOf = (note: string): { amount: string; words: string } | null => {
  const match = /^Sent (\d+(?:\.\d+)?) PAS(?: · ([\s\S]*))?$/.exec(note);
  return match ? { amount: match[1] ?? '', words: match[2] ?? '' } : null;
};

/** What the payer sends on Decline: plain text, so a phone shows it too. */
export const declineText = (title: string): string => `Declined: ${title}`;

// ── States ──────────────────────────────────────────────────────────────────

export type RequestState = 'pending' | 'paid' | 'expired' | 'declined';

/** What the chain said about a reference's transaction; undefined while not read. */
export type TransferLookup = (reference: TxReference) => readonly ChainTransfer[] | undefined;

const settled = (status: TxStatus): boolean => status === 'inBlock' || status === 'finalized';

/** The planck the transfers moved from `from` to `to` (accounts as 0x-hex). */
export const movedBetween = (transfers: readonly ChainTransfer[], from: string, to: string): bigint =>
  transfers
    .filter(entry => entry.from.toLowerCase() === from.toLowerCase() && entry.to.toLowerCase() === to.toLowerCase())
    .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);

/** The peer's references that claim to pay `requestId` and are in a block: the ones to check on the chain. */
export const claimedPayments = (requestId: string, rows: readonly MessageRow[]): TxReference[] =>
  rows.flatMap(row =>
    row.direction === 'incoming' && row.content.type === 'transactionReference' && requestIdOfNote(row.content.reference.note) === requestId && settled(row.content.reference.status)
      ? [row.content.reference]
      : [],
  );

const declinedAfter = (request: PaymentRequest, rows: readonly MessageRow[], direction: 'incoming' | 'outgoing'): boolean =>
  rows.some(row => row.direction === direction && row.content.type === 'text' && row.content.text === declineText(request.title) && row.timestamp >= request.timestamp);

/**
 * The requester's own request. Paid needs both: a reference whose note
 * names this request and that is in a block, and the chain's transfer of at
 * least the amount from `peer` to `self` in that transaction. `checking`:
 * such a reference exists and the chain has not answered (yet).
 */
export const requesterState = (
  request: PaymentRequest,
  rows: readonly MessageRow[],
  lookup: TransferLookup,
  accounts: { self: string; peer: string },
  now: number,
): { state: RequestState; checking: boolean; paidBy: TxReference | null } => {
  const claims = claimedPayments(request.messageId, rows);
  const paidBy = claims.find(reference => movedBetween(lookup(reference) ?? [], accounts.peer, accounts.self) >= request.amount) ?? null;
  if (paidBy) return { state: 'paid', checking: false, paidBy };
  const checking = claims.some(reference => lookup(reference) === undefined);
  if (declinedAfter(request, rows, 'incoming')) return { state: 'declined', checking, paidBy: null };
  return { state: now >= request.expiresAt ? 'expired' : 'pending', checking, paidBy: null };
};

/** The payer's side of a request: its own reference for it (by the intent id or the note), and a decline it sent. */
export const payerState = (request: PaymentRequest, rows: readonly MessageRow[], now: number): { state: RequestState; status: TxStatus | null } => {
  const own = [...rows]
    .reverse()
    .find(
      row =>
        row.direction === 'outgoing' &&
        row.content.type === 'transactionReference' &&
        (row.content.reference.intentMessageId === request.messageId || requestIdOfNote(row.content.reference.note) === request.messageId),
    );
  const status = own?.content.type === 'transactionReference' ? own.content.reference.status : null;
  if (status && settled(status)) return { state: 'paid', status };
  if (declinedAfter(request, rows, 'outgoing')) return { state: 'declined', status };
  return { state: now >= request.expiresAt ? 'expired' : 'pending', status };
};

// ── What the bubbles say ────────────────────────────────────────────────────

/**
 * The line of a payment's reference bubble, or null for any other
 * reference. `requested`: the amount of the request a `req:` note names,
 * when this room has it.
 */
export const paymentLine = (reference: TxReference, own: boolean, peerName: string, requested: bigint | null): string | null => {
  const sent = sentOf(reference.note);
  const requestId = requestIdOfNote(reference.note);
  if (!sent && requestId === null) return null;
  const amount = sent ? `${sent.amount} ${PAYMENT_ASSET}` : requested !== null ? `${pas(requested)} ${PAYMENT_ASSET}` : null;
  const words = sent ? sent.words : noteWords(reference.note);
  const head = sent
    ? own
      ? `Sent ${amount} to ${peerName}`
      : `${peerName} sent you ${amount}`
    : own
      ? amount
        ? `Paid ${amount} to ${peerName}`
        : `Paid ${peerName}'s request`
      : amount
        ? `${peerName} paid your request of ${amount}`
        : `${peerName} paid your request`;
  // The state words ("· in block #123") as every reference has them.
  return referenceLine({ ...reference, note: withWords(head, words) });
};

// ── Flows ───────────────────────────────────────────────────────────────────

export type RequestDeps = {
  transferCall: (to: string, amount: string) => Promise<Uint8Array>;
  sendButtons: (peer: `0x${string}`, content: { text: string; rows: ButtonWire[][]; oneShot: boolean }) => Promise<void>;
};

/** "Request PAS": builds the intent that pays us and sends the `buttons` message. */
export const sendPaymentRequest = async (
  deps: RequestDeps,
  input: { peer: `0x${string}`; self: { accountHex: string; username: string }; chainId: string; amount: bigint; note: string; now?: number },
): Promise<void> => {
  const note = cleanNote(input.note);
  const callData = await deps.transferCall(input.self.accountHex, String(input.amount));
  const intent = transferIntent({
    chainId: input.chainId,
    callData,
    amount: input.amount,
    title: requestTitle(input.self.username, input.amount),
    description: note,
    expiresAt: (input.now ?? Date.now()) + REQUEST_TTL_MS,
  });
  await deps.sendButtons(input.peer, requestButtons(intent, input.amount, note));
};

/** "Send PAS": the local intent of a transfer to the peer, for the dry-run and the strip. */
export const sendIntent = async (
  transferCall: (to: string, amount: string) => Promise<Uint8Array>,
  input: { peer: string; peerName: string; chainId: string; amount: bigint; note: string; now?: number },
): Promise<Uint8Array> =>
  transferIntent({
    chainId: input.chainId,
    callData: await transferCall(input.peer, String(input.amount)),
    amount: input.amount,
    title: `Send ${pas(input.amount)} ${PAYMENT_ASSET} to ${input.peerName}`,
    description: cleanNote(input.note),
    expiresAt: (input.now ?? Date.now()) + SEND_TTL_MS,
  });
