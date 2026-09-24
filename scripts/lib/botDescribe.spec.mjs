// Why: M15a's e2e passed on the bot's greeting, and a bot that refuses to look
// ("I can't see images") names images too. The assertion must fail on both,
// even when they arrive after the attachment, and pass only on a text after
// the attachment that says what the image shows.

import { describe, expect, it } from 'vitest';

import { describesImage, refusesToLook, repliesAfter, toolsOff } from './botDescribe.mjs';

const SIZE = { width: 410, height: 310 };
const GREETING = "Hello pcdecejakd.11! 👋 Welcome to the group. I'm **pcdguide**, your friendly Polkadot support guide. I'm here";
const WELCOME = "Welcome! 👋 I'm your Polkadot support guide—ask me anything about staking, governance, the Polkadot app, or Polkadot in general!";
const REFUSED = "I can't see images—tools are disabled. The operator can enable image viewing with `/tools read,web`.";
const row = (messageId, text, extra = {}) => ({ messageId, direction: 'incoming', content: { type: 'text', text }, ...extra });

describe('describesImage', () => {
  it('fails on the greetings the guide bot sent (M15a passed on the first one)', () => {
    expect(describesImage(GREETING, SIZE)).toBe(false);
    expect(describesImage(WELCOME, SIZE)).toBe(false);
  });

  it('fails on a refusal that names images without describing one (the fleet bot, 2026-09-24)', () => {
    expect(describesImage(REFUSED, SIZE)).toBe(false);
    expect(describesImage('Sorry, I am unable to view the photo you sent.', SIZE)).toBe(false);
    // The e2e stops waiting at a refusal; a greeting keeps it waiting.
    expect(refusesToLook(REFUSED)).toBe(true);
    expect(refusesToLook(WELCOME)).toBe(false);
  });

  it('passes on a description of what the image shows, or its size', () => {
    expect(describesImage('The image shows a red circle on a grey, noisy background.', SIZE)).toBe(true);
    expect(describesImage('A photo of a big round blob.', SIZE)).toBe(true);
    expect(describesImage('It is 410×310 pixels.', SIZE)).toBe(true);
    expect(describesImage('A 410 by 310 picture.', SIZE)).toBe(true);
    // "Polkadot" is not "dot": M15a's list matched it.
    expect(describesImage('Polkadot dot dot', SIZE)).toBe(false);
  });
});

describe('repliesAfter', () => {
  it('drops what was there before the attachment, progress frames and our own rows', () => {
    const rows = [row('greet', GREETING), row('mine', 'red', { direction: 'outgoing' }), row('frame', '⏳ working · 3s'), row('welcome', WELCOME), row('answer', 'A red circle.')];
    const after = repliesAfter(rows, new Set(['greet']));
    expect(after.map((r) => r.messageId)).toEqual(['welcome', 'answer']);
    // A welcome after the attachment does not describe; the answer after it does.
    expect(after.some((r) => describesImage(r.content.text, SIZE))).toBe(true);
    expect(describesImage(after[0].content.text, SIZE)).toBe(false);
  });

  it('a greeting and a refusal after the attachment are not a description', () => {
    const after = repliesAfter([row('welcome', WELCOME), row('no', REFUSED)], new Set());
    expect(after.some((r) => describesImage(r.content.text, SIZE))).toBe(false);
  });

  it('accepts a quoted reply', () => {
    const rows = [{ messageId: 'r', direction: 'incoming', content: { type: 'reply', messageId: 'att', text: 'That picture is a red circle.' } }];
    expect(repliesAfter(rows, new Set()).map((r) => r.messageId)).toEqual(['r']);
  });
});

describe('toolsOff (M15c)', () => {
  // Why: while the fleet's tool policy is "none" (an operator decision), the e2e reports the bot step as
  // pending instead of failing the desktop check; any other refusal or a wrong answer still fails it.
  it('recognizes the live refusals of a bot whose tools are off', () => {
    expect(toolsOff(REFUSED)).toBe(true);
    expect(toolsOff("I can't view images without tools—the operator can enable them with `/tools read,web`.")).toBe(true);
  });

  it('does not excuse another refusal, a greeting or a description', () => {
    expect(toolsOff('Sorry, I am unable to view the photo you sent.')).toBe(false);
    expect(toolsOff(WELCOME)).toBe(false);
    expect(toolsOff('A red circle. No tools were needed.')).toBe(false);
  });
});
