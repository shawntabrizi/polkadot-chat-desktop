/**
 * The identity's balance on the People chain, for the Pocket (M11b step 2).
 * Chat on the People chain needs no funds (statements are free for a
 * person), so an empty account there is normal and shown as such. Read at
 * the best block through the chat connection the app already holds.
 */

import { READ_TIMEOUT_MS, awaitBestRuntime, retryOnNextEndpoint, withTimeout } from '../../../shared/chainRead';
import type { LookupConnection } from '../identity/lookup';

type AccountEntry = { getValue: (address: string, options: { at: 'best' }) => Promise<{ data: { free: bigint } }> };

/** Free balance in planck of `address` (SS58) on the People chain, at the best block. */
export const readPeopleFree = async ({ lazyClient, switchEndpoint }: LookupConnection, address: string): Promise<bigint> => {
  const read = async () => {
    const client = lazyClient.getClient();
    await awaitBestRuntime(client);
    const account = (client.getUnsafeApi().query as unknown as { System: { Account: AccountEntry } }).System.Account;
    return (await withTimeout(account.getValue(address, { at: 'best' }), READ_TIMEOUT_MS, 'people balance')).data.free;
  };
  return retryOnNextEndpoint(read, switchEndpoint);
};
