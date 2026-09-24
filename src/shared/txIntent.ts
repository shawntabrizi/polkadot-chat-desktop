/**
 * Spec 0007 `TxIntent`: the SCALE payload of a `tx` button (spec 0006 Action
 * tag 3). The renderer decodes it to draw the button and the signing strip;
 * the main process decodes the same bytes again before a dry-run, because the
 * renderer shows remote content and is not trusted with what gets signed.
 *
 * Browser-safe: no Node imports.
 */

import { Bytes, type Codec, type CodecType, Option, Struct, Vector, bool, str, u128, u64, u8 } from 'scale-ts';

const CallCodec = Struct({
  kind: u8,
  to: Option(Bytes()),
  data: Bytes(),
  value: u128,
  gasRefTime: Option(u64),
  gasProofSize: Option(u64),
  storageDepositLimit: Option(u128),
});
const DisplayCodec = Struct({ title: str, description: str, amount: Option(str), asset: Option(str) });

export const TxIntentCodec = Struct({
  version: u8,
  chainId: str,
  calls: Vector(CallCodec),
  display: DisplayCodec,
  dryRunRequired: bool,
  expiresAt: u64,
});

export type TxCall = CodecType<typeof CallCodec>;
export type TxDisplay = CodecType<typeof DisplayCodec>;
export type TxIntent = CodecType<typeof TxIntentCodec>;

/** `Call.kind`: raw extrinsic call data, or a Revive contract call. */
export const CALL_KIND_RAW = 0;
export const CALL_KIND_REVIVE = 1;

/** Spec 0007 limits. */
export const TX_INTENT_VERSION = 1;
export const MAX_TX_CALLS = 8;
export const MAX_CALL_DATA = 16 * 1024;
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 280;

/** The whole payload must be one intent: trailing bytes make it undecodable. */
const decodeStrict = <T>(codec: Codec<T>, bytes: Uint8Array): T | null => {
  try {
    const value = codec.dec(bytes);
    return codec.enc(value).length === bytes.length ? value : null;
  } catch {
    return null;
  }
};

export const decodeTxIntent = (bytes: Uint8Array): TxIntent | null => decodeStrict(TxIntentCodec, bytes);
export const encodeTxIntent = (intent: TxIntent): Uint8Array => TxIntentCodec.enc(intent);

const chars = (text: string): number => [...text].length;

/**
 * Why this client refuses to run the intent, in words for the strip; null
 * when it may be dry-run. Spec 0007 client rule 1 plus the format limits.
 * `chainIds`: the genesis hashes this client is connected to.
 */
export const intentProblem = (intent: TxIntent, { chainIds, now }: { chainIds: readonly string[]; now: number }): string | null => {
  if (intent.version !== TX_INTENT_VERSION) return 'This action uses a newer format than this app knows.';
  if (!intent.dryRunRequired) return 'This action does not allow a test run first, so this app will not sign it.';
  if (!chainIds.some(id => id.toLowerCase() === intent.chainId.toLowerCase())) return 'This action is for a network this app is not connected to.';
  if (Number(intent.expiresAt) <= now) return 'This action has expired. Ask for a new one.';
  if (intent.calls.length === 0 || intent.calls.length > MAX_TX_CALLS) return `This action must have 1 to ${MAX_TX_CALLS} calls.`;
  for (const call of intent.calls) {
    if (call.kind !== CALL_KIND_RAW && call.kind !== CALL_KIND_REVIVE) return 'This action has a call type this app does not know.';
    if (call.data.length > MAX_CALL_DATA) return 'This action is too large.';
    if (call.kind === CALL_KIND_REVIVE && call.to?.length !== 20) return 'This contract call has no valid contract address.';
    if (call.kind === CALL_KIND_RAW && call.data.length < 2) return 'This action has no call data.';
  }
  if (chars(intent.display.title) > MAX_TITLE || chars(intent.display.description) > MAX_DESCRIPTION) return 'This action has a text that is too long.';
  return null;
};

/** Native units per PAS (10 decimals, Paseo Asset Hub). */
export const PAS_DECIMALS = 10;

