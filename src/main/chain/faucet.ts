/**
 * The embedded Faucet's "Get 1 PAS" (owner ruling, M12): the app itself sends
 * 1 PAS on devnet Asset Hub from a Substrate dev account to the identity. No
 * bot and no chat: the Faucet is a local contact whose logic runs here, in
 * the main process.
 *
 * The dev accounts come from the public Substrate development phrase. It is
 * not a secret (every Substrate dev chain uses it), but it stays in
 * `src/main`, and it is used only on the devnet Asset Hub (its genesis hash
 * below): nowhere else do these accounts hold funds of ours to give.
 */

import { MultiAddress } from '@polkadot-api/descriptors';
import { mnemonicToMiniSecret, ss58Address } from '@polkadot-labs/hdkd-helpers';
import type { TxEvent } from 'polkadot-api';
import { getTxCreator } from 'polkadot-api/tx-creator';

import { READ_TIMEOUT_MS, retryOnNextEndpoint, withTimeout } from '../../shared/chainRead';
import type { FaucetDrip, TxStatusEvent } from '../../shared/desktop-api';
import { NETWORK_PROFILES } from '../../shared/network';
import { deriveSr25519PairFromSeed } from '../identity/crypto';

import { type AssetHubChain, CUSTOM_EXTENSIONS, dispatchErrorText } from './assetHub';

/** Devnet Asset Hub: the only chain the in-app faucet runs on. */
export const DEVNET_ASSET_HUB_GENESIS = NETWORK_PROFILES.devnet.assetHub?.genesis ?? '';

/** The public Substrate development phrase (`//Alice` … `//Ferdie`). Public, not a secret. */
const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
export const DEV_ACCOUNTS = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Ferdie'] as const;
export type DevAccount = (typeof DEV_ACCOUNTS)[number];

/** 1 PAS (10 decimals). */
export const DRIP_PLANCK = 10_000_000_000n;
/** A source must hold this much: the drip, the fee and the existential deposit, with margin. */
export const SOURCE_MIN_PLANCK = 15_000_000_000n;

export const NO_SOURCE = 'All devnet faucet accounts are empty.';
export const DEVNET_ONLY = 'The in-app faucet runs on devnet Asset Hub only.';

/** `faucet:drip` takes a chain id; only devnet Asset Hub is allowed. */
export const assertDevnetChain = (chainId: unknown): string => {
  if (typeof chainId !== 'string' || chainId.toLowerCase() !== DEVNET_ASSET_HUB_GENESIS.toLowerCase()) throw new Error(DEVNET_ONLY);
  return chainId;
};

/** The first dev account, in the fixed order, that holds at least 1.5 PAS; null when all are drained. */
export const pickSource = (balances: readonly { account: DevAccount; free: bigint }[]): DevAccount | null =>
  DEV_ACCOUNTS.find(account => (balances.find(entry => entry.account === account)?.free ?? 0n) >= SOURCE_MIN_PLANCK) ?? null;

/** A public dev account's pair. M15a also signs the devnet Bulletin grant with `//Eve` (chain/bulletin.ts). */
export const devPair = (account: DevAccount) => deriveSr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE), `//${account}`);

const readFree = (chain: AssetHubChain, address: string): Promise<bigint> =>
  retryOnNextEndpoint(
    () => withTimeout(chain.api.query.System.Account.getValue(address, { at: 'best' }), READ_TIMEOUT_MS, 'faucet balance').then(account => account.data.free),
    chain.switchEndpoint,
  );

/**
 * Sends 1 PAS to `to` (32-byte account) from the first funded dev account:
 * balances read at the best block, a dry-run of the very transfer first,
 * then sign and submit. Resolves with the hash once broadcast; later states
 * go to `onStatus` (in block at the first best block, finality after).
 */
export async function dripDevnet(chain: AssetHubChain, chainId: string, to: Uint8Array, onStatus: (event: TxStatusEvent) => void): Promise<FaucetDrip> {
  assertDevnetChain(chainId);
  if (chain.genesis.toLowerCase() !== DEVNET_ASSET_HUB_GENESIS.toLowerCase()) throw new Error(DEVNET_ONLY);
  if (to.length !== 32) throw new Error('Invalid account.');
  const balances = await Promise.all(
    DEV_ACCOUNTS.map(async account => ({ account, free: await readFree(chain, ss58Address(devPair(account).publicKey, 42)) })),
  );
  const account = pickSource(balances);
  if (!account) throw new Error(NO_SOURCE);
  const pair = devPair(account);
  const origin = ss58Address(pair.publicKey, 42);
  const tx = chain.api.tx.Balances.transfer_keep_alive({ dest: MultiAddress.Id(ss58Address(to, 42)), value: DRIP_PLANCK });
  const dry = await retryOnNextEndpoint(
    () =>
      withTimeout(
        chain.api.apis.DryRunApi.dry_run_call({ type: 'system', value: { type: 'Signed', value: origin } } as never, tx.decodedCall as never, 5, { at: 'best' }),
        READ_TIMEOUT_MS,
        'faucet dry-run',
      ),
    chain.switchEndpoint,
  );
  if (!dry.success) throw new Error('The chain could not test the transfer.');
  if (!dry.value.execution_result.success) throw new Error(`The transfer would fail: ${dispatchErrorText(dry.value.execution_result.value.error as never)}.`);

  const from = `//${account}`;
  const creator = getTxCreator(pair.publicKey, 'Sr25519', pair.sign);
  return new Promise((resolve, reject) => {
    let hash: string | null = null;
    let settled = false;
    const subscription = tx.createSubmitAndWatch(creator, { customSignedExtensions: CUSTOM_EXTENSIONS } as never).subscribe({
      next: (event: TxEvent) => {
        hash = event.txHash;
        switch (event.type) {
          case 'created':
            return;
          case 'broadcasted':
            onStatus({ hash: event.txHash, status: 'submitted', block: null, error: null });
            if (!settled) {
              settled = true;
              resolve({ hash: event.txHash, from, chainId: chain.genesis });
            }
            return;
          case 'inBestBlock':
            onStatus(
              event.ok
                ? { hash: event.txHash, status: 'inBlock', block: event.block.number, error: null }
                : { hash: event.txHash, status: 'failed', block: event.block.number, error: dispatchErrorText(event.dispatchError as never) },
            );
            return;
          case 'notInBestBlock':
            onStatus({ hash: event.txHash, status: 'submitted', block: null, error: null });
            return;
          case 'finalized':
            onStatus(
              event.ok
                ? { hash: event.txHash, status: 'finalized', block: event.block.number, error: null }
                : { hash: event.txHash, status: 'failed', block: event.block.number, error: dispatchErrorText(event.dispatchError as never) },
            );
            subscription.unsubscribe();
            return;
        }
      },
      error: (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (hash) onStatus({ hash, status: 'failed', block: null, error: message });
        if (!settled) {
          settled = true;
          reject(new Error(`The transfer was not accepted: ${message}`));
        }
      },
    });
  });
}
