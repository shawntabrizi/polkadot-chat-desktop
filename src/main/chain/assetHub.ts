/**
 * Devnet Asset Hub for spec 0007 transactions: dry-run, sign, submit, watch,
 * and contract reads, over polkadot-api with the generated `assetHubPaseo`
 * descriptors (`.papi/`). No ETH-RPC: Substrate extrinsics and runtime APIs.
 *
 * PLAN.md "Best block first": every read and dry-run is at the best block; a
 * transaction reports "in block" at the first best block that holds it, and
 * finality is a later state, never a wait.
 *
 * Rules this module enforces, not the renderer (spec 0007 client rules):
 * - nothing is signed without a dry-run of the very same intent bytes: `sign`
 *   takes the id a successful `dryRun` returned, and only for a short time;
 * - the intent is decoded and checked here again (the renderer shows remote
 *   content);
 * - `Revive.map_account` is prepended when the signer is not mapped yet.
 */

import { randomUUID } from 'node:crypto';

import { assetHubPaseo } from '@polkadot-api/descriptors';
import { compact } from '@polkadot-api/substrate-bindings';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { type PolkadotClient, type TxEvent, createClient } from 'polkadot-api';
import { getTxCreator } from 'polkadot-api/tx-creator';
import { getWsProvider } from 'polkadot-api/ws';
import type { Subscription } from 'rxjs';

import { READ_TIMEOUT_MS, awaitBestRuntime, retryOnNextEndpoint, withTimeout } from '../../shared/chainRead';
import type { AccountBalance, BestBlock, TxDryRun, TxStatusEvent } from '../../shared/desktop-api';
import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';
import { CALL_KIND_REVIVE, type TxCall, type TxIntent, decodeTxIntent, formatUnits, intentProblem } from '../../shared/txIntent';
import { metadataCache } from '../metadataCache';

const typedApi = (client: PolkadotClient) => client.getTypedApi(assetHubPaseo);
type Tx = ReturnType<ReturnType<typeof typedApi>['tx']['Revive']['map_account']>;

export type AssetHubChain = {
  genesis: string;
  client: PolkadotClient;
  api: ReturnType<typeof typedApi>;
  switchEndpoint: () => void;
  destroy: () => void;
};

/** The identity wallet key: the account that signs (the chat identity's account). */
export type TxSigner = { publicKey: Uint8Array; sign: (message: Uint8Array) => Uint8Array };

const AT_BEST = { at: 'best' } as const;
/** A dry-run may be signed this long after it ran; later the chain may have moved on. */
export const DRY_RUN_VALID_MS = 120_000;
/** Weight and storage-deposit limits are the dry-run's estimate plus this share. */
const MARGIN_PERCENT = 20n;
/** Asset Hub's extension without a default (a bool): false, the "not used" value. */
const CUSTOM_EXTENSIONS = { RestrictOrigins: { value: false } } as const;
/** `ReturnFlags::REVERT` of pallet-revive. */
const REVERT_FLAG = 1;

// ── Connection ──────────────────────────────────────────────────────────────

/** Opens devnet Asset Hub for the profile and waits for the first best block's runtime. */
export async function openAssetHub(profileId: NetworkProfileId): Promise<AssetHubChain> {
  const profile = NETWORK_PROFILES[profileId];
  if (!profile.assetHub) throw new Error(`The ${profile.label} network has no Asset Hub connection in this app.`);
  const provider = getWsProvider([...profile.assetHub.endpoints]);
  const client = createClient(provider, metadataCache());
  const chain: AssetHubChain = {
    genesis: profile.assetHub.genesis,
    client,
    api: typedApi(client),
    switchEndpoint: () => provider.switch(),
    destroy: () => client.destroy(),
  };
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(client), chain.switchEndpoint);
  } catch (error) {
    client.destroy();
    throw error;
  }
  return chain;
}

const read = <T>(chain: AssetHubChain, label: string, fn: () => Promise<T>): Promise<T> =>
  retryOnNextEndpoint(() => withTimeout(fn(), READ_TIMEOUT_MS, label), chain.switchEndpoint);

// ── Small codecs ────────────────────────────────────────────────────────────

