/**
 * M15c: Settings › Storage. Why these tests exist:
 * - the daily share must not shrink while the day's uploads go on (it is
 *   what was left when the day began, over the days until the refill), and
 *   a new day starts from zero;
 * - "Free space" must never drop the sender's own copies: they are the only
 *   source of a resend with the same CIDs (spec 0012 "Re-upload on request").
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { type AttachmentRow, type MessageRow, appDatabase, db } from '../../app/database';

import { freeLocalCopies, localCopies, quotaView, readUploadsToday, recordUploads } from './storageQuota';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 24, 12, 0, 0).getTime();

const quota = (transactionsLeft: number, bytesLeft: number, days: number) => ({
  address: '5x',
  transactionsLeft,
  bytesLeft,
  transactionsTotal: 100,
  bytesTotal: 64 * 1024 * 1024,
  expiresAtBlock: 1_000_000,
  refillsAt: NOW + days * DAY,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('the daily share', () => {
  it('is what was left at the start of the day, spread over the days until the refill', () => {
    // 70 transactions and 70 MB left, 7 days to go: 10 a day.
    const fresh = quotaView(quota(70, 70_000_000, 7), { day: '', transactions: 0, bytes: 0 }, NOW);
    expect(fresh.daysLeft).toBe(7);
    expect(fresh.budget).toEqual({ transactions: 10, bytes: 10_000_000 });
    expect(fresh.over).toBe(false);
    // After 4 uploads today (66 left) the share is still 10, and 4 of it is used.
    const later = quotaView(quota(66, 66_000_000, 7), { day: '', transactions: 4, bytes: 4_000_000 }, NOW);
    expect(later.budget).toEqual({ transactions: 10, bytes: 10_000_000 });
    expect(later.over).toBe(false);
  });

  it('warns past the share but never counts it as a refusal; the last day may use all that is left', () => {
    const over = quotaView(quota(58, 58_000_000, 7), { day: '', transactions: 12, bytes: 12_000_000 }, NOW);
    expect(over.over).toBe(true);
    // Less than a day to the refill: the whole rest is today's.
    const last = quotaView(quota(30, 5_000_000, 0.2), { day: '', transactions: 0, bytes: 0 }, NOW);
    expect(last.daysLeft).toBe(1);
    expect(last.budget).toEqual({ transactions: 30, bytes: 5_000_000 });
  });

  it('counts only what was broadcast, and starts again on a new local day', async () => {
    await recordUploads({ submitted: 2, submittedBytes: 600_000 }, NOW);
    // A resend of a file still on the chain broadcasts nothing.
    await recordUploads({ submitted: 0, submittedBytes: 0 }, NOW);
    await recordUploads({ submitted: 1, submittedBytes: 100 }, NOW + 1000);
    expect(await readUploadsToday(NOW)).toMatchObject({ transactions: 3, bytes: 600_100 });
    expect(await readUploadsToday(NOW + DAY)).toMatchObject({ transactions: 0, bytes: 0 });
  });
});

const message = (messageId: string, direction: 'incoming' | 'outgoing'): MessageRow => ({
  messageId,
  peerAccountId: `0x${'ab'.repeat(32)}`,
  timestamp: 1,
  direction,
  status: direction === 'incoming' ? 'received' : 'sent',
  content: { type: 'attachment', items: [], caption: null },
  reactions: [],
  editedAt: null,
});
const copy = (messageId: string, size: number, updatedAt: number): AttachmentRow => ({
  messageId,
  index: 0,
  status: 'ready',
  done: 1,
  total: 1,
  bytes: new Uint8Array(size),
  mime: 'image/png',
  expiresAt: NOW + 10 * DAY,
  attempts: 0,
  firstFailedAt: null,
  error: null,
  updatedAt,
});

describe('Free space', () => {
  it('drops received copies older than N days, keeps newer ones and every copy of our own', async () => {
    await db.messages.bulkPut([message('old-in', 'incoming'), message('new-in', 'incoming'), message('old-out', 'outgoing')]);
    await db.attachments.bulkPut([copy('old-in', 1000, NOW - 40 * DAY), copy('new-in', 200, NOW - DAY), copy('old-out', 5000, NOW - 40 * DAY)]);
    expect(await localCopies()).toEqual({ received: { files: 2, bytes: 1200 }, sent: { files: 1, bytes: 5000 } });

    expect(await freeLocalCopies(30, NOW)).toEqual({ files: 1, bytes: 1000 });
    const freed = await db.attachments.get(['old-in', 0]);
    // The row stays, marked freed: the bubble offers Download instead of fetching on its own.
    expect(freed?.status).toBe('freed');
    expect(freed?.bytes).toBeNull();
    expect((await db.attachments.get(['old-out', 0]))?.bytes?.length).toBe(5000);

    // "All received copies" (0 days) takes the new one too, and still never ours.
    expect(await freeLocalCopies(0, NOW)).toEqual({ files: 1, bytes: 200 });
    expect(await localCopies()).toEqual({ received: { files: 0, bytes: 0 }, sent: { files: 1, bytes: 5000 } });
  });
});
