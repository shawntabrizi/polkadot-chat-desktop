/**
 * M12g payments. Why these rules matter: a request bubble that says "Paid"
 * is what a person trusts before they hand over something of value, so it
 * must never turn on a peer's word alone (spec 0007: a reference is a
 * claim); and a payer must never be led to sign a "request" that pays
 * someone else, or to send more than the account can spare.
 */

import { describe, expect, it } from 'vitest';

import type { MessageRow } from '../../app/database';
import type { ChainTransfer } from '../../../shared/desktop-api';
import { decodeTxIntent } from '../../../shared/txIntent';
import { type MessageContent, type TxReference, keyboardOf, referenceLine } from '../chat/content';

import {
  declineText,
  parsePas,
  paymentLine,
  paymentRequestOf,
  payerState,
  requestButtons,
  requestPaymentNote,
  requestProblem,
  requestTitle,
  requesterState,
  sendNote,
  sendPaymentRequest,
  sentOf,
  transferIntent,
} from './payments';

const SELF: `0x${string}` = `0x${'a1'.repeat(32)}`;
const PEER: `0x${string}` = `0x${'b2'.repeat(32)}`;
const OTHER = `0x${'c3'.repeat(32)}`;
const CHAIN = `0x${'0d'.repeat(32)}`;
const PAS = 10_000_000_000n;
const NOW = 1_800_000_000_000;

/** Call data of `transfer_keep_alive(to, amount)` as a fake chain encodes it: the account and the amount, nothing else. */
const fakeTransferCall = async (to: string, amount: string): Promise<Uint8Array> => new TextEncoder().encode(`transfer:${to}:${amount}`);

const rowOf = (messageId: string, direction: MessageRow['direction'], content: MessageContent, timestamp = NOW): MessageRow => ({
  messageId,
  peerAccountId: PEER,
  timestamp,
  direction,
  status: direction === 'incoming' ? 'received' : 'delivered',
  content,
  reactions: [],
  editedAt: null,
});

/** The request row as the requester's manager stores it after `sendButtons`. */
const requestRow = async (direction: 'incoming' | 'outgoing', amount = PAS / 5n, note = 'lunch'): Promise<MessageRow> => {
  let sent: { text: string; rows: Parameters<typeof keyboardOf>[0]; oneShot: boolean } | null = null;
  await sendPaymentRequest(
    { transferCall: fakeTransferCall, sendButtons: async (_peer, content) => void (sent = content) },
    { peer: PEER, self: { accountHex: direction === 'outgoing' ? SELF : PEER, username: 'alice.01' }, chainId: CHAIN, amount, note, now: NOW },
  );
  const content = sent as unknown as { text: string; rows: Parameters<typeof keyboardOf>[0]; oneShot: boolean };
  return rowOf('REQ-1', direction, { type: 'buttons', text: content.text, rows: keyboardOf(content.rows), oneShot: content.oneShot, pressed: null });
};

const reference = (note: string, status: TxReference['status'] = 'inBlock', hash = `0x${'ee'.repeat(32)}`): TxReference => ({
  chainId: CHAIN,
  hash,
  status,
  block: status === 'submitted' ? null : 77,
  note,
  intentMessageId: null,
});

const refRow = (id: string, direction: 'incoming' | 'outgoing', ref: TxReference, timestamp = NOW + 1_000): MessageRow =>
  rowOf(id, direction, { type: 'transactionReference', reference: ref }, timestamp);

const transfer = (from: string, to: string, amount: bigint): ChainTransfer => ({ from, to, amount: String(amount) });

describe('parsePas', () => {
  it('reads what a person types, at most 4 decimals, and refuses zero and junk', () => {
    expect(parsePas('1')).toBe(PAS);
    expect(parsePas(' 0.2 ')).toBe(PAS / 5n);
    expect(parsePas('0,25')).toBe(PAS / 4n);
    expect(parsePas('0.0001')).toBe(1_000_000n);
    // A 5th decimal would be silently cut: refused instead.
    expect(parsePas('0.00001')).toBeNull();
    expect(parsePas('0')).toBeNull();
    expect(parsePas('-1')).toBeNull();
    expect(parsePas('1e3')).toBeNull();
    expect(parsePas('')).toBeNull();
  });
});

