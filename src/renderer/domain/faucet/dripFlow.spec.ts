/**
 * The embedded Faucet's "Get 1 PAS" (owner rulings, M12): the person must see
 * that something happens, see the transfer move to a block without leaving
 * the Faucet, never get stacked rows or a second transfer, and hear why when
 * it cannot pay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appDatabase } from '../../app/database';
import type { FaucetDrip } from '../../../shared/desktop-api';
import { listMessages } from '../chat/messages';

import { DRIP_TIMEOUT_MS, NO_ANSWER_TEXT, PENDING_TEXT, applyDripStatus, startDrip, syncDrip } from './dripFlow';
import { FAUCET_PEER } from './faucet';

const T0 = 1_800_000_000_000;
const HASH = `0x${'ab'.repeat(32)}`;
const paid: FaucetDrip = { hash: HASH, from: '//Bob', chainId: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2' };
const balance = vi.fn(async () => 289_700_000_000n);

/** What the Faucet room shows, in words. */
const faucetRoom = async () =>
  (await listMessages(FAUCET_PEER)).map(row =>
    row.content.type === 'text'
      ? row.content.text
      : row.content.type === 'notice'
        ? `${row.content.tone}: ${row.content.text}`
        : row.content.type === 'transactionReference'
          ? `${row.content.reference.note} · ${row.content.reference.status}`
          : row.content.type,
  );

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
  balance.mockClear();
});

describe('embedded Faucet drip', () => {
  it('a press shows the pending row until the transfer is broadcast; a press meanwhile sends nothing more', async () => {
    let broadcast: (value: FaucetDrip) => void = () => undefined;
    const drip = vi.fn(() => new Promise<FaucetDrip>(done => (broadcast = done)));
    const first = startDrip(drip, T0);
    await vi.waitFor(async () => expect(await faucetRoom()).toEqual([PENDING_TEXT]));
    expect(await startDrip(drip, T0 + 100)).toBe('ignored');
    broadcast(paid);
    expect(await first).toBe('started');
    expect(drip).toHaveBeenCalledTimes(1);
    expect(await faucetRoom()).toEqual(['Dripped 1 PAS from //Bob · submitted']);
    // Still busy while only submitted: a press does nothing.
    expect(await startDrip(drip, T0 + 200)).toBe('ignored');
  });

  it('follows the transfer to in block, then finalized, and adds the balance once', async () => {
    await startDrip(async () => paid, T0);
    await syncDrip(balance, T0 + 1_000);
    expect(balance).not.toHaveBeenCalled();
    expect(await applyDripStatus({ hash: HASH, status: 'inBlock', block: 7, error: null })).toBe(true);
    await syncDrip(balance, T0 + 2_000);
    expect(await applyDripStatus({ hash: HASH, status: 'submitted', block: null, error: null })).toBe(false);
    await applyDripStatus({ hash: HASH, status: 'finalized', block: 7, error: null });
    await syncDrip(balance, T0 + 3_000);
    expect(await faucetRoom()).toEqual(['Dripped 1 PAS from //Bob · finalized', 'info: Balance now 28.97 PAS']);
    expect(balance).toHaveBeenCalledTimes(1);
    // Done: a new press works.
    expect(await startDrip(async () => ({ ...paid, hash: `0x${'cd'.repeat(32)}` }), T0 + 4_000)).toBe('started');
  });

  it('shows why it cannot pay, in the error tone (all dev accounts empty), and the button works again', async () => {
    const refused = () => Promise.reject(new Error("Error invoking remote method 'faucet:drip': Error: All devnet faucet accounts are empty."));
    expect(await startDrip(refused, T0)).toBe('failed');
    expect(await faucetRoom()).toEqual(['error: All devnet faucet accounts are empty.']);
    expect(await startDrip(async () => paid, T0 + 1_000)).toBe('started');
  });

  it('says the faucet did not answer after 60 s (chain down), in the error tone', async () => {
    void startDrip(() => new Promise<FaucetDrip>(() => undefined), T0);
    await vi.waitFor(async () => expect(await faucetRoom()).toEqual([PENDING_TEXT]));
    await syncDrip(balance, T0 + DRIP_TIMEOUT_MS - 1);
    expect(await faucetRoom()).toEqual([PENDING_TEXT]);
    await syncDrip(balance, T0 + DRIP_TIMEOUT_MS);
    expect(await faucetRoom()).toEqual([`error: ${NO_ANSWER_TEXT}`]);
  });

  it('a failed transfer ends the bubble as failed and frees the button', async () => {
    await startDrip(async () => paid, T0);
    await applyDripStatus({ hash: HASH, status: 'failed', block: 7, error: 'not enough funds' });
    expect(await faucetRoom()).toEqual(['Dripped 1 PAS from //Bob · failed']);
    expect(await startDrip(async () => ({ ...paid, hash: `0x${'ee'.repeat(32)}` }), T0 + 1_000)).toBe('started');
  });
});
