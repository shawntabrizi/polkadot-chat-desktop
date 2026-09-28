/**
 * M10a: does this device's statement account have a Statement Store
 * allowance? The node reads it from the well-known storage key
 * `:statement_allowance:` ++ account (efficiency.md "Allowance facts"; the
 * e2e scripts read the same key). For a phone sign-in the phone writes it
 * (`set_statement_store_account`, a 1-day slot it renews hourly), so a
 * missing key means the phone has not added or has stopped renewing this
 * device. Read at the best block: `state_getStorage` without a block hash.
 */

import { bytesToHex } from '../../app/bytes';

const PREFIX = new TextEncoder().encode(':statement_allowance:');

export const allowanceStorageKey = (account: Uint8Array): string => {
  const key = new Uint8Array(PREFIX.length + account.length);
  key.set(PREFIX);
  key.set(account, PREFIX.length);
  return bytesToHex(key);
};

/** An RPC call in the shape `LazyClient.getRequestFn()` returns. */
export type RpcRequest = (method: string, params: unknown[]) => Promise<unknown>;

/** True when the key holds a value at the best block. Rejects when the node does not answer. */
export const readAllowance = async (request: RpcRequest, account: Uint8Array): Promise<boolean> => {
  const value = await request('state_getStorage', [allowanceStorageKey(account)]);
  return typeof value === 'string' && value.length > 2;
};

/**
 * M22b: the allowance's size, `StatementAllowance { max_count: u32, max_size: u32 }`
 * little-endian (sp-statement-store). Null when there is none or the value
 * has another length. Assumption, not checked against a live phone slot:
 * the value is exactly that pair (the coordinator saw max_count 2, 500 KiB).
 */
export const readAllowanceLimit = async (request: RpcRequest, account: Uint8Array): Promise<{ maxCount: number; maxSize: number } | null> => {
  const value = await request('state_getStorage', [allowanceStorageKey(account)]);
  if (typeof value !== 'string' || !/^0x[0-9a-f]{16}$/i.test(value)) return null;
  const word = (at: number) => Number.parseInt(value.slice(2 + at * 2, 2 + at * 2 + 8).match(/../g)!.reverse().join(''), 16);
  return { maxCount: word(0), maxSize: word(4) };
};

/** M22b: at or below this many statements, device sync waits for undelivered sends (engine.ts). */
export const TIGHT_ALLOWANCE_COUNT = 4;

/** How often a running app reads the allowance again (the phone renews hourly). */
export const ALLOWANCE_RECHECK_MS = 10 * 60_000;