describe('a request on the wire', () => {
  it('is a buttons message with readable text and one tx button that pays the requester the amount', async () => {
    const row = await requestRow('outgoing');
    if (row.content.type !== 'buttons') throw new Error('not buttons');
    // A phone without M12g still reads it: the text and the button label say it all.
    expect(row.content.text).toBe('Requested 0.2 PAS · lunch');
    expect(row.content.rows[0]?.[0]?.label).toBe('Pay 0.2 PAS');
    const action = row.content.rows[0]?.[0]?.action;
    if (action?.kind !== 'tx') throw new Error('not a tx button');
    const intent = decodeTxIntent(action.intent);
    expect(intent?.dryRunRequired).toBe(true);
    expect(intent?.chainId).toBe(CHAIN);
    expect(intent?.display).toEqual({ title: 'Pay alice.01 0.2 PAS', description: 'lunch', amount: '0.2', asset: 'PAS' });
    // The call pays us (the requester), and `value` states the amount so the payer's dry-run counts it.
    expect(new TextDecoder().decode(intent?.calls[0]?.data)).toBe(`transfer:${SELF}:${PAS / 5n}`);
    expect(intent?.calls[0]?.value).toBe(PAS / 5n);
    expect(Number(intent?.expiresAt)).toBe(NOW + 7 * 24 * 3_600_000);
  });

  it('is recognised back from the row; a bot keyboard with a tx button is not a request', async () => {
    const request = paymentRequestOf(await requestRow('incoming'));
    expect(request).toMatchObject({ messageId: 'REQ-1', amount: PAS / 5n, note: 'lunch', title: 'Pay alice.01 0.2 PAS', own: false });
    const bot = await requestRow('incoming');
    if (bot.content.type !== 'buttons') throw new Error('not buttons');
    expect(paymentRequestOf({ ...bot, content: { ...bot.content, text: 'Top up your balance' } })).toBeNull();
  });
});

describe('requestProblem (before the payer signs)', () => {
  it('accepts a request whose call pays exactly the sender that amount', async () => {
    const request = paymentRequestOf(await requestRow('incoming'));
    if (!request) throw new Error('no request');
    expect(await requestProblem(request, PEER, fakeTransferCall)).toBeNull();
  });

  it('refuses a "request" whose call pays someone else: signing it would send money to a third account', async () => {
    const callData = await fakeTransferCall(OTHER, String(PAS));
    const intent = transferIntent({ chainId: CHAIN, callData, amount: PAS, title: requestTitle('alice.01', PAS), description: '', expiresAt: NOW + 1 });
    const row = rowOf('REQ-X', 'incoming', { type: 'buttons', text: 'Requested 1 PAS', rows: keyboardOf(requestButtons(intent, PAS, '').rows), oneShot: false, pressed: null });
    const request = paymentRequestOf(row);
    if (!request) throw new Error('no request');
    expect(await requestProblem(request, PEER, fakeTransferCall)).toMatch(/does not pay the person who sent it/);
  });
});

