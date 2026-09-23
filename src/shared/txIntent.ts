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
