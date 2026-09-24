/**
 * M13 guard rails of the published agent, as plain functions: who may talk
 * to it, the daily reply cap, and the per-peer cooldown. No `electron`
 * import, so the rules are unit-tested and the e2e can read them.
 *
 * - Audience "contacts": only the person's contacts (and the person) are let
 *   in. bot-core refuses a stranger's request before it accepts anything
 *   (`BOT_ALLOWED_PEERS`, logged `BOT_REJECTED_UNLISTED`); `admits` checks
 *   the same list again before a reply, so a list change never lets a turn
 *   through that the new list refuses.
 * - Daily cap: at most `dailyCap` replies per local day; over it the agent
 *   sends nothing (no submission), only a log line.
 * - Cooldown: at least `cooldownMs` between two replies to one peer; a
 *   message inside the window waits for the rest of it (it is not dropped).
 */

export type AgentAudience = 'contacts' | 'anyone';

export const DEFAULT_DAILY_CAP = 200;
export const DEFAULT_COOLDOWN_MS = 5_000;
export const MAX_DAILY_CAP = 10_000;
export const MAX_COOLDOWN_MS = 600_000;

export type AgentLimits = {
  audience: AgentAudience;
  /** Account ids (0x-hex, lowercase) of the contacts, and the person's own account. */
  contacts: readonly string[];
  dailyCap: number;
  cooldownMs: number;
};

/** Replies sent on one local day (`YYYY-MM-DD`). */
export type AgentUsage = { day: string; replies: number };

const norm = (hex: string): string => hex.trim().toLowerCase().replace(/^0x/, '');

/** The local calendar day of `now`, the key of the daily cap. */
export const dayOf = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * `BOT_ALLOWED_PEERS` for bot-core: the contacts for "contacts", or null for
 * "anyone" (bot-core's empty list lets everyone in). An empty contact list
 * with "contacts" must still refuse everyone, so it becomes a list that no
 * account matches (bot-core would read an empty list as "allow all").
 */
export const allowedPeersEnv = (limits: Pick<AgentLimits, 'audience' | 'contacts'>): string | null => {
  if (limits.audience === 'anyone') return null;
  const list = [...new Set(limits.contacts.map(norm).filter(hex => /^[0-9a-f]{64}$/.test(hex)))].sort();
  return list.length > 0 ? list.join(',') : '00'.repeat(32);
};

/** Whether `peer` may get a reply under `limits`. */
export const admits = (peer: string, limits: Pick<AgentLimits, 'audience' | 'contacts'>): boolean =>
  limits.audience === 'anyone' || limits.contacts.some(contact => norm(contact) === norm(peer));

/** Replies left today; the usage of an earlier day counts as none. */
export const repliesLeft = (usage: AgentUsage, dailyCap: number, now: number): number =>
  Math.max(0, dailyCap - (usage.day === dayOf(now) ? usage.replies : 0));

/** The usage after one more reply at `now` (a new day starts at 1). */
export const countReply = (usage: AgentUsage, now: number): AgentUsage =>
  usage.day === dayOf(now) ? { day: usage.day, replies: usage.replies + 1 } : { day: dayOf(now), replies: 1 };

/** How long a reply to a peer last answered at `lastReplyAt` must still wait. */
export const cooldownWait = (lastReplyAt: number | undefined, now: number, cooldownMs: number): number =>
  lastReplyAt === undefined ? 0 : Math.max(0, lastReplyAt + cooldownMs - now);

export type GuardDecision = { reply: true; waitMs: number } | { reply: false; reason: 'stranger' | 'cap' };

/** The whole check for one inbound message, in the order the runtime applies it. */
export const decide = (
  peer: string,
  { limits, usage, lastReplyAt, now }: { limits: AgentLimits; usage: AgentUsage; lastReplyAt: number | undefined; now: number },
): GuardDecision => {
  if (!admits(peer, limits)) return { reply: false, reason: 'stranger' };
  if (repliesLeft(usage, limits.dailyCap, now) === 0) return { reply: false, reason: 'cap' };
  return { reply: true, waitMs: cooldownWait(lastReplyAt, now, limits.cooldownMs) };
};

/** A cap or cooldown from Settings, clamped to what the app accepts. */
export const clampLimits = (value: { dailyCap?: unknown; cooldownMs?: unknown }): { dailyCap: number; cooldownMs: number } => {
  const whole = (entry: unknown, fallback: number, max: number): number =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 ? Math.min(entry, max) : fallback;
  return { dailyCap: whole(value.dailyCap, DEFAULT_DAILY_CAP, MAX_DAILY_CAP), cooldownMs: whole(value.cooldownMs, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS) };
};
