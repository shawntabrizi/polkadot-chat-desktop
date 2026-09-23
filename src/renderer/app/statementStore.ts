/**
 * The single People-chain connection of the app, one per network profile.
 *
 * Built the way `createPappAdapter` in @novasamatech/host-papp builds it:
 * `createLazyClient(getWsProvider(endpoints, { heartbeatTimeout: Infinity }))`
 * + `createPapiStatementStoreAdapter`. The lazy client is shared with the
 * identity lookup (People-chain storage reads), so it is exposed next to the
 * adapter. The connection is created on first use and torn down when the
 * profile changes.
 *
 * The WS provider reconnects on its own, but raw `statement_subscribeStatement`
 * subscriptions do not survive a reconnect, so the connection status is
 * observable and the chat manager rebuilds its sessions on `connected`.
 */

import {
  type LazyClient,
  type StatementStoreAdapter,
  createLazyClient,
  createPapiStatementStoreAdapter,
} from '@novasamatech/statement-store';
import { type StatusChange, WsEvent, getWsProvider } from 'polkadot-api/ws';

import type { NetworkProfile, NetworkProfileId } from './network';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type PeopleConnection = {
  profileId: NetworkProfileId;
  lazyClient: LazyClient;
  adapter: StatementStoreAdapter;
  status: () => ConnectionStatus;
  /** Fires on every status change with the new status. */
  onStatus: (listener: (status: ConnectionStatus) => void) => VoidFunction;
};

let current: PeopleConnection | null = null;

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
    heartbeatTimeout: Number.POSITIVE_INFINITY,
    onStatusChanged: change => {
      const next = toStatus(change);
      if (next === status) return;
      status = next;
      for (const listener of listeners) listener(next);
    },
  });
  const lazyClient = createLazyClient(provider);
  return {
    profileId: profile.id,
    lazyClient,
    adapter: createPapiStatementStoreAdapter(lazyClient),
    status: () => status,
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
