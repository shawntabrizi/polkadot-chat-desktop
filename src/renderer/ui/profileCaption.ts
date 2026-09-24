import { NETWORK_PROFILES } from '../app/network';

import type { ProfileRow } from '../../shared/desktop-api';

/** M18: the second line of a profile row: who it is on which network, and where it is open. */
export const profileCaption = (row: ProfileRow): string => {
  const network = row.network ? NETWORK_PROFILES[row.network].label : 'Unknown network';
  // A renamed profile still shows whose it is; an unrenamed one is already titled by the username.
  const who = !row.username ? 'Not signed up yet' : row.username === row.label ? network : `${row.username} · ${network}`;
  if (row.current) return `${who} · This window`;
  if (row.running) return `${who} · Open in another window`;
  return who;
};
