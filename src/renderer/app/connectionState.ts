/**
 * What the People-chain connection is doing, honestly (M6 step 6). The WS
 * provider reports connecting / connected / disconnected; this adds what the
 * provider cannot know: whether it ever connected ("Reconnecting…", not
 * "Connecting…", after a drop), whether the machine is offline, and since
 * when it is not connected (the room banner waits 5 s).
 */

import type { ConnectionStatus } from './statementStore';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

/** How long a drop may last before the room says so. */
export const BANNER_DELAY_MS = 5_000;

export type ConnectionSource = {
  status: () => ConnectionStatus;
  onStatus: (listener: (status: ConnectionStatus) => void) => VoidFunction;
};

export type OnlineSource = {
  online: () => boolean;
  onChange: (listener: () => void) => VoidFunction;
};

export type ConnectionSnapshot = {
  state: ConnectionState;
  /** When the connection was last lost (or first tried); null while connected. */
  notConnectedSince: number | null;
};

export type ConnectionTracker = {
  snapshot: () => ConnectionSnapshot;
  subscribe: (listener: () => void) => VoidFunction;
  dispose: VoidFunction;
};

/** The browser's online flag; always online where there is no navigator (Node). */
export const browserOnline: OnlineSource = {
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  onChange: listener => {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener('online', listener);
    window.addEventListener('offline', listener);
    return () => {
      window.removeEventListener('online', listener);
      window.removeEventListener('offline', listener);
    };
  },
};

export const createConnectionTracker = (source: ConnectionSource, network: OnlineSource = browserOnline, now: () => number = Date.now): ConnectionTracker => {
  let everConnected = false;
  let status = source.status();
  let notConnectedSince: number | null = null;
  let current: ConnectionSnapshot = { state: 'connecting', notConnectedSince: null };
  const listeners = new Set<() => void>();

  const derive = (): ConnectionSnapshot => {
    if (status === 'connected') {
      everConnected = true;
      notConnectedSince = null;
      return { state: 'connected', notConnectedSince: null };
    }
    notConnectedSince ??= now();
    const state: ConnectionState = !network.online() ? 'offline' : everConnected ? 'reconnecting' : 'connecting';
    return { state, notConnectedSince };
  };

  const update = () => {
    const next = derive();
    if (next.state === current.state && next.notConnectedSince === current.notConnectedSince) return;
    current = next;
    for (const listener of listeners) listener();
  };

  current = derive();
  const stopStatus = source.onStatus(next => {
    status = next;
    update();
  });
  const stopOnline = network.onChange(update);

  return {
    snapshot: () => current,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      stopStatus();
      stopOnline();
      listeners.clear();
    },
  };
};

/** The banner shows once the connection has been down for `BANNER_DELAY_MS`. */
export const showsBanner = (snapshot: ConnectionSnapshot, at: number): boolean =>
  snapshot.state !== 'connected' && snapshot.notConnectedSince !== null && at - snapshot.notConnectedSince >= BANNER_DELAY_MS;
