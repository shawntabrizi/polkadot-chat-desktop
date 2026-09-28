/**
 * M22b: device sync with the phone, end to end: the Statement Store session
 * (phoneSession.ts), the WebRTC attempt (signaler.ts, a `PeerLink`), and the
 * sync protocol on the open channel (runner.ts).
 *
 * Budget (docs/decisions.md M22b): the phone gives a linked device one
 * Statement Store slot, 2 statements and 500 KiB, renewed daily. The store
 * keeps one statement per channel, so this session costs at most 2 however
 * often it signals, but its first statements can push out this device's
 * oldest chat statements (the store drops an account's lowest expiry first).
 * So sync never opens on its own schedule:
 *
 * - it runs when asked (`syncNow`: at start of a phone sign-in, or the
 *   Settings button), not on every connect;
 * - on a tight allowance it waits while a message this device sent in the
 *   last day is still undelivered (evicting that statement would lose it);
 * - a full account or a missing allowance pauses it with the reason, and no
 *   statement goes out;
 * - 3 attempts of 30 s each (5 s apart), then it pauses until asked again.
 *   A channel that closes after it opened starts a new round of attempts.
 */

import type { ExpiryAllocator, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';

import { readSetting, writeSetting } from '../../app/settings';
import type { AccountSpaceState } from '../chat/accountSpace';

import type { SyncEntity, SyncUpdate } from './codec';
import type { DataPort, PeerLink, PeerLinkFactory } from './link';
import { type SignalDevice, type SignalSession, createSignalSession } from './phoneSession';
import { type SyncBookkeeping, runSync } from './runner';
import { isInitiator, startSignaler } from './signaler';

export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const RETRY_BACKOFF_MS = 5_000;
export const MAX_ATTEMPTS = 3;
/** While the channel is open, what changed here is looked for this often (a Dexie read, no statement). */
export const PUSH_INTERVAL_MS = 5_000;
/** How often a waiting sync looks again whether the sent messages are delivered. */
export const WAIT_RECHECK_MS = 30_000;

export const SYNC_WAITING =
  'Waiting until the messages you sent are delivered. This device can keep only a few statements on the network, and sync would push them out.';
export const SYNC_NO_SPACE = 'Paused: this device’s space on the network is full.';
export const SYNC_NO_ALLOWANCE = 'Paused: open the Polkadot app on your phone to reconnect this device.';
export const SYNC_NO_ANSWER = 'Paused: your phone did not answer. Open the Polkadot app on your phone, then try again.';
export const SYNC_UNAVAILABLE = 'Not available in this build (no WebRTC).';

export type DeviceSyncState =
  | { state: 'idle' }
  | { state: 'waiting'; reason: string }
  | { state: 'connecting'; attempt: number }
  | { state: 'syncing' }
  | { state: 'paused'; reason: string };

export type DeviceSyncSnapshot = DeviceSyncState & { lastSyncAt: number | null };

export type DeviceSync = {
  snapshot: () => DeviceSyncSnapshot;
  subscribe: (listener: VoidFunction) => VoidFunction;
  /** Start a sync round now (no-op while one runs). */
  syncNow: VoidFunction;
  dispose: VoidFunction;
};

export const settingsBookkeeping: SyncBookkeeping = {
  readCheckpoint: async () => Number((await readSetting('deviceSync.outgoingUpdateTime')) ?? 0),
  writeCheckpoint: async timePoint => {
    await writeSetting('deviceSync.outgoingUpdateTime', String(timePoint));
  },
  nextUpdateId: async () => {
    const next = (Number((await readSetting('deviceSync.updateId')) ?? 0) + 1) >>> 0;
    await writeSetting('deviceSync.updateId', String(next));
    return next;
  },
};

type Outcome = { tag: 'opened'; port: DataPort } | { tag: 'failed' } | { tag: 'reset' } | { tag: 'stopped' };

export const createDeviceSync = (deps: {
  own: { statementAccountId: Uint8Array; encryptionPrivateKey: Uint8Array };
  phone: SignalDevice;
  prover: StatementProver;
  allocator: ExpiryAllocator;
  statementStore: StatementStoreAdapter;
  /** Null where there is no WebRTC (node): the state says so. */
  linkFactory: PeerLinkFactory | null;
  collect: (since: number) => Promise<SyncEntity[]>;
  apply: (update: SyncUpdate) => Promise<void>;
  space: { snapshot: () => AccountSpaceState; subscribe: (listener: VoidFunction) => VoidFunction };
  /** Messages this device sent in the last day that are not delivered yet. */
  undeliveredSends: () => Promise<number>;
  /** True when the allowance is small (or unknown): then undelivered sends make sync wait. */
  tightBudget: () => Promise<boolean>;
  bookkeeping?: SyncBookkeeping;
  timing?: { handshakeMs?: number; backoffMs?: number; pushMs?: number; waitMs?: number };
}): DeviceSync => {
  const bookkeeping = deps.bookkeeping ?? settingsBookkeeping;
  const handshakeMs = deps.timing?.handshakeMs ?? HANDSHAKE_TIMEOUT_MS;
  const backoffMs = deps.timing?.backoffMs ?? RETRY_BACKOFF_MS;
  const pushMs = deps.timing?.pushMs ?? PUSH_INTERVAL_MS;
  const waitMs = deps.timing?.waitMs ?? WAIT_RECHECK_MS;
  const role = isInitiator(deps.own.statementAccountId, deps.phone.statementAccountId) ? 'initiator' : 'acceptor';

  let state: DeviceSyncState = deps.linkFactory ? { state: 'idle' } : { state: 'paused', reason: SYNC_UNAVAILABLE };
  let lastSyncAt: number | null = null;
  let snapshot: DeviceSyncSnapshot = { ...state, lastSyncAt };
  const listeners = new Set<VoidFunction>();
  const set = (next: DeviceSyncState) => {
    state = next;
    snapshot = { ...state, lastSyncAt };
    for (const listener of listeners) listener();
  };
  void readSetting('deviceSync.lastSyncAt').then(value => {
    if (value && lastSyncAt === null) {
      lastSyncAt = Number(value);
      set(state);
    }
  });

  let disposed = false;
  let running = false;
  let session: SignalSession | null = null;
  // `reconnected` goes once per app run (mds.md connection loop, step 3).
  let reconnectSent = false;
  let cancel: VoidFunction = () => undefined;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;

  const spaceProblem = (): string | null => {
    const space = deps.space.snapshot();
    if (space.noAllowance) return SYNC_NO_ALLOWANCE;
    if (space.full) return SYNC_NO_SPACE;
    return null;
  };

  const closeSession = () => {
    session?.dispose();
    session = null;
  };

  const sleep = (ms: number) =>
    new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(!disposed), ms);
      cancel = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });

  /** One WebRTC attempt: resolves when the channel opens, fails, is reset, or the budget stops it. */
  const attempt = async (signal: SignalSession, reconnectOfferId: string | undefined): Promise<{ outcome: Outcome; link: PeerLink; close: VoidFunction }> => {
    const link = (deps.linkFactory as PeerLinkFactory)(role);
    let settle: (outcome: Outcome) => void = () => undefined;
    const done = new Promise<Outcome>(resolve => {
      settle = resolve;
    });
    const signaler = startSignaler({
      session: signal,
      link,
      role,
      reconnectOfferId,
      onAcceptedOfferId: id => void writeSetting('deviceSync.lastOfferId', id),
      onReset: () => settle({ tag: 'reset' }),
    });
    const timer = setTimeout(() => settle({ tag: 'failed' }), handshakeMs);
    const stopFailed = link.onFailed(() => settle({ tag: 'failed' }));
    const stopSpace = deps.space.subscribe(() => {
      if (spaceProblem()) settle({ tag: 'stopped' });
    });
    cancel = () => settle({ tag: 'stopped' });
    void link.opened.then(port => settle({ tag: 'opened', port }));
    const outcome = await done;
    clearTimeout(timer);
    stopSpace();
    return {
      outcome,
      link,
      close: () => {
        stopFailed();
        signaler.close();
      },
    };
  };

  /** Runs the protocol until the channel closes (or the engine stops). */
  const syncOn = (port: DataPort, link: PeerLink): Promise<void> =>
    new Promise(resolve => {
      set({ state: 'syncing' });
      const runner = runSync({
        port,
        collect: deps.collect,
        apply: deps.apply,
        bookkeeping,
        onActivity: () => {
          lastSyncAt = Date.now();
          void writeSetting('deviceSync.lastSyncAt', String(lastSyncAt));
          set(state);
        },
        onRemoteCandidates: candidates => {
          for (const candidate of candidates) void link.addRemoteCandidate(candidate).catch(() => undefined);
        },
      });
      const timer = setInterval(runner.push, pushMs);
      let ended = false;
      const stops: VoidFunction[] = [];
      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        for (const stop of stops) stop();
        runner.stop();
        resolve();
      };
      stops.push(port.onClose(end), link.onFailed(end));
      cancel = end;
    });

  const run = async (): Promise<void> => {
    const problem = spaceProblem();
    if (problem) return set({ state: 'paused', reason: problem });
    if ((await deps.tightBudget()) && (await deps.undeliveredSends()) > 0) {
      set({ state: 'waiting', reason: SYNC_WAITING });
      waitTimer = setTimeout(() => {
        waitTimer = null;
        syncNow();
      }, waitMs);
      return;
    }
    session ??= createSignalSession({
      own: deps.own,
      peer: deps.phone,
      prover: deps.prover,
      allocator: deps.allocator,
      statementStore: deps.statementStore,
    });
    let attempts = 0;
    while (!disposed) {
      attempts += 1;
      set({ state: 'connecting', attempt: attempts });
      const saved = reconnectSent ? null : await readSetting('deviceSync.lastOfferId');
      reconnectSent = true;
      const { outcome, link, close } = await attempt(session, saved ?? undefined);
      if (outcome.tag === 'opened') {
        await syncOn(outcome.port, link);
        outcome.port.close();
        close();
        // A channel that worked and closed: a fresh round of attempts.
        attempts = 0;
        if (disposed || !(await sleep(backoffMs))) break;
        continue;
      }
      close();
      if (outcome.tag === 'stopped') break;
      if (outcome.tag === 'failed' && attempts >= MAX_ATTEMPTS) {
        closeSession();
        return set({ state: 'paused', reason: SYNC_NO_ANSWER });
      }
      if (!(await sleep(backoffMs))) break;
    }
    closeSession();
    const after = spaceProblem();
    if (!disposed) set(after ? { state: 'paused', reason: after } : { state: 'idle' });
  };

  const syncNow = () => {
    if (disposed || running || !deps.linkFactory) return;
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
    running = true;
    void run()
      .catch(error => {
        console.warn('[device-sync] run failed', error);
        closeSession();
        if (!disposed) set({ state: 'paused', reason: SYNC_NO_ANSWER });
      })
      .finally(() => {
        running = false;
      });
  };

  return {
    snapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncNow,
    dispose: () => {
      disposed = true;
      if (waitTimer) clearTimeout(waitTimer);
      cancel();
      closeSession();
      listeners.clear();
    },
  };
};
