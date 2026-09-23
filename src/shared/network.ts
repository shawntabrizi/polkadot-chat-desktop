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
  /**
   * Spec 0007 transactions and contract reads: the Asset Hub of this network
   * (RPC endpoints in order, and the genesis hash a `TxIntent.chainId` must
   * name). Null: this profile cannot run chain actions.
   */
  assetHub: { endpoints: readonly string[]; genesis: string } | null;
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
    // Paseo Asset Hub (asset-hub-paseo 2005002 on 2026-09-23); endpoints
    // from .refs/polkadot-app-deploy environments.
    assetHub: {
      endpoints: ['wss://asset-hub-paseo-rpc.n.dwellir.com', 'wss://sys.turboflakes.io/asset-hub-paseo', 'wss://sys.ibp.network/asset-hub-paseo'],
      genesis: '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2',
    },
  },
  paseo: {
    id: 'paseo',
    label: 'Paseo',
    peopleEndpoints: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    identityBackend: 'https://identity-backend-next.parity-testnet.parity.io',
    identityRegistrationAuth: 'none',
    // Paseo Next has its own Asset Hub; no descriptors for it yet (M11 is devnet only).
    assetHub: null,
  },
};

export const DEFAULT_NETWORK_PROFILE: NetworkProfileId = 'devnet';

export const isNetworkProfileId = (value: unknown): value is NetworkProfileId =>
  value === 'devnet' || value === 'paseo';