const hex = (bytes: Uint8Array): `0x${string}` => `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (value: string): Uint8Array => {
  const clean = value.replace(/^0x/i, '');
  return Uint8Array.from(clean.match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);
};
const withMargin = (value: bigint): bigint => value + (value * MARGIN_PERCENT) / 100n + 1n;

/** Solidity `Error(string)` and `Panic(uint256)`, else the selector; for the strip. */
export const revertReason = (data: Uint8Array): string => {
  const selector = hex(data.slice(0, 4));
  if (selector === '0x08c379a0' && data.length >= 68) {
    const length = Number(BigInt(hex(data.slice(36, 68))));
    const text = new TextDecoder().decode(data.slice(68, 68 + length)).trim();
    if (text) return text;
  }
  if (selector === '0x4e487b71' && data.length >= 36) return `the contract stopped (panic ${Number(BigInt(hex(data.slice(4, 36))))})`;
  if (data.length === 0) return 'the contract refused the call';
  return `the contract refused the call (error ${selector})`;
};

type DispatchErrorLike = { type: string; value?: unknown };

/** `Module(Balances(InsufficientBalance))` → "Balances.InsufficientBalance"; plain words for the common ones. */
export const dispatchErrorText = (error: DispatchErrorLike | undefined): string => {
  if (!error) return 'the chain refused it';
  if (error.type === 'Module') {
    const pallet = error.value as DispatchErrorLike | undefined;
    const inner = pallet?.value as DispatchErrorLike | undefined;
    const name = `${pallet?.type ?? 'Module'}.${inner?.type ?? 'Error'}`;
    if (/InsufficientBalance|FundsUnavailable|StorageDepositNotEnoughFunds|TransferFailed/.test(name)) return `not enough funds (${name})`;
    if (name === 'Revive.ContractReverted') return 'the contract refused the call';
    return name;
  }
  if (error.type === 'Token') return `not enough funds (Token.${String((error.value as DispatchErrorLike | undefined)?.type ?? '')})`;
  return error.type;
};

// ── Building the call ───────────────────────────────────────────────────────

type ReviveEstimate = { returnData: Uint8Array; refTime: bigint; proofSize: bigint; deposit: bigint };

/** `ReviveApi_call` at the best block: the result, the weight it needs, the storage deposit it charges. */
async function estimateRevive(chain: AssetHubChain, origin: string, call: TxCall): Promise<ReviveEstimate | { revert: string }> {
  const to = call.to;
  if (!to) return { revert: 'no contract address' };
  const result = await read(chain, 'contract dry-run', () =>
    chain.api.apis.ReviveApi.call(origin, hex(to), call.value, undefined, undefined, call.data, AT_BEST),
  );
  if (!result.result.success) return { revert: dispatchErrorText(result.result.value as DispatchErrorLike) };
  const { flags, data } = result.result.value;
  if ((flags & REVERT_FLAG) !== 0) return { revert: revertReason(data) };
  const charge = (deposit: { type: string; value: bigint }): bigint => (deposit.type === 'Charge' ? deposit.value : 0n);
  const deposit = [charge(result.storage_deposit), charge(result.max_storage_deposit)].reduce((a, b) => (a > b ? a : b));
  return { returnData: data, refTime: result.weight_required.ref_time, proofSize: result.weight_required.proof_size, deposit };
}

/** Whether pallet-revive knows the account's H160 (map_account ran, or AutoMap mapped it). */
async function isMapped(chain: AssetHubChain, origin: string): Promise<boolean> {
  const address = await read(chain, 'revive address', () => chain.api.apis.ReviveApi.address(origin, AT_BEST));
  const original = await read(chain, 'revive mapping', () => chain.api.query.Revive.OriginalAccount.getValue(address, AT_BEST));
  return original != null;
}

type Built = { tx: Tx; mapsAccount: boolean; returnData: Uint8Array | null };

/** The extrinsic for the intent: one call, or `Utility.batch_all` of several (map_account first when needed). */
async function buildTx(chain: AssetHubChain, origin: string, intent: TxIntent, needsMapping: boolean): Promise<Built | { revert: string }> {
  const calls: Tx[] = [];
  let returnData: Uint8Array | null = null;
  const hasRevive = intent.calls.some(call => call.kind === CALL_KIND_REVIVE);
  const mapsAccount = hasRevive && needsMapping;
  if (mapsAccount) calls.push(chain.api.tx.Revive.map_account());
  for (const call of intent.calls) {
    if (call.kind === CALL_KIND_REVIVE) {
      const estimate = await estimateRevive(chain, origin, call);
      if ('revert' in estimate) return estimate;
      returnData = estimate.returnData;
      calls.push(
        chain.api.tx.Revive.call({
          dest: hex(call.to ?? new Uint8Array()),
          value: call.value,
          weight_limit: { ref_time: withMargin(estimate.refTime), proof_size: withMargin(estimate.proofSize) },
          storage_deposit_limit: withMargin(estimate.deposit),
          data: call.data,
        }) as unknown as Tx,
      );
    } else {
      const decoded = await chain.api.txFromCallData(call.data, AT_BEST);
      calls.push(decoded as unknown as Tx);
    }
  }
  const [only] = calls;
  const tx = calls.length === 1 && only ? only : (chain.api.tx.Utility.batch_all({ calls: calls.map(entry => entry.decodedCall) } as never) as unknown as Tx);
  return { tx, mapsAccount, returnData };
}

// ── The service: dry-run, sign, watch ───────────────────────────────────────

export type TxService = {
  /** Checks, dry-runs and prices the intent at the best block; never throws for a refusal (`ok: false`). */
  dryRun: (intentBytes: Uint8Array) => Promise<TxDryRun>;
  /** Signs and submits a successful dry-run by its id; resolves with the hash once it is broadcast. */
  sign: (dryRunId: string) => Promise<{ hash: string }>;
  /** The latest known state of a transaction this service submitted. */
  status: (hash: string) => TxStatusEvent | null;
  onStatus: (listener: (event: TxStatusEvent) => void) => () => void;
  /**
   * `ReviveApi_call` of `calldata` on `address` from the signer, at the best
   * block: the return data. `chainId` must be this chain's genesis hash (a
   * spec 0008 hint names the chain it reads).
   */
  contractRead: (chainId: string, address: string, calldata: Uint8Array) => Promise<Uint8Array>;
  /** The signer's account at the best block, planck as decimal strings (M11b balance chip). */
  balance: () => Promise<AccountBalance>;
  /** Every new best block of this chain (number), once each; returns the unsubscribe function. */
  onBestBlock: (listener: (block: BestBlock) => void) => () => void;
  address: string;
  dispose: () => void;
};

type PendingDryRun = { intent: TxIntent; at: number };

export function createTxService(chain: AssetHubChain, signer: TxSigner, now: () => number = Date.now): TxService {
  const origin = ss58Address(signer.publicKey, 42);
  const dryRuns = new Map<string, PendingDryRun>();
  const statuses = new Map<string, TxStatusEvent>();
  const listeners = new Set<(event: TxStatusEvent) => void>();
  const watches = new Set<Subscription>();
  // Mapped once: remembered for this run (spec 0007 client rule 4).
  let mapped = false;

  const emit = (event: TxStatusEvent) => {
    const current = statuses.get(event.hash);
    // Finalized and failed are the last word; a late event does not undo them.
    if (current && (current.status === 'finalized' || current.status === 'failed')) return;
    statuses.set(event.hash, event);
    for (const listener of listeners) listener(event);
  };

  const needsMapping = async (): Promise<boolean> => {
    if (mapped) return false;
    mapped = await isMapped(chain, origin);
    return !mapped;
  };

  const refusal = (error: string, extra: Partial<TxDryRun> = {}): TxDryRun => ({
    id: null,
    ok: false,
    signer: origin,
    fee: null,
    mapsAccount: false,
    returnData: null,
    value: '0',
    error,
    ...extra,
  });

  const dryRun = async (intentBytes: Uint8Array): Promise<TxDryRun> => {
    const intent = decodeTxIntent(intentBytes);
    if (!intent) return refusal('This action cannot be read.');
    const problem = intentProblem(intent, { chainIds: [chain.genesis], now: now() });
    if (problem) return refusal(problem);
    const value = intent.calls.reduce((sum, call) => sum + call.value, 0n);
    const built = await buildTx(chain, origin, intent, await needsMapping());
    if ('revert' in built) return refusal(`The test run failed: ${built.revert}.`, { value: String(value) });
    const { tx, mapsAccount, returnData } = built;
    // The whole extrinsic (batch and all), as the signer's origin, at the best block.
    const dry = await read(chain, 'dry-run', () =>
      chain.api.apis.DryRunApi.dry_run_call({ type: 'system', value: { type: 'Signed', value: origin } } as never, tx.decodedCall as never, 5, AT_BEST),
    );
    const base = { signer: origin, mapsAccount, returnData: returnData ? hex(returnData) : null, value: String(value) };
    if (!dry.success) return refusal('The chain could not test this action.', base);
    if (!dry.value.execution_result.success) {
      return refusal(`The test run failed: ${dispatchErrorText(dry.value.execution_result.value.error as DispatchErrorLike)}.`, base);
    }
    // The fee of this exact extrinsic, with a placeholder signature, at the best block.
    const fake = await tx.create(getTxCreator(signer.publicKey, 'Sr25519', () => new Uint8Array(64)), { customSignedExtensions: CUSTOM_EXTENSIONS } as never);
    // `create` returns the extrinsic with its length prefix; the typed API adds
    // one for `uxt` (a Vec<u8> in the metadata), so the inner bytes go in.
    const inner = fake.slice(compact.enc(compact.dec(fake)).length);
    const info = await read(chain, 'fee', () => chain.api.apis.TransactionPaymentApi.query_info(inner, fake.length, AT_BEST));
    const fee = info.partial_fee;
    const account = await read(chain, 'balance', () => chain.api.query.System.Account.getValue(origin, AT_BEST));
    const spendable = account.data.free - account.data.frozen;
    if (spendable < fee + value) {
      return refusal(`Not enough PAS: you have ${formatUnits(spendable)}, this needs about ${formatUnits(fee + value)}.`, { ...base, fee: String(fee) });
    }
    const id = randomUUID();
    dryRuns.set(id, { intent, at: now() });
    return { id, ok: true, error: null, fee: String(fee), ...base };
  };

  const sign = async (dryRunId: string): Promise<{ hash: string }> => {
    const pending = dryRuns.get(dryRunId);
    dryRuns.delete(dryRunId);
    if (!pending || now() - pending.at > DRY_RUN_VALID_MS) throw new Error('Run the test again before you sign.');
    // Built again from the same intent: the limits come from a fresh estimate at the best block.
    const built = await buildTx(chain, origin, pending.intent, await needsMapping());
    if ('revert' in built) throw new Error(`The test run now fails: ${built.revert}.`);
    const creator = getTxCreator(signer.publicKey, 'Sr25519', signer.sign);
    return new Promise((resolve, reject) => {
      let hash: string | null = null;
      const subscription = built.tx.createSubmitAndWatch(creator, { customSignedExtensions: CUSTOM_EXTENSIONS } as never).subscribe({
        next: (event: TxEvent) => {
          hash = event.txHash;
          switch (event.type) {
            case 'created':
              return;
            case 'broadcasted':
              emit({ hash: event.txHash, status: 'submitted', block: null, error: null });
              resolve({ hash: event.txHash });
              return;
            case 'inBestBlock':
              if (!event.ok) emit({ hash: event.txHash, status: 'failed', block: event.block.number, error: dispatchErrorText(event.dispatchError as DispatchErrorLike) });
              else {
                if (built.mapsAccount) mapped = true;
                emit({ hash: event.txHash, status: 'inBlock', block: event.block.number, error: null });
              }
              return;
            case 'notInBestBlock':
              // A reorg took it out of the best chain: it is pending again.
              emit({ hash: event.txHash, status: 'submitted', block: null, error: null });
              return;
            case 'finalized':
              emit(
                event.ok
                  ? { hash: event.txHash, status: 'finalized', block: event.block.number, error: null }
                  : { hash: event.txHash, status: 'failed', block: event.block.number, error: dispatchErrorText(event.dispatchError as DispatchErrorLike) },
              );
              return;
          }
        },
        error: (cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (hash) emit({ hash, status: 'failed', block: null, error: message });
          reject(new Error(`The transaction was not accepted: ${message}`));
          watches.delete(subscription);
        },
        complete: () => watches.delete(subscription),
      });
      watches.add(subscription);
    });
  };

  const contractRead = async (chainId: string, address: string, calldata: Uint8Array): Promise<Uint8Array> => {
    if (chainId.toLowerCase() !== chain.genesis.toLowerCase()) throw new Error('This app is not connected to that network.');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('not a contract address');
    const estimate = await estimateRevive(chain, origin, {
      kind: CALL_KIND_REVIVE,
      to: fromHex(address),
      data: calldata,
      value: 0n,
      gasRefTime: undefined,
      gasProofSize: undefined,
      storageDepositLimit: undefined,
    });
    if ('revert' in estimate) throw new Error(`The contract read failed: ${estimate.revert}`);
    return estimate.returnData;
  };

  const balance = async (): Promise<AccountBalance> => {
    const account = await read(chain, 'balance', () => chain.api.query.System.Account.getValue(origin, AT_BEST));
    return {
      chainId: chain.genesis,
      free: String(account.data.free),
      reserved: String(account.data.reserved),
      frozen: String(account.data.frozen),
    };
  };

  // One subscription to the chain's best blocks, shared by every listener.
  const blockListeners = new Set<(block: BestBlock) => void>();
  let lastBest = -1;
  const blocks = chain.client.bestBlocks$.subscribe({
    next: best => {
      const head = best[0];
      if (!head || head.number === lastBest) return;
      lastBest = head.number;
      for (const listener of blockListeners) listener({ chainId: chain.genesis, number: head.number });
    },
    error: (cause: unknown) => console.warn('[asset-hub] best blocks stopped', cause),
  });

  return {
    dryRun,
    sign,
    balance,
    onBestBlock: listener => {
      blockListeners.add(listener);
      return () => blockListeners.delete(listener);
    },
    status: hash => statuses.get(hash.toLowerCase()) ?? statuses.get(hash) ?? null,
    onStatus: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    contractRead,
    address: origin,
    dispose: () => {
      for (const subscription of watches) subscription.unsubscribe();
      watches.clear();
      listeners.clear();
      blocks.unsubscribe();
      blockListeners.clear();
    },
  };
}
