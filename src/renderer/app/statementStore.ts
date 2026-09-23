/**
 * The single People-chain connection of the app, one per network profile.
 *
 * Built the way `createPappAdapter` in @novasamatech/host-papp builds it:
 * `createLazyClient(getWsProvider(endpoints, { heartbeatTimeout: Infinity }))`
 * (with a finite heartbeat, see `NO_HEARTBEAT_MS`)
 * + `createPapiStatementStoreAdapter`. The lazy client is shared with the
 * identity lookup (People-chain storage reads), so it is exposed next to the
 * adapter. The connection is created on first use and torn down when the
 * profile changes.
 *
 * The WS provider reconnects on its own, but raw `statement_subscribeStatement`
 * subscriptions do not survive a reconnect, so the connection status is
 * observable and the chat manager rebuilds its sessions on `connected`.
 *
 * The polkadot-api client gets the runtime-metadata cache (in Electron: the
 * main process's `<userData>/metadata`, through `window.desktop.chain`), so
 * the first chain read after a start does not wait for a public node to
 * serve the metadata.
 */

import {
  type LazyClient,
  type StatementStoreAdapter,
  createPapiStatementStoreAdapter,
} from '@novasamatech/statement-store';
import { type CreateClientOptions, type PolkadotClient, createClient } from 'polkadot-api';
import { type StatusChange, type WsJsonRpcProvider, WsEvent, getWsProvider } from 'polkadot-api/ws';

import type { NetworkProfile, NetworkProfileId } from './network';

/** The `{ getMetadata, setMetadata }` pair polkadot-api's `createClient` takes. */
export type MetadataCache = Required<CreateClientOptions>;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type PeopleConnection = {
  profileId: NetworkProfileId;
  lazyClient: LazyClient;
  adapter: StatementStoreAdapter;
  status: () => ConnectionStatus;
  /** Moves the socket to the profile's next endpoint (a read timed out on this one). */
  switchEndpoint: () => void;
  /** Fires on every status change with the new status. */
  onStatus: (listener: (status: ConnectionStatus) => void) => VoidFunction;
};

let current: PeopleConnection | null = null;
let metadataCacheOverride: MetadataCache | null = null;

/** For the Node e2e script, which has no `window.desktop`. Set before the first connection. */
export const setMetadataCache = (cache: MetadataCache | null): void => {
  metadataCacheOverride = cache;
};

const metadataCache = (): MetadataCache | null =>
  metadataCacheOverride ?? (typeof window !== 'undefined' ? (window.desktop?.chain ?? null) : null);

// Copied from @novasamatech/statement-store 0.10.2 dist/adapter/lazyClient.js on
// 2026-09-23; changes: TypeScript; `createClient` gets the metadata cache (the
// SDK's createLazyClient takes a provider only).
const createCachedLazyClient = (provider: WsJsonRpcProvider, cache: MetadataCache | null): LazyClient => {
  let client: PolkadotClient | null = null;
  const getClient = (): PolkadotClient => {
    client ??= createClient(provider, cache ?? {});
    return client;
  };
  return {
    getClient,
    getRequestFn() {
      const c = getClient();
      return (method, params) => c._request(method, params);
    },
    getSubscribeFn() {
      const c = getClient();
      return (method, params, onMessage, onError) => {
        // statement_subscribeStatement -> statement_unsubscribeStatement
        const unsubscribeMethod = method.replace('subscribe', 'unsubscribe');
        const subscription = c._subscribe(method, unsubscribeMethod, params).subscribe({ next: onMessage, error: onError });
        return () => subscription.unsubscribe();
      };
    },
    disconnect() {
      client?.destroy();
      client = null;
    },
  };
};

/**
 * "No heartbeat": the statement subscriptions can stay quiet for a long time,
 * so a silent socket is not a dead one. host-papp passes `Infinity`, but the
 * provider hands it to `setTimeout`, which turns a non-finite delay into 0 ms
 * in the browser (WebIDL `long`) and 1 ms in Node: the socket is dropped as
 * stale right after it connects, in a loop. The largest delay `setTimeout`
 * takes (about 24.8 days) keeps the intent.
 */
const NO_HEARTBEAT_MS = 2_147_483_647;

const toStatus = (change: StatusChange): ConnectionStatus => {
  switch (change.type) {
    case WsEvent.CONNECTING:
      return 'connecting';
    case WsEvent.CONNECTED:
      return 'connected';
    case WsEvent.ERROR:
    case WsEvent.CLOSE:
      return 'disconnected';
  }
};

const connect = (profile: NetworkProfile): PeopleConnection => {
  let status: ConnectionStatus = 'connecting';
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const provider = getWsProvider([...profile.peopleEndpoints], {
    heartbeatTimeout: NO_HEARTBEAT_MS,
    onStatusChanged: change => {
      const next = toStatus(change);
      if (next === status) return;
      status = next;
      for (const listener of listeners) listener(next);
    },
  });
  const lazyClient = createCachedLazyClient(provider, metadataCache());
  return {
    profileId: profile.id,
    lazyClient,
    adapter: createPapiStatementStoreAdapter(lazyClient),
    status: () => status,
    switchEndpoint: () => provider.switch(),
    onStatus: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const getPeopleConnection = (profile: NetworkProfile): PeopleConnection => {
  if (current?.profileId === profile.id) return current;
  current?.lazyClient.disconnect();
  current = connect(profile);
  return current;
};

export const disposePeopleConnection = (): void => {
  current?.lazyClient.disconnect();
  current = null;
};
