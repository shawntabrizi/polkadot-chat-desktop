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

/** `GET {identityBackend}/api/v1/usernames?prefix=<q>&status=ASSIGNED` */
export const usernameSearchUrl = (profile: NetworkProfile, prefix: string): string => {
  const url = new URL('/api/v1/usernames', profile.identityBackend);
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('status', 'ASSIGNED');
  return url.toString();
};
