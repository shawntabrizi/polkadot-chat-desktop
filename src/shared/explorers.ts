/**
 * Block explorers for "View on …" (M12c step 10): per chain (its genesis
 * hash), the base URL each explorer uses. Links only: the Subscan HTTP API
 * needs a key and is never called.
 *
 * Checked 2026-09-23: devnet Asset Hub (genesis 0xd6ee…1ef2) is the public
 * Paseo Asset Hub on Subscan (block #13622982 has the same hash there as on
 * our RPC). People: people-paseo.subscan.io (genesis 0xe6c3…86ec).
 *
 * Browser-safe: no Node imports.
 */

export type ExplorerId = 'subscan' | 'polkadotjs';

export const EXPLORERS: readonly ExplorerId[] = ['subscan', 'polkadotjs'];
export const DEFAULT_EXPLORER: ExplorerId = 'subscan';

export const EXPLORER_LABELS: Record<ExplorerId, string> = {
  subscan: 'Subscan',
  polkadotjs: 'Polkadot.js Apps',
};

export const isExplorerId = (value: unknown): value is ExplorerId => value === 'subscan' || value === 'polkadotjs';

/** One chain as each explorer knows it; a missing field: that explorer does not know the chain. */
type ChainExplorers = { subscan?: string; rpc?: string };

const CHAINS: Record<string, ChainExplorers> = {
  // Paseo Asset Hub (devnet profile's Asset Hub).
  '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2': {
    subscan: 'https://assethub-paseo.subscan.io',
    rpc: 'wss://asset-hub-paseo-rpc.n.dwellir.com',
  },
  // Paseo People (devnet profile's People chain).
  '0xe6c30d6e148f250b887105237bcaa5cb9f16dd203bf7b5b9d4f1da7387cb86ec': {
    subscan: 'https://people-paseo.subscan.io',
    rpc: 'wss://people-paseo.rotko.net',
  },
};

/** A link to open, or why there is none (the button is shown disabled with this as its tooltip). */
export type ExplorerLink = { url: string } | { unavailable: string };

const chainOf = (chainId: string): ChainExplorers => CHAINS[chainId.toLowerCase()] ?? {};

const pjs = (rpc: string, route: string): string => `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(rpc)}#/${route}`;

/**
 * A transaction: Subscan's extrinsic page; Polkadot.js Apps' block page for
 * the block that holds it (it takes a block, not an extrinsic), else a
 * search for the extrinsic hash.
 */
export const transactionLink = (explorer: ExplorerId, chainId: string, hash: string, block: number | null): ExplorerLink => {
  const chain = chainOf(chainId);
  if (explorer === 'subscan') {
    return chain.subscan ? { url: `${chain.subscan}/extrinsic/${hash}` } : { unavailable: 'Subscan does not list this network.' };
  }
  return chain.rpc ? { url: pjs(chain.rpc, `explorer/query/${block ?? hash}`) } : { unavailable: 'No public endpoint is known for this network.' };
};

/** An account (SS58): Subscan's account page. Polkadot.js Apps has no page for one account. */
export const accountLink = (explorer: ExplorerId, chainId: string, address: string): ExplorerLink => {
  const chain = chainOf(chainId);
  if (explorer === 'polkadotjs') return { unavailable: 'Polkadot.js Apps has no page for one account. Choose Subscan in Settings.' };
  return chain.subscan ? { url: `${chain.subscan}/account/${address}` } : { unavailable: 'Subscan does not list this network.' };
};
