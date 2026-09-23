import { describe, expect, it } from 'vitest';

import { BANNER_DELAY_MS, CONNECTION_LABEL, type ConnectionSource, type OnlineSource, createConnectionTracker, showsBanner } from './connectionState';
import type { ConnectionStatus } from './statementStore';

/** A WS provider stand-in: the test drives its status. */
const fakeProvider = (initial: ConnectionStatus = 'connecting') => {
  let status = initial;
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const source: ConnectionSource = {
    status: () => status,
    onStatus: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    emit: (next: ConnectionStatus) => {
      status = next;
      for (const listener of listeners) listener(next);
    },
  };
};

const fakeNetwork = () => {
  let online = true;
  const listeners = new Set<() => void>();
  const source: OnlineSource = {
    online: () => online,
    onChange: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    set: (next: boolean) => {
      online = next;
      for (const listener of listeners) listener();
    },
  };
};

describe('connection state', () => {
  // "Connected" under the username must never be a constant (M6 step 6).
  it('says Connecting… until the first connect, then Reconnecting… after a drop', () => {
    let clock = 1_000;
    const provider = fakeProvider();
    const tracker = createConnectionTracker(provider.source, fakeNetwork().source, () => clock);
    expect(CONNECTION_LABEL[tracker.snapshot().state]).toBe('Connecting…');
    provider.emit('connected');
    expect(tracker.snapshot()).toEqual({ state: 'connected', notConnectedSince: null });
    clock = 2_000;
    provider.emit('disconnected');
    expect(tracker.snapshot()).toEqual({ state: 'reconnecting', notConnectedSince: 2_000 });
    // The provider's own retry says "connecting"; to the user it is still a reconnect since the drop.
    clock = 2_500;
    provider.emit('connecting');
    expect(tracker.snapshot()).toEqual({ state: 'reconnecting', notConnectedSince: 2_000 });
    provider.emit('connected');
    expect(tracker.snapshot().state).toBe('connected');
  });

  it('says Offline when the machine has no network, and recovers', () => {
    const provider = fakeProvider('connected');
    const network = fakeNetwork();
    const tracker = createConnectionTracker(provider.source, network.source, () => 0);
    network.set(false);
    provider.emit('disconnected');
    expect(tracker.snapshot().state).toBe('offline');
    network.set(true);
    expect(tracker.snapshot().state).toBe('reconnecting');
  });

  it('notifies subscribers only on a change', () => {
    const provider = fakeProvider('connected');
    const tracker = createConnectionTracker(provider.source, fakeNetwork().source, () => 0);
    let calls = 0;
    tracker.subscribe(() => calls++);
    provider.emit('connected');
    provider.emit('disconnected');
    provider.emit('disconnected');
    expect(calls).toBe(1);
  });

  // A blip must not flash a banner; a real outage must show one.
  it('shows the room banner only after 5 s without a connection', () => {
    const clock = 0;
    const provider = fakeProvider('connected');
    const tracker = createConnectionTracker(provider.source, fakeNetwork().source, () => clock);
    provider.emit('disconnected');
    expect(showsBanner(tracker.snapshot(), clock + BANNER_DELAY_MS - 1)).toBe(false);
    expect(showsBanner(tracker.snapshot(), clock + BANNER_DELAY_MS)).toBe(true);
    provider.emit('connected');
    expect(showsBanner(tracker.snapshot(), clock + 60_000)).toBe(false);
  });
});