describe('requesterState: paid only with the note AND the chain', () => {
  const accounts = { self: SELF, peer: PEER };

  it('turns paid when a reference with the req: note is in a block and the chain moved the amount from the peer to us', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    const paid = reference(requestPaymentNote('REQ-1', 'lunch'));
    const rows = [await requestRow('outgoing'), refRow('R1', 'incoming', paid)];
    const state = requesterState(request, rows, () => [transfer(PEER, SELF, PAS / 5n)], accounts, NOW + 2_000);
    expect(state.state).toBe('paid');
    expect(state.paidBy?.hash).toBe(paid.hash);
  });

  it('stays pending while the chain has not answered: the reference alone is a claim', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    const rows = [await requestRow('outgoing'), refRow('R1', 'incoming', reference(requestPaymentNote('REQ-1', '')))];
    expect(requesterState(request, rows, () => undefined, accounts, NOW + 2_000)).toMatchObject({ state: 'pending', checking: true });
  });

  it('stays pending when the chain moved less than asked, or moved it from someone else', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    const rows = [await requestRow('outgoing'), refRow('R1', 'incoming', reference(requestPaymentNote('REQ-1', '')))];
    expect(requesterState(request, rows, () => [transfer(PEER, SELF, PAS / 10n)], accounts, NOW).state).toBe('pending');
    expect(requesterState(request, rows, () => [transfer(OTHER, SELF, PAS)], accounts, NOW).state).toBe('pending');
    expect(requesterState(request, rows, () => [], accounts, NOW).state).toBe('pending');
  });

  it('ignores a reference with a wrong note, even when that transaction did pay us', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    // Another request's payment, and a plain send: neither pays this request.
    const rows = [
      await requestRow('outgoing'),
      refRow('R1', 'incoming', reference(requestPaymentNote('REQ-OTHER', ''))),
      refRow('R2', 'incoming', reference(sendNote(PAS, ''), 'inBlock', `0x${'dd'.repeat(32)}`)),
    ];
    expect(requesterState(request, rows, () => [transfer(PEER, SELF, PAS)], accounts, NOW).state).toBe('pending');
  });

  it('ignores a reference that is only submitted, and one of our own', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    const note = requestPaymentNote('REQ-1', '');
    const rows = [await requestRow('outgoing'), refRow('R1', 'incoming', reference(note, 'submitted')), refRow('R2', 'outgoing', reference(note))];
    expect(requesterState(request, rows, () => [transfer(PEER, SELF, PAS)], accounts, NOW).state).toBe('pending');
  });

  it('shows declined after the peer\'s "Declined: <title>", and expired after 7 days', async () => {
    const request = paymentRequestOf(await requestRow('outgoing'));
    if (!request) throw new Error('no request');
    const declined = rowOf('T1', 'incoming', { type: 'text', text: declineText(request.title) }, NOW + 5);
    expect(requesterState(request, [declined], () => undefined, accounts, NOW + 10).state).toBe('declined');
    expect(requesterState(request, [], () => undefined, accounts, request.expiresAt).state).toBe('expired');
  });
});

describe('payerState', () => {
  it('is paid once our reference for the request is in a block; declined after our Decline text', async () => {
    const request = paymentRequestOf(await requestRow('incoming'));
    if (!request) throw new Error('no request');
    const ours = { ...reference(requestPaymentNote('REQ-1', 'lunch')), intentMessageId: 'REQ-1' };
    expect(payerState(request, [refRow('R1', 'outgoing', { ...ours, status: 'submitted', block: null })], NOW).state).toBe('pending');
    expect(payerState(request, [refRow('R1', 'outgoing', ours)], NOW)).toEqual({ state: 'paid', status: 'inBlock' });
    const decline = rowOf('T1', 'outgoing', { type: 'text', text: declineText(request.title) }, NOW + 5);
    expect(payerState(request, [decline], NOW + 10).state).toBe('declined');
  });
});

describe('notes and lines', () => {
  it('puts req:<messageId> first in a request payment note, then the words', () => {
    expect(requestPaymentNote('REQ-1', 'lunch')).toBe('req:REQ-1 lunch');
    expect(requestPaymentNote('REQ-1', '')).toBe('req:REQ-1');
    // A phone shows the note as is; this client hides the marker.
    expect(referenceLine(reference('req:REQ-1 lunch'))).toBe('lunch · in block #77');
  });

  it('reads a send note back', () => {
    expect(sendNote(PAS, 'lunch')).toBe('Sent 1 PAS · lunch');
    expect(sentOf('Sent 0.1 PAS')).toEqual({ amount: '0.1', words: '' });
    expect(sentOf('Top up (1 PAS)')).toBeNull();
  });

  it('says who paid whom on each side', () => {
    expect(paymentLine(reference(sendNote(PAS, '')), true, 'bob.02', null)).toBe('Sent 1 PAS to bob.02 · in block #77');
    expect(paymentLine(reference(sendNote(PAS, 'lunch')), false, 'bob.02', null)).toBe('bob.02 sent you 1 PAS · lunch · in block #77');
    expect(paymentLine(reference(requestPaymentNote('REQ-1', '')), false, 'bob.02', PAS / 5n)).toBe('bob.02 paid your request of 0.2 PAS · in block #77');
    expect(paymentLine(reference(requestPaymentNote('REQ-1', '')), true, 'alice.01', PAS / 5n)).toBe('Paid 0.2 PAS to alice.01 · in block #77');
    expect(paymentLine(reference('Top up (1 PAS)'), true, 'bot', null)).toBeNull();
  });
});
