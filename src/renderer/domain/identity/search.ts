/**
 * Username search against the identity backend. Mirrors
 * polkadot-desktop src/domains/chat/p2p/peer/gateway.ts (`searchUsernames`)
 * and peer/service.ts (self exclusion).
 */

import { AccountId } from '@polkadot-api/substrate-bindings';

import { bytesEqual } from '../../app/bytes';
import { type NetworkProfile, usernameSearchUrl } from '../../app/network';

export type SearchResult = {
  /** SS58 as the backend minted it; decoded to bytes for everything else. */
  candidateAccountId: string;
  accountId: Uint8Array;
  username: string;
};

const ss58ToBytes = AccountId().enc;

// The backend response is a trust boundary: rows missing a field this app
// reads are dropped, extra fields are ignored.
const parseRow = (row: unknown): SearchResult | null => {
  if (typeof row !== 'object' || row === null) return null;
  const { candidateAccountId, username } = row as Record<string, unknown>;
  if (typeof candidateAccountId !== 'string' || typeof username !== 'string') return null;
  try {
    return { candidateAccountId, accountId: ss58ToBytes(candidateAccountId), username };
  } catch {
    return null;
  }
};

export const searchUsernames = async (
  profile: NetworkProfile,
  prefix: string,
  selfIdentityAccountId: Uint8Array,
  fetchFn: typeof fetch = fetch,
): Promise<SearchResult[]> => {
  const response = await fetchFn(usernameSearchUrl(profile, prefix), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`username search failed: ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('username search: unexpected response shape');
  return body
    .map(parseRow)
    .filter((row): row is SearchResult => row !== null)
    // Usernames resolve to the identity account, so a search for our own name
    // returns us. Self-chat is not a flow; drop it.
    .filter(row => !bytesEqual(row.accountId, selfIdentityAccountId));
};
