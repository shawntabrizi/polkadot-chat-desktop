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

import { MultiAddress, assetHubPaseo } from '@polkadot-api/descriptors';
import { AccountId, compact } from '@polkadot-api/substrate-bindings';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { type PolkadotClient, type TxEvent, createClient, getTypedCodecs } from 'polkadot-api';
import { getTxCreator } from 'polkadot-api/tx-creator';
import { getWsProvider } from 'polkadot-api/ws';
import type { Subscription } from 'rxjs';

import { READ_TIMEOUT_MS, awaitBestRuntime, retryOnNextEndpoint, withTimeout } from '../../shared/chainRead';
import type { AccountBalance, BestBlock, ChainTransfer, TxDryRun, TxStatusEvent } from '../../shared/desktop-api';
import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';
import { CALL_KIND_REVIVE, type TxCall, type TxIntent, decodeTxIntent, formatUnits, intentProblem } from '../../shared/txIntent';
import { metadataCache } from '../metadataCache';

import { type TrackerChain, createTxTracker, extrinsicHash } from './txTracker';

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
/**
 * Spec 0007 "Limits of a Revive call": a call whose intent sets no deposit
 * limit may still take another contract path than the dry-run's (the flip's
 * second stake hit `StorageDepositLimitExhausted`), so its deposit limit is at
 * least the estimate plus 0.1 PAS. A cap, not a charge.
 */
export const DEPOSIT_FLOOR = 1_000_000_000n;
/** Asset Hub's extension without a default (a bool): false, the "not used" value. */
export const CUSTOM_EXTENSIONS = { RestrictOrigins: { value: false } } as const;
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
export type ReviveLimits = { refTime: bigint; proofSize: bigint; deposit: bigint };

const larger = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/**
 * The limits a kind-1 call is signed with (spec 0007, revision 2026-09-24):
 * per field, the larger of the intent's limit (the author's worst case over
 * all contract paths) and this client's estimate plus margin (a stale or low
 * intent never signs below what the chain needs now). No deposit limit in the
 * intent: the estimate plus margin, floored at estimate + `DEPOSIT_FLOOR`.
 */
export const reviveLimits = (call: Pick<TxCall, 'gasRefTime' | 'gasProofSize' | 'storageDepositLimit'>, estimate: ReviveLimits): ReviveLimits => ({
  refTime: larger(call.gasRefTime ?? 0n, withMargin(estimate.refTime)),
  proofSize: larger(call.gasProofSize ?? 0n, withMargin(estimate.proofSize)),
  deposit: larger(call.storageDepositLimit ?? estimate.deposit + DEPOSIT_FLOOR, withMargin(estimate.deposit)),
});

const carriesLimits = (call: TxCall): boolean => call.gasRefTime !== undefined || call.gasProofSize !== undefined || call.storageDepositLimit !== undefined;

/** "×1.5": the signed ref-time over the estimate, one decimal, for the strip's caps line. */
export const gasFactor = (signed: bigint, estimate: bigint): string => {
  if (estimate <= 0n) return '1';
  const tenths = (signed * 10n + estimate / 2n) / estimate;
  return tenths % 10n === 0n ? String(tenths / 10n) : `${tenths / 10n}.${tenths % 10n}`;
};

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

type Built = { tx: Tx; mapsAccount: boolean; returnData: Uint8Array | null; caps: TxDryRun['caps'] };

