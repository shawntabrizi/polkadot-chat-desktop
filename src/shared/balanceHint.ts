/**
 * Spec 0008 v2 `balance` hint: what a bot declares so a client can show
 * "your balance with this bot" without bot-specific code. The client calls
 * `selector(caller)` on `contract` at the best block and shows the returned
 * `uint256` with the hint's `decimals`, `unit` and `label`.
 *
 * Browser-safe: no Node imports.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';

import { PAS_DECIMALS, formatUnits } from './txIntent';

/**
 * The hint as the app stores it: bytes as 0x-hex, `perReply` as a decimal
 * string (bigints stay out of the database). `perReply` is in the smallest
 * unit of the value the view returns.
 */
export type BalanceHint = {
  chainId: string;
  contract: string;
  selector: string;
  decimals: number;
  unit: string;
  perReply: string | null;
  label: string;
  /**
   * Spec 0008 v3: what the bot metered but has not charged yet, as a decimal
   * string in the unit of the value. Missing (a v2 hint, or a row stored
   * before v3) means 0.
   */
  pending?: string;
};

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.replace(/^0x/i, '').match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);

/**
 * pallet-revive `AccountId32Mapper`: the H160 a Substrate account has inside
 * contracts. `keccak256(account)[12..32]`, or the first 20 bytes of an
 * account whose last 12 bytes are all 0xEE (an Ethereum-derived one).
 */
export const reviveAddressOf = (accountId: Uint8Array): Uint8Array =>
  accountId.slice(20).every(byte => byte === 0xee) ? accountId.slice(0, 20) : keccak_256(accountId).slice(12);

/** `selector(address)`: the 4-byte selector, then the H160 left-padded to one 32-byte word. */
export const hintCalldata = (selector: string, address: Uint8Array): Uint8Array => fromHex(`${selector.replace(/^0x/i, '')}${'0'.repeat(24)}${toHex(address)}`);

/** One ABI `uint256` word (big-endian) → bigint; null when it is not one word. */
export const decodeUint256 = (data: Uint8Array): bigint | null => (data.length === 32 ? BigInt(`0x${toHex(data) || '0'}`) : null);

/** The pending amount of a hint (v3); 0 when the bot sent none. */
export const pendingOf = (hint: BalanceHint): bigint => (hint.pending === undefined ? 0n : BigInt(hint.pending));

/**
 * Spec 0008 v3: the one number the header shows, the on-chain value less what
 * the bot has metered but not charged (the same as the bot's `/balance`).
 * Never below 0: a charge that lands on chain before the bot's new `botInfo`
 * must not show a negative balance.
 */
export const spendable = (hint: BalanceHint, onChain: bigint): bigint => {
  const left = onChain - pendingOf(hint);
  return left > 0n ? left : 0n;
};

/** How many replies `value` pays for; null when the hint names no price. */
export const repliesFor = (hint: BalanceHint, value: bigint): bigint | null => {
  const price = hint.perReply === null ? 0n : BigInt(hint.perReply);
  return price > 0n ? value / price : null;
};

/** The three parts of the line: "your stake", "0.5 PAS", "~8 replies" (or null). */
export const hintParts = (hint: BalanceHint, value: bigint): { label: string; amount: string; replies: string | null } => {
  const replies = repliesFor(hint, value);
  return {
    label: hint.label,
    amount: `${formatUnits(value, hint.decimals)} ${hint.unit}`,
    replies: replies === null ? null : `~${replies} ${replies === 1n ? 'reply' : 'replies'}`,
  };
};

/**
 * What the room header shows for an on-chain value (spec 0008 v3, M12f): one
 * number, `value − pending`, the same as the bot's `/balance`, and the split
 * only for the tooltip ("1 PAS on chain · 0.3 not yet charged"), null when
 * nothing is pending.
 */
export const headerParts = (
  hint: BalanceHint,
  onChain: bigint,
): { label: string; amount: string; replies: string | null; split: string | null } => {
  const pending = pendingOf(hint);
  return {
    ...hintParts(hint, spendable(hint, onChain)),
    split: pending > 0n ? `${formatUnits(onChain, hint.decimals)} ${hint.unit} on chain · ${formatUnits(pending, hint.decimals)} not yet charged` : null,
  };
};

/** "your stake: 0.5 PAS", "with Meter: 0.8 PAS (~8 replies)" (M11b step 1). */
export const hintLine = (hint: BalanceHint, value: bigint): string => {
  const { label, amount, replies } = hintParts(hint, value);
  return `${label}: ${amount}${replies === null ? '' : ` (${replies})`}`;
};

/**
 * Native PAS (planck) in the hint's units, for "after this" in the signing
 * strip; null when the hint's unit is not PAS. pallet-revive scales native
 * value into contracts (docs/spec/contracts/meter.md "Units"), so a PAS
 * value with more decimals is the same amount written with more digits.
 */
export const planckInHintUnits = (hint: BalanceHint, planck: bigint): bigint | null =>
  hint.unit === 'PAS' && hint.decimals >= PAS_DECIMALS ? planck * 10n ** BigInt(hint.decimals - PAS_DECIMALS) : null;

/** Planck → "1.234 PAS": at most 4 decimals, trailing zeros dropped. */
export const formatPas = (planck: bigint): string => `${formatUnits(planck)} PAS`;
