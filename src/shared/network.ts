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
  /**
   * Spec 0012 attachments: the Bulletin chain of this network (RPC endpoints
   * in order, its genesis hash, which `Store.bulletin.genesis` must name, and
   * the HTTPS IPFS gateway prefix, the last fetch fallback). Null: this
   * profile cannot send or fetch attachments.
   */
  bulletin: { endpoints: readonly string[]; genesis: string; gateway: string } | null;
  /**
   * Base spec HOP: the nodes a phone app's attachment may name on this
   * network (pca's `hopEndpoints`, bot-core/lib/network-config.mjs). The app
   * opens no other node a message names.
   */
  hopNodes: readonly string[];
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
    // Bulletin Paseo, para 1010 (bulletin-paseo 2004000 on 2026-09-24,
    // docs/reference/bulletin-and-media.md); endpoints and gateway from
    // .refs/polkadot-app-deploy and bulletin-deploy environments.
    bulletin: {
      endpoints: ['wss://bullet.sik.rocks', 'wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.tunastaking.eu'],
      genesis: '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59',
      gateway: 'https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/',
    },
    hopNodes: ['wss://bullet.sik.rocks', 'wss://bulletin-paseo.tservices.es:8443', 'wss://bullet.tunastaking.eu'],
  },
  paseo: {
    id: 'paseo',
    label: 'Paseo',
    peopleEndpoints: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    identityBackend: 'https://identity-backend-next.parity-testnet.parity.io',
    identityRegistrationAuth: 'none',
    // Paseo Next has its own Asset Hub; no descriptors for it yet (M11 is devnet only).
    assetHub: null,
    // Paseo Bulletin Next (para 1501) has no descriptors here and no authorizer for
    // this identity (spec 0012 Unresolved 1): no attachments on this profile yet.
    bulletin: null,
    hopNodes: ['wss://paseo-hop-next-0.polkadot.io', 'wss://paseo-hop-next-1.polkadot.io'],
  },
};

export const DEFAULT_NETWORK_PROFILE: NetworkProfileId = 'devnet';

export const isNetworkProfileId = (value: unknown): value is NetworkProfileId =>
  value === 'devnet' || value === 'paseo';
