/**
 * How a spec 0007 `tx` button looks (owner requirement for M11 step 3): it
 * must read as "this signs something", apart from command, callback and url
 * buttons. A Wallet icon, the label, the amount as a caption ("1 PAS"), the
 * tooltip below. The press only opens the signing strip. Once `expiresAt`
 * passed the button is a disabled chip "<label> · expired" whose tooltip
 * says when and what to do, with "Ask for a new one" beside it (owner
 * question 2026-09-24: a bare "Expired" was unclear and offered no way on). A label that already says the amount
 * ("Pay 0.5 PAS", M12g) gets no caption: one number per button (M12g review).
 */

import type { BotCommand } from '../domain/chat/content';
import { type TxIntent, decodeTxIntent, expiresAtPassed } from '../../shared/txIntent';

import { formatTime } from './format';

export const TX_BUTTON_TOOLTIP = 'Signs a transaction with your account';
export const expiredTooltip = (expiresAt: number): string => `This offer expired on ${formatTime(expiresAt)}. Ask the bot for a new one.`;
export const expiredLabel = (label: string): string => `${label} · expired`;

/** Spec 0007 client rule 1: an intent is never signed at or after `expiresAt` (0: never expires). */
export const intentExpired = (intent: TxIntent, now: number): boolean => expiresAtPassed(intent.expiresAt, now);

export type TxButtonView = {
  /** "1 PAS", from `display.amount` and `display.asset`; null without an amount or when the label already shows it. */
  caption: string | null;
  expired: boolean;
  /** Unix ms, from the intent; 0 never expires. */
  expiresAt: number;
  tooltip: string;
};

/** Null when the intent bytes do not decode (the keyboard never stores those as `tx`). */
export const txButtonView = (intentBytes: Uint8Array, now: number, label: string = ''): TxButtonView | null => {
  const intent = decodeTxIntent(intentBytes);
  if (!intent) return null;
  const { amount, asset } = intent.display;
  const expired = intentExpired(intent, now);
  const caption = amount ? `${amount}${asset ? ` ${asset}` : ''}` : null;
  return {
    caption: caption !== null && label.includes(caption) ? null : caption,
    expired,
    expiresAt: Number(intent.expiresAt),
    tooltip: expired ? expiredTooltip(Number(intent.expiresAt)) : TX_BUTTON_TOOLTIP,
  };
};

/** The words of an offer that say what it does: no amounts, no asset ("Top up 1 PAS" → top, up). */
const offerWords = (text: string, asset: string | undefined): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '' && !/^[0-9]/.test(word) && word !== asset?.toLowerCase());

/**
 * What "Ask for a new one" sends: the bot's own command for this offer when
 * its botInfo lists one (the name is in the label or title, "Top up" →
 * `/topup`, "Stake 0.5 PAS" → `/stake`; or the command's description says
 * what the label says), else a plain request any bot or person can read.
 */
export const askAgainText = (label: string, display: TxIntent['display'] | null, commands: readonly BotCommand[]): string => {
  const phrases = [label, display?.title ?? ''].map(text => offerWords(text, display?.asset)).filter(words => words.length > 0);
  const named = (test: (name: string, words: string[]) => boolean) =>
    commands.find(command => command.name.length >= 3 && phrases.some(words => test(command.name.toLowerCase(), words)));
  // The offer's opening words first ("Top up your balance" is /topup, not /balance).
  const match =
    named((name, words) => words.join('').startsWith(name)) ??
    named((name, words) => words.includes(name)) ??
    commands.find(command => phrases.some(words => ` ${offerWords(command.description, display?.asset).join(' ')} `.includes(` ${words.join(' ')} `)));
  return match ? `/${match.name}` : `Please send a new '${label}' button`;
};

/** The longest wait `setTimeout` takes; a later expiry is reached in steps. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Calls `onExpire` once, when the earliest of `expiries` after `shownAt`
 * (the time the buttons were drawn for) passes, so a button in view flips to
 * expired without a reload. One that passed since then fires at once.
 * Returns the cancel. Nothing ahead: no timer.
 */
export const watchExpiry = (expiries: readonly number[], shownAt: number, onExpire: () => void): (() => void) => {
  const ahead = expiries.filter(at => at > shownAt);
  if (ahead.length === 0) return () => undefined;
  const timer = setTimeout(onExpire, Math.min(Math.max(0, Math.min(...ahead) - Date.now()), MAX_TIMER_MS));
  return () => clearTimeout(timer);
};