/** `12_000_000` planck → "0.0012"; trailing zeros dropped, at most `digits` decimals. */
export const formatUnits = (planck: bigint, decimals = PAS_DECIMALS, digits = 4): string => {
  const negative = planck < 0n;
  const abs = negative ? -planck : planck;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  // A non-zero amount below the shown precision is not "0".
  if (whole === 0n && fraction === '' && abs > 0n) return `${negative ? '-' : ''}<0.${'0'.repeat(digits - 1)}1`;
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

// Ported from .refs/polkadot-chat-agents/bot-core/lib/buttons-block.mjs
// `toTxIntent` (branch desktop/rfc-0003, commit 675f948) on 2026-09-24;
// changes: TypeScript types, an absent `to` or gas field is `undefined` (this
// file's codec shape) instead of `null`. The rules are unchanged: keep the
// two in step. M13: the `propose_transaction` tool (shared/directives.ts)
// checks its arguments with it before the agent sends the button.
const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value);
const hexBytes = (value: unknown, { length = null, max = Infinity }: { length?: number | null; max?: number } = {}): Uint8Array | null => {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) return null;
  const bytes = Uint8Array.from(value.slice(2).match(/../g) ?? [], h => parseInt(h, 16));
  if ((length != null && bytes.length !== length) || bytes.length > max) return null;
  return bytes;
};
/** A decimal string or a non-negative safe integer → a bigint below 2^bits, or null. */
const uint = (value: unknown, bits: number): bigint | null => {
  let big: bigint | null = null;
  if (typeof value === 'string' && /^\d{1,40}$/.test(value)) big = BigInt(value);
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) big = BigInt(value);
  return big != null && big < 1n << BigInt(bits) ? big : null;
};
const optionalUint = (value: unknown, bits: number): { ok: boolean; value: bigint | undefined } => {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const parsed = uint(value, bits);
  return { ok: parsed != null, value: parsed ?? undefined };
};
const shortString = (value: unknown, max: number, { empty = true } = {}): value is string =>
  typeof value === 'string' && (empty || value.length > 0) && [...value].length <= max;

/** Spec 0007 `TxIntent` from a brain's JSON (`chainId`, `calls`, `display`, `expiresAt`), or null. */
export const txIntentFromJson = (tx: unknown): TxIntent | null => {
  if (!isRecord(tx)) return null;
  const known = new Set(['chainId', 'calls', 'display', 'expiresAt', 'dryRunRequired', 'version']);
  if (Object.keys(tx).some(k => !known.has(k))) return null;
  if (tx.version !== undefined && tx.version !== 1) return null;
  if (tx.dryRunRequired !== undefined && tx.dryRunRequired !== true) return null;
  if (!hexBytes(tx.chainId, { length: 32 })) return null;
  const expiresAt = uint(tx.expiresAt, 64);
  if (expiresAt == null || expiresAt === 0n) return null;
  if (!Array.isArray(tx.calls) || tx.calls.length === 0 || tx.calls.length > MAX_TX_CALLS) return null;
  const calls: TxCall[] = [];
  for (const call of tx.calls as unknown[]) {
    if (!isRecord(call) || (call.kind !== 0 && call.kind !== 1)) return null;
    const to = call.to == null ? null : hexBytes(call.to, { length: 20 });
    if (call.to != null && !to) return null;
    if (call.kind === 1 && !to) return null;
    const data = hexBytes(call.data, { max: MAX_CALL_DATA });
    const value = call.value === undefined ? 0n : uint(call.value, 128);
    if (!data || value == null) return null;
    const gas = [optionalUint(call.gasRefTime, 64), optionalUint(call.gasProofSize, 64), optionalUint(call.storageDepositLimit, 128)] as const;
    if (gas.some(g => !g.ok)) return null;
    if (call.kind === 0 && gas.some(g => g.value !== undefined)) return null;
    calls.push({ kind: call.kind, to: to ?? undefined, data, value, gasRefTime: gas[0].value, gasProofSize: gas[1].value, storageDepositLimit: gas[2].value });
  }
  const d = tx.display;
  if (!isRecord(d) || !shortString(d.title, MAX_TITLE, { empty: false })) return null;
  if (d.description !== undefined && !shortString(d.description, MAX_DESCRIPTION)) return null;
  for (const key of ['amount', 'asset'] as const) if (d[key] != null && !shortString(d[key], 64, { empty: false })) return null;
  return {
    version: TX_INTENT_VERSION,
    chainId: (tx.chainId as string).toLowerCase(),
    calls,
    display: {
      title: d.title,
      description: typeof d.description === 'string' ? d.description : '',
      amount: typeof d.amount === 'string' ? d.amount : undefined,
      asset: typeof d.asset === 'string' ? d.asset : undefined,
    },
    dryRunRequired: true,
    expiresAt,
  };
};
