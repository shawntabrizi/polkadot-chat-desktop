/**
 * Network profiles. `devnet` is the default because the bots in
 * `.refs/polkadot-chat-agents` run there; `paseo` is the public testnet.
 */

export type NetworkProfileId = 'devnet' | 'paseo';

export type NetworkProfile = {
  id: NetworkProfileId;
  label: string;
  /** People-chain RPC endpoints; the WS provider tries them in order. */
  peopleEndpoints: readonly string[];
  /** Base URL of the identity backend (username search). */
  identityBackend: string;
};

export const NETWORK_PROFILES: Record<NetworkProfileId, NetworkProfile> = {
  devnet: {
    id: 'devnet',
    label: 'Devnet',
    peopleEndpoints: [
      'wss://people-paseo.rotko.net',
      'wss://rpc.interweb-it.com/people-paseo',
      'wss://people-paseo.gatotech.network',
    ],
    identityBackend: 'https://polkadot-app.api.polkadotcommunity.foundation',
  },
  paseo: {
    id: 'paseo',
    label: 'Paseo',
    peopleEndpoints: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    identityBackend: 'https://identity-backend-next.parity-testnet.parity.io',
  },
};

export const DEFAULT_NETWORK_PROFILE: NetworkProfileId = 'devnet';

export const isNetworkProfileId = (value: unknown): value is NetworkProfileId =>
  value === 'devnet' || value === 'paseo';

/** `GET {identityBackend}/api/v1/usernames?prefix=<q>&status=ASSIGNED` */
export const usernameSearchUrl = (profile: NetworkProfile, prefix: string): string => {
  const url = new URL('/api/v1/usernames', profile.identityBackend);
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('status', 'ASSIGNED');
  return url.toString();
};
