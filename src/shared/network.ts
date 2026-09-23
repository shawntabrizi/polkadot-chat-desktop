/**
 * Network profiles, shared by the main process (identity registration, chain
 * reads) and the renderer (chat). `devnet` is the default because the bots in
 * `.refs/polkadot-chat-agents` run there; `paseo` is the public testnet.
 */

export type NetworkProfileId = 'devnet' | 'paseo';

/**
 * How a username claim is authorised, from `.refs/bot-core/lib/network-config.mjs`:
 * `client-proof` mints a bearer session with the wallet key (Products Devnet);
 * `none` sends the claim without one (the Paseo backend has no challenge endpoint).
 */
export type IdentityRegistrationAuth = 'client-proof' | 'none';

export type NetworkProfile = {
  id: NetworkProfileId;
  label: string;
  /** People-chain RPC endpoints; the WS provider tries them in order. */
  peopleEndpoints: readonly string[];
  /** Base URL of the identity backend (username search and registration). */
  identityBackend: string;
  identityRegistrationAuth: IdentityRegistrationAuth;
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
    identityRegistrationAuth: 'client-proof',
  },
  paseo: {
    id: 'paseo',
    label: 'Paseo',
    peopleEndpoints: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    identityBackend: 'https://identity-backend-next.parity-testnet.parity.io',
    identityRegistrationAuth: 'none',
  },
};

export const DEFAULT_NETWORK_PROFILE: NetworkProfileId = 'devnet';

export const isNetworkProfileId = (value: unknown): value is NetworkProfileId =>
  value === 'devnet' || value === 'paseo';
