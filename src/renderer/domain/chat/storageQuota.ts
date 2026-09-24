/**
 * M15c: Settings › Storage. What is left of the Bulletin authorization, what
 * this device stored today against a daily client budget, and "Free space"
 * for the decrypted copies of received attachments.
 *
 * The client budget (spec 0012 "Limits": no protocol day cap, "the client
 * meters"): what is left of the authorization, spread evenly over the days
 * until it refills, counted from what was left at the start of today. It is
 * a meter, not a wall: the only refusal stays the authorization itself
 * (`budgetProblem` in main).
 */

import { db } from '../../app/database';
import { readSetting, writeSetting } from '../../app/settings';

import type { BulletinQuota, BulletinStoreResult } from '../../../shared/desktop-api';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Uploads on one local day. */
export type DayUploads = { day: string; transactions: number; bytes: number };

/** The local calendar day of `at`, `YYYY-MM-DD`. */
export const localDay = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const parseUploads = (value: string | null): DayUploads | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DayUploads>;
    return typeof parsed.day === 'string' && typeof parsed.transactions === 'number' && typeof parsed.bytes === 'number'
      ? { day: parsed.day, transactions: parsed.transactions, bytes: parsed.bytes }
      : null;
  } catch {
    return null;
  }
};

/** Today's uploads (zero on a new day). */
export const readUploadsToday = async (now: number = Date.now()): Promise<DayUploads> => {
  const day = localDay(now);
  const stored = parseUploads(await readSetting('bulletin.uploads'));
  return stored?.day === day ? stored : { day, transactions: 0, bytes: 0 };
};

/** Adds what a store call broadcast to today's count. */
export const recordUploads = async (result: BulletinStoreResult, now: number = Date.now()): Promise<void> => {
  if (result.submitted === 0) return;
  const today = await readUploadsToday(now);
  await writeSetting('bulletin.uploads', JSON.stringify({ ...today, transactions: today.transactions + result.submitted, bytes: today.bytes + result.submittedBytes }));
};

export type QuotaView = {
  transactionsLeft: number;
  bytesLeft: number;
  expiresAtBlock: number;
  refillsAt: number;
  /** Whole days until the authorization refills, at least 1 (today counts). */
  daysLeft: number;
  /** Today's share: (left now + used today) / days left, rounded down. */
  budget: { transactions: number; bytes: number };
  today: { transactions: number; bytes: number };
  /** Today's uploads went past today's share (a warning, never a refusal). */
  over: boolean;
};

/**
 * The quota line's numbers. Today's share is fixed for the day: it is what
 * was left when the day began (left now plus what today used) divided by the
 * days left, so uploading does not shrink today's budget as it goes.
 */
export const quotaView = (quota: BulletinQuota, today: DayUploads, now: number): QuotaView => {
  const daysLeft = Math.max(1, Math.ceil((quota.refillsAt - now) / DAY_MS));
  const budget = {
    transactions: Math.floor((quota.transactionsLeft + today.transactions) / daysLeft),
    bytes: Math.floor((quota.bytesLeft + today.bytes) / daysLeft),
  };
  return {
    transactionsLeft: quota.transactionsLeft,
    bytesLeft: quota.bytesLeft,
    expiresAtBlock: quota.expiresAtBlock,
    refillsAt: quota.refillsAt,
    daysLeft,
    budget,
    today: { transactions: today.transactions, bytes: today.bytes },
    over: today.transactions > budget.transactions || today.bytes > budget.bytes,
  };
};

// ── Local copies ────────────────────────────────────────────────────────────

export type LocalCopies = { received: { files: number; bytes: number }; sent: { files: number; bytes: number } };

/** Decrypted copies of received attachments, and the sender's own copies (the source of a resend). */
export const localCopies = async (): Promise<LocalCopies> => {
  const out: LocalCopies = { received: { files: 0, bytes: 0 }, sent: { files: 0, bytes: 0 } };
  const own = await outgoingIds();
  await db.attachments.each(row => {
    if (!row.bytes) return;
    const side = own.has(row.messageId) ? out.sent : out.received;
    side.files += 1;
    side.bytes += row.bytes.length;
  });
  return out;
};

const outgoingIds = async (): Promise<Set<string>> => new Set((await db.messages.filter(row => row.direction === 'outgoing' && row.content.type === 'attachment').primaryKeys()) as string[]);

/**
 * "Free space": drops the decrypted copies of received attachments that
 * finished downloading more than `days` days ago (0: all of them). The row stays as
 * `freed`: the bubble offers Download again and nothing downloads on its own.
 * The sender's own copies stay: they are the only source of a resend
 * (spec 0012 "Re-upload on request").
 */
export const freeLocalCopies = async (days: number, now: number = Date.now()): Promise<{ files: number; bytes: number }> => {
  const cutoff = now - days * DAY_MS;
  const own = await outgoingIds();
  let files = 0;
  let bytes = 0;
  await db.attachments
    .filter(row => row.bytes !== null && row.status === 'ready' && !own.has(row.messageId) && row.updatedAt <= cutoff)
    .modify(row => {
      files += 1;
      bytes += row.bytes?.length ?? 0;
      row.bytes = null;
      row.status = 'freed';
      row.done = 0;
      row.updatedAt = now;
    });
  return { files, bytes };
};
