/**
 * The pay-as-you-go agent's Meter contract on devnet Asset Hub
 * (docs/spec/contracts/meter.md, deployed by the pca agent on 2026-09-23).
 * Enough of its ABI for the room header and the signing strip: `balanceOf`
 * and the `topUp` selector, and the unit rules.
 *
 * Browser-safe: no Node imports.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';

import type { TxCall } from './txIntent';

export const METER = {
  address: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
  /** 0.1 PAS in planck: what one reply costs (meter.md, pca `DEFAULT_METER_PRICE`). */
  pricePlanck: 1_000_000_000n,
  /** pallet-revive `NativeToEthRatio`: contract units per planck. */
  unitsPerPlanck: 100_000_000n,
  topUpSelector: '0xdc29f1de',
  balanceOfSelector: '0x70a08231',
} as const;

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.replace(/^0x/i, '').match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);

/**
 * pallet-revive `AccountId32Mapper`: the H160 a Substrate account has inside
 * contracts. `keccak256(account)[12..32]`, or the first 20 bytes of an
 * account whose last 12 bytes are all 0xEE (an Ethereum-derived one).
 */
export const reviveAddressOf = (accountId: Uint8Array): Uint8Array =>
  accountId.slice(20).every(byte => byte === 0xee) ? accountId.slice(0, 20) : keccak_256(accountId).slice(12);

/** `balanceOf(address)` calldata. */
export const balanceOfCalldata = (address: Uint8Array): Uint8Array => fromHex(`${METER.balanceOfSelector}${'0'.repeat(24)}${toHex(address)}`);

/** One ABI `uint256` word (big-endian) → bigint; null when it is not one word. */
export const decodeUint256 = (data: Uint8Array): bigint | null => (data.length === 32 ? BigInt(`0x${toHex(data) || '0'}`) : null);

/** Contract units (1 PAS = 10^18) → planck (1 PAS = 10^10). */
export const unitsToPlanck = (units: bigint): bigint => units / METER.unitsPerPlanck;

/** How many replies a balance pays for. */
export const repliesFor = (planck: bigint): bigint => planck / METER.pricePlanck;

/** A `topUp()` call on the Meter: the strip can say what the balance will be. */
export const isMeterTopUp = (call: TxCall): boolean =>
  call.kind === 1 && call.to !== undefined && `0x${toHex(call.to)}` === METER.address && `0x${toHex(call.data)}` === METER.topUpSelector;

/** The note prefix of the bot's references after a charge: `balance: <planck>` (meter.md). */
export const BALANCE_NOTE = /^balance:\s*(\d+)\s*$/;
