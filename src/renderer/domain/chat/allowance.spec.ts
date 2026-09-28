import { describe, expect, it, vi } from 'vitest';

import { allowanceStorageKey, readAllowance } from './allowance';

// M10a: the start-up read decides whether a phone sign-in sees "open the app
// on your phone" before its first send fails. It must read the key the node
// checks for THIS device's statement account, and a missing value must read
// as "no allowance".

const account = new Uint8Array(32).fill(0xab);

describe('allowance', () => {
  it('reads the node key :statement_allowance: ++ account', () => {
    const prefix = Buffer.from(':statement_allowance:').toString('hex');
    expect(allowanceStorageKey(account)).toBe(`0x${prefix}${'ab'.repeat(32)}`);
  });

  it('is present only when the key holds a value at the best block', async () => {
    const request = vi.fn(async () => '0x3200000000d00700');
    expect(await readAllowance(request, account)).toBe(true);
    // No block hash: the node answers at its best block (PLAN.md "Best block first").
    expect(request).toHaveBeenCalledWith('state_getStorage', [allowanceStorageKey(account)]);
    expect(await readAllowance(async () => null, account)).toBe(false);
    expect(await readAllowance(async () => '0x', account)).toBe(false);
  });

  it('passes a failed read on (the caller changes nothing)', async () => {
    await expect(readAllowance(async () => Promise.reject(new Error('socket closed')), account)).rejects.toThrow('socket closed');
  });
});
