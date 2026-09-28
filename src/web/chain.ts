/**
 * M22a: the chain members of `DesktopApi` in the browser. The same modules
 * main/ipc.ts uses (Asset Hub tx service, Bulletin, HOP, the devnet faucet),
 * over polkadot-api's WebSocket provider in the page. The web has no process
 * boundary, so the input checks main/ipc.ts makes against an untrusted
 * renderer are not repeated; the modules keep their own rules (dry-run
 * before sign, devnet-only faucet and grants).
 */

import { hexToBytes } from '@noble/hashes/utils.js';

import {
  type BestBlock,
  type BulletinProgress,
  type DesktopBulletinApi,
  type DesktopChainApi,
  type DesktopHopApi,
  type HopProgress,
  type TxStatusEvent,
} from '../shared/desktop-api';
import type { NetworkProfileId } from '../shared/network';

import { type AssetHubChain, type TxService, createTxService, openAssetHub } from '../main/chain/assetHub';
import { type BulletinChain, type BulletinService, bulletinSigner, createBulletinService, openBulletin, quotaOf, storeResultOf } from '../main/chain/bulletin';
import { assertDevnetChain, dripDevnet } from '../main/chain/faucet';
import { hopAck, hopFetch } from '../main/chain/hop';
import { deriveIdentityKeys } from '../main/identity/keys';

import { readMetadata, writeMetadata } from './metadataCache';

export type ChainIdentity = { profile: NetworkProfileId; accountHex: string };

export type WebChainDeps = {
  identity: () => Promise<ChainIdentity | null>;
  /** The unlocked mnemonic; throws while locked. */
  mnemonic: () => string;
  /** One Bulletin transaction was broadcast (Diagnostics). */
  onBulletinTransaction: () => void;
};

const bytes = (hex: string): Uint8Array => hexToBytes(hex.replace(/^0x/i, ''));

const listeners = <T>() => {
  const set = new Set<(value: T) => void>();
  return {
    emit: (value: T) => set.forEach(listener => listener(value)),
    on: (listener: (value: T) => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
};

export const createWebChain = (deps: WebChainDeps): { chain: DesktopChainApi; bulletin: DesktopBulletinApi; hop: DesktopHopApi } => {
  const txStatus = listeners<TxStatusEvent>();
  const bestBlock = listeners<BestBlock>();
  const bulletinProgress = listeners<BulletinProgress>();
  const hopProgress = listeners<HopProgress>();

  const current = async (): Promise<ChainIdentity & { key: string }> => {
    const identity = await deps.identity();
    if (!identity) throw new Error('This browser has no identity yet.');
    return { ...identity, key: `${identity.profile}:${identity.accountHex}` };
  };

  // One Asset Hub connection and tx service per identity, opened on first use (as main/ipc.ts).
  let tx: { key: string; service: Promise<TxService>; chain: Promise<AssetHubChain> } | null = null;
  const txService = async (): Promise<TxService> => {
    const identity = await current();
    if (tx?.key === identity.key) return tx.service;
    void tx?.service.then(old => old.dispose(), () => undefined);
    const chain = openAssetHub(identity.profile);
    const mnemonic = deps.mnemonic();
    const service = chain.then(opened => {
      const keys = deriveIdentityKeys(mnemonic);
      const created = createTxService(opened, { publicKey: keys.accountId, sign: keys.sign });
      created.onStatus(txStatus.emit);
      created.onBestBlock(bestBlock.emit);
      return created;
    });
    const entry = { key: identity.key, service, chain };
    tx = entry;
    service.catch(() => {
      if (tx === entry) tx = null;
    });
    return service;
  };

  let bulletinEntry: { key: string; service: Promise<BulletinService>; chain: Promise<BulletinChain> } | null = null;
  const bulletinService = async (): Promise<BulletinService> => {
    const identity = await current();
    if (bulletinEntry?.key === identity.key) return bulletinEntry.service;
    void bulletinEntry?.chain.then(old => old.destroy(), () => undefined);
    const chain = openBulletin(identity.profile);
    const signer = bulletinSigner(deps.mnemonic());
    const service = chain.then(opened => createBulletinService(opened, signer, { onTransaction: deps.onBulletinTransaction }));
    const entry = { key: identity.key, service, chain };
    bulletinEntry = entry;
    service.catch(() => {
      if (bulletinEntry === entry) bulletinEntry = null;
    });
    return service;
  };

  const chain: DesktopChainApi = {
    getMetadata: readMetadata,
    setMetadata: writeMetadata,
    dryRun: async intent => (await txService()).dryRun(intent),
    sign: async dryRunId => (await txService()).sign(dryRunId),
    watch: async hash => (await txService()).status(hash),
    track: async (hash, block) => (await txService()).track(hash, block),
    onTxStatus: txStatus.on,
    contractRead: async (chainId, address, calldata) => (await txService()).contractRead(chainId, address, calldata),
    balance: async () => (await txService()).balance(),
    onBestBlock: bestBlock.on,
    faucetDrip: async chainId => {
      const allowed = assertDevnetChain(chainId);
      await txService();
      if (!tx) throw new Error('Asset Hub is not open.');
      const to = deriveIdentityKeys(deps.mnemonic()).accountId;
      return dripDevnet(await tx.chain, allowed, to, txStatus.emit);
    },
    transferCall: async (to, amount) => (await txService()).transferCall(bytes(to), BigInt(amount)),
    transfersOf: async (hash, block) => (await txService()).transfersOf(hash, block),
  };

  const bulletin: DesktopBulletinApi = {
    store: async (uploadId, chunks) => {
      const service = await bulletinService();
      const stored = await service.store(chunks, ({ stored: done, total, chunk }) => bulletinProgress.emit({ uploadId, stored: done, total, chunk }));
      return storeResultOf(stored, chunks);
    },
    onProgress: bulletinProgress.on,
    fetch: async (genesis, hash, mirror, only, gatewayFirst) => {
      const service = await bulletinService();
      if (genesis.toLowerCase() !== service.genesis.toLowerCase()) throw new Error('This attachment is on another network.');
      return service.fetchChunk(bytes(hash), mirror, only, gatewayFirst === true);
    },
    allowance: async () => {
      const service = await bulletinService();
      return quotaOf(service.address, await service.allowance());
    },
  };

  const hop: DesktopHopApi = {
    fetch: async (requestId, node, identifier, ticket) => {
      const bulletinSource = async (hash: Uint8Array, large: boolean): Promise<Uint8Array> => (await (await bulletinService()).fetchChunk(hash, null, undefined, large)).bytes;
      return hopFetch(node, bytes(identifier), ticket, (done, total) => hopProgress.emit({ requestId, done, total }), undefined, [bulletinSource]);
    },
    ack: (node, ticket, entries) => hopAck(node, ticket, entries),
    send: async data => (await bulletinService()).sendHop(data),
    onProgress: hopProgress.on,
  };

  return { chain, bulletin, hop };
};
