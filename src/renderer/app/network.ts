/**
 * Network profiles. The table lives in `src/shared/network.ts` so the main
 * process (identity registration) and the renderer read one source.
 */

import type { NetworkProfile } from '../../shared/network';

export {
  DEFAULT_NETWORK_PROFILE,
  NETWORK_PROFILES,
  isNetworkProfileId,
  type NetworkProfile,
  type NetworkProfileId,
} from '../../shared/network';

/** How many rows one search asks for when the caller does not say. */
const SEARCH_PAGE_SIZE = 50;

/**
 * `GET {identityBackend}/api/v1/usernames/search?prefix=<q>&limit=<n>[&cursor=<c>]`.
 * The older `/usernames?prefix=` list is retired on the backends (404, checked
 * 2026-09-23; see .refs/bot-core/lib/register.mjs `searchUsernames`). A page
 * answers with `nextCursor` for the next one (checked live 2026-09-23).
 */
export const usernameSearchUrl = (profile: NetworkProfile, prefix: string, page: { limit?: number; cursor?: string | null } = {}): string => {
  const url = new URL('/api/v1/usernames/search', profile.identityBackend);
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('limit', String(page.limit ?? SEARCH_PAGE_SIZE));
  if (page.cursor) url.searchParams.set('cursor', page.cursor);
  return url.toString();
};

/** `POST {identityBackend}/api/v1/poc/issue`: a proof-of-compute puzzle for the search. */
export const proofOfComputeUrl = (profile: NetworkProfile): string => new URL('/api/v1/poc/issue', profile.identityBackend).toString();
