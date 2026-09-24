import { describe, expect, it } from 'vitest';

import { type AgentLimits, allowedPeersEnv, countReply, dayOf, decide, repliesLeft } from './guard';

const friend = `0x${'aa'.repeat(32)}`;
const stranger = `0x${'bb'.repeat(32)}`;
const noon = new Date(2026, 8, 24, 12, 0, 0).getTime();
const limits: AgentLimits = { audience: 'contacts', contacts: [friend], dailyCap: 2, cooldownMs: 5_000 };

describe('the published agent\'s guard rails (M13)', () => {
  // "My contacts only" is the default: a stranger must not cost the owner an
  // engine turn or a submission.
  it('the allowlist refuses strangers and lets contacts in', () => {
    expect(decide(stranger, { limits, usage: { day: '', replies: 0 }, lastReplyAt: undefined, now: noon })).toEqual({ reply: false, reason: 'stranger' });
    expect(decide(friend.toUpperCase().replace('0X', '0x'), { limits, usage: { day: '', replies: 0 }, lastReplyAt: undefined, now: noon })).toEqual({ reply: true, waitMs: 0 });
    expect(decide(stranger, { limits: { ...limits, audience: 'anyone' }, usage: { day: '', replies: 0 }, lastReplyAt: undefined, now: noon }).reply).toBe(true);
  });

  // bot-core reads an EMPTY BOT_ALLOWED_PEERS as "allow everyone". A person
  // with no contacts yet chose "contacts only", so the list must still refuse all.
  it('gives bot-core a list that refuses everyone when there are no contacts', () => {
    expect(allowedPeersEnv({ audience: 'contacts', contacts: [] })).toBe('00'.repeat(32));
    expect(allowedPeersEnv({ audience: 'contacts', contacts: [friend, friend, 'junk'] })).toBe('aa'.repeat(32));
    expect(allowedPeersEnv({ audience: 'anyone', contacts: [friend] })).toBeNull();
  });

  // The cap bounds what one day can cost the owner (engine tokens, submissions).
  it('the daily cap stops replies, and a new day starts again', () => {
    let usage = { day: '', replies: 0 };
    usage = countReply(usage, noon);
    usage = countReply(usage, noon + 1);
    expect(repliesLeft(usage, limits.dailyCap, noon)).toBe(0);
    expect(decide(friend, { limits, usage, lastReplyAt: undefined, now: noon + 10_000 })).toEqual({ reply: false, reason: 'cap' });
    const tomorrow = noon + 24 * 3_600_000;
    expect(dayOf(tomorrow)).not.toBe(usage.day);
    expect(decide(friend, { limits, usage, lastReplyAt: undefined, now: tomorrow })).toEqual({ reply: true, waitMs: 0 });
    expect(countReply(usage, tomorrow)).toEqual({ day: dayOf(tomorrow), replies: 1 });
  });

  // A button pressed right after a reply must still be answered: the cooldown
  // spaces replies out, it does not drop the message.
  it('the cooldown makes a quick follow-up wait for the rest of the window', () => {
    expect(decide(friend, { limits, usage: { day: '', replies: 0 }, lastReplyAt: noon, now: noon + 2_000 })).toEqual({ reply: true, waitMs: 3_000 });
    expect(decide(friend, { limits, usage: { day: '', replies: 0 }, lastReplyAt: noon, now: noon + 6_000 })).toEqual({ reply: true, waitMs: 0 });
  });
});