/** The extrinsic for the intent: one call, or `Utility.batch_all` of several (map_account first when needed). */
async function buildTx(chain: AssetHubChain, origin: string, intent: TxIntent, needsMapping: boolean): Promise<Built | { revert: string }> {
  const calls: Tx[] = [];
  let returnData: Uint8Array | null = null;
  // The caps line covers the calls whose intent set limits: their deposit
  // limits summed, the largest gas factor.
  let capDeposit: bigint | null = null;
  let capGas = '1';
  const hasRevive = intent.calls.some(call => call.kind === CALL_KIND_REVIVE);
  const mapsAccount = hasRevive && needsMapping;
  if (mapsAccount) calls.push(chain.api.tx.Revive.map_account());
  for (const call of intent.calls) {
    if (call.kind === CALL_KIND_REVIVE) {
      const estimate = await estimateRevive(chain, origin, call);
      if ('revert' in estimate) return estimate;
      returnData = estimate.returnData;
      const limits = reviveLimits(call, estimate);
      if (carriesLimits(call)) {
        capDeposit = (capDeposit ?? 0n) + limits.deposit;
        const factor = gasFactor(limits.refTime, estimate.refTime);
        if (Number(factor) > Number(capGas)) capGas = factor;
      }
      calls.push(
        chain.api.tx.Revive.call({
          dest: hex(call.to ?? new Uint8Array()),
          value: call.value,
          weight_limit: { ref_time: limits.refTime, proof_size: limits.proofSize },
          storage_deposit_limit: limits.deposit,
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
  return { tx, mapsAccount, returnData, caps: capDeposit === null ? null : { deposit: String(capDeposit), gasFactor: capGas } };
}

// ── Balances (M12g) ─────────────────────────────────────────────────────────

/**
 * Why the signer cannot pay `value` plus `fee` and keep the existential
 * deposit (a keep-alive transfer must leave it); null when it can. The
 * number is what could still be sent: the spendable balance less the fee
 * and the deposit ("Not enough PAS: 0.4 available after fees").
 */
export const balanceProblem = (spendable: bigint, fee: bigint, value: bigint, existentialDeposit: bigint): string | null => {
  if (value + fee + existentialDeposit <= spendable) return null;
  const available = spendable - fee - existentialDeposit;
  return `Not enough PAS: ${formatUnits(available > 0n ? available : 0n)} available after fees.`;
};

/** `twox128("System") ++ twox128("Events")`: the storage key of the block's events. */
const SYSTEM_EVENTS_KEY = '0x26aa394eea5630e07c48ae0c9558cef780d41e5e16056765bc8461851072c9d7';

/** The event codecs of the generated descriptors, built once. */
let codecsOnce: ReturnType<typeof getTypedCodecs<typeof assetHubPaseo>> | null = null;
const eventCodecs = () => (codecsOnce ??= getTypedCodecs(assetHubPaseo));

/** The part of a decoded `System.Events` record this module reads. */
export type ChainEvent = {
  phase: { type: string; value?: unknown };
  event: { type: string; value: { type: string; value: unknown } };
};

const accountHex = AccountId();

/** The `Balances.Transfer` events of extrinsic `index`, accounts as 0x-hex. */
export const balanceTransfers = (events: readonly ChainEvent[], index: number): ChainTransfer[] =>
  events
    .filter(record => record.phase.type === 'ApplyExtrinsic' && record.phase.value === index)
    .filter(record => record.event.type === 'Balances' && record.event.value.type === 'Transfer')
    .map(record => {
      const { from, to, amount } = record.event.value.value as { from: string; to: string; amount: bigint };
      return { from: hex(accountHex.enc(from)), to: hex(accountHex.enc(to)), amount: String(amount) };
    });

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
  /**
   * M12g: the SCALE call data of `Balances.transfer_keep_alive(to, amount)`
   * on this chain (`to`: a 32-byte account). The renderer puts it in a
   * `TxIntent`; the call is still dry-run before anything is signed.
   */
  transferCall: (to: Uint8Array, amount: bigint) => Promise<Uint8Array>;
  /**
   * M12g: the `Balances.Transfer` events of the extrinsic `hash` in block
   * `block` of the best chain: what the chain says the transaction moved.
   * Empty when the block does not hold it, or it moved nothing.
   */
  transfersOf: (hash: string, block: number) => Promise<ChainTransfer[]>;
  /** Every new best block of this chain (number), once each; returns the unsubscribe function. */
  onBestBlock: (listener: (block: BestBlock) => void) => () => void;
  /**
   * Spec 0007 (M12c): follow any transaction on this chain by hash (own or
   * a peer's reference) to "in block" and "finalized"; the states arrive on
   * `onStatus`. `block`: where a reference says it is, or null.
   */
  track: (hash: string, block: number | null) => void;
  address: string;
  dispose: () => void;
};

type LegacyBlock = { block: { extrinsics: string[] } } | null;

/** The chain as the reference tracker reads it: best and finalized blocks, and legacy block reads. */
const trackerChainOf = (chain: AssetHubChain): TrackerChain => ({
  bestBlocks$: chain.client.bestBlocks$,
  finalizedBlock$: chain.client.finalizedBlock$,
  blockHashAt: async number => (await chain.client._request<string | null, [number]>('chain_getBlockHash', [number])) ?? null,
  extrinsicsOf: async hash => (await chain.client._request<LegacyBlock, [string]>('chain_getBlock', [hash]))?.block.extrinsics ?? [],
});

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
  const tracker = createTxTracker(trackerChainOf(chain), emit);

  // A runtime constant: read once per connection.
  let deposit: Promise<bigint> | null = null;
  const existentialDeposit = (): Promise<bigint> => {
    deposit ??= read(chain, 'existential deposit', () => chain.api.constants.Balances.ExistentialDeposit()).catch((cause: unknown) => {
      deposit = null;
      throw cause;
    });
    return deposit;
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
    caps: null,
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
    const { tx, mapsAccount, returnData, caps } = built;
    const base = { signer: origin, mapsAccount, returnData: returnData ? hex(returnData) : null, caps, value: String(value) };
    // The fee of this exact extrinsic, with a placeholder signature, at the best block.
    const fake = await tx.create(getTxCreator(signer.publicKey, 'Sr25519', () => new Uint8Array(64)), { customSignedExtensions: CUSTOM_EXTENSIONS } as never);
    // `create` returns the extrinsic with its length prefix; the typed API adds
    // one for `uxt` (a Vec<u8> in the metadata), so the inner bytes go in.
    const inner = fake.slice(compact.enc(compact.dec(fake)).length);
    const info = await read(chain, 'fee', () => chain.api.apis.TransactionPaymentApi.query_info(inner, fake.length, AT_BEST));
    const fee = info.partial_fee;
    // The balance before the chain's test (M12g): the chain would refuse an
    // over-balance transfer too, but only as "Token.NotExpendable"; people get
    // what they could send instead.
    const account = await read(chain, 'balance', () => chain.api.query.System.Account.getValue(origin, AT_BEST));
    const shortfall = balanceProblem(account.data.free - account.data.frozen, fee, value, await existentialDeposit());
    if (shortfall) return refusal(shortfall, { ...base, fee: String(fee) });
    // The whole extrinsic (batch and all), as the signer's origin, at the best block.
    const dry = await read(chain, 'dry-run', () =>
      chain.api.apis.DryRunApi.dry_run_call({ type: 'system', value: { type: 'Signed', value: origin } } as never, tx.decodedCall as never, 5, AT_BEST),
    );
    if (!dry.success) return refusal('The chain could not test this action.', { ...base, fee: String(fee) });
    if (!dry.value.execution_result.success) {
      return refusal(`The test run failed: ${dispatchErrorText(dry.value.execution_result.value.error as DispatchErrorLike)}.`, { ...base, fee: String(fee) });
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

  const transferCall = async (to: Uint8Array, amount: bigint): Promise<Uint8Array> => {
    if (to.length !== 32) throw new Error('Invalid account.');
    if (amount <= 0n) throw new Error('The amount must be more than 0.');
    const tx = chain.api.tx.Balances.transfer_keep_alive({ dest: MultiAddress.Id(ss58Address(to, 42)), value: amount });
    const data: unknown = await tx.getEncodedData();
    // polkadot-api 3 returns bytes; an older `Binary` has `asBytes`.
    return data instanceof Uint8Array ? data : (data as { asBytes: () => Uint8Array }).asBytes();
  };

  const transfersOf = async (hash: string, block: number): Promise<ChainTransfer[]> => {
    const trackerChain = trackerChainOf(chain);
    const blockHash = await read(chain, 'block hash', () => trackerChain.blockHashAt(block));
    if (!blockHash) return [];
    const extrinsics = await read(chain, 'block body', () => trackerChain.extrinsicsOf(blockHash));
    const index = extrinsics.findIndex(extrinsic => extrinsicHash(extrinsic) === hash.toLowerCase());
    if (index < 0) return [];
    // Legacy `state_getStorage` serves any block, pinned or not (as the tracker's block reads).
    const raw = await read(chain, 'events', () => chain.client._request<string | null, [string, string]>('state_getStorage', [SYSTEM_EVENTS_KEY, blockHash]));
    if (!raw) return [];
    const codecs = await eventCodecs();
    return balanceTransfers(codecs.query.System.Events.value.dec(raw) as unknown as ChainEvent[], index);
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
    transferCall,
    transfersOf,
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
    track: (hash, block) => {
      const known = statuses.get(hash.toLowerCase());
      // Our own transaction already ended here: say so again, nothing to follow.
      if (known && (known.status === 'finalized' || known.status === 'failed')) {
        for (const listener of listeners) listener(known);
        return;
      }
      tracker.track(hash, block);
    },
    address: origin,
    dispose: () => {
      tracker.dispose();
      for (const subscription of watches) subscription.unsubscribe();
      watches.clear();
      listeners.clear();
      blocks.unsubscribe();
      blockListeners.clear();
    },
  };
}
