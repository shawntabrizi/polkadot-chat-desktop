/**
 * M22b: the engine end to end on an in-memory store with the loopback link
 * (node has no WebRTC), a second engine playing the phone. The budget tests
 * encode the linked-device limit (2 statements): a sync that cannot be
 * afforded must say why and submit nothing.
 */

import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appDatabase } from '../../app/database';
import { type AccountSpaceState, createAccountSpace } from '../chat/accountSpace';
import { createSubmissionMeter } from '../chat/submissions';
import { makeDeviceKeys } from '../testing/peers';

import type { SyncEntity, SyncUpdate } from './codec';
import { type DeviceSync, SYNC_NO_ALLOWANCE, SYNC_NO_ANSWER, SYNC_WAITING, createDeviceSync } from './engine';
import type { SyncBookkeeping } from './runner';
import { createLoopbackLink } from './testing/loopback';

const book = (): SyncBookkeeping => {
  let checkpoint = 0;
  let id = 0;
  return { readCheckpoint: async () => checkpoint, writeCheckpoint: async t => void (checkpoint = t), nextUpdateId: async () => ++id };
};

const until = async (probe: () => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!probe()) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const fast = { handshakeMs: 1_500, backoffMs: 20, pushMs: 50, waitMs: 60_000 };

type Side = { sync: DeviceSync; applied: SyncUpdate[]; submitted: () => number };

const side = (params: {
  store: ReturnType<typeof createInMemoryStatementStore>;
  own: ReturnType<typeof makeDeviceKeys>;
  peer: ReturnType<typeof makeDeviceKeys>;
  collect?: (since: number) => Promise<SyncEntity[]>;
  space?: { snapshot: () => AccountSpaceState; subscribe: (listener: VoidFunction) => VoidFunction };
  undelivered?: number;
  tight?: boolean;
  linkless?: boolean;
}): Side => {
  const applied: SyncUpdate[] = [];
  let count = 0;
  const counted = { ...params.store, submitStatement: (statement: Parameters<typeof params.store.submitStatement>[0]) => (count++, params.store.submitStatement(statement)) };
  const sync = createDeviceSync({
    own: { statementAccountId: params.own.statementAccountPublicKey, encryptionPrivateKey: params.own.encryptionPrivateKey },
    phone: { statementAccountId: params.peer.statementAccountPublicKey, encryptionPublicKey: params.peer.encryptionPublicKey },
    prover: createSr25519Prover(params.own.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: createSubmissionMeter(counted).store,
    linkFactory: params.linkless ? null : createLoopbackLink,
    collect: params.collect ?? (async () => []),
    apply: async update => void applied.push(update),
    space: params.space ?? createAccountSpace(),
    undeliveredSends: async () => params.undelivered ?? 0,
    tightBudget: async () => params.tight ?? true,
    bookkeeping: book(),
    timing: fast,
  });
  return { sync, applied, submitted: () => count };
};

const open: Side[] = [];
beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});
afterEach(() => {
  for (const s of open.splice(0)) s.sync.dispose();
});

const chat: SyncEntity = { tag: 'ChatsAdded', value: [{ tag: 'Contact', value: new Uint8Array(32).fill(5) }] };

describe('device sync engine', () => {
  it('this device and the phone connect over the session and a chat syncs to this device', async () => {
    const store = createInMemoryStatementStore();
    const device = makeDeviceKeys();
    const phoneKeys = makeDeviceKeys();
    const mine = side({ store, own: device, peer: phoneKeys });
    const phone = side({ store, own: phoneKeys, peer: device, collect: async since => (since === 0 ? [chat] : []) });
    open.push(mine, phone);
    phone.sync.syncNow();
    mine.sync.syncNow();
    await until(() => mine.applied.length === 1);
    expect(mine.applied[0]?.entities).toEqual([chat]);
    expect(mine.sync.snapshot().state).toBe('syncing');
    expect(mine.sync.snapshot().lastSyncAt).not.toBeNull();
    // The signalling session costs this device at most its two channels (request, response), replaced in place.
    expect(mine.submitted()).toBeGreaterThan(0);
  });

  it('on a tight allowance with an undelivered send it waits, says why, and submits nothing', async () => {
    const store = createInMemoryStatementStore();
    const mine = side({ store, own: makeDeviceKeys(), peer: makeDeviceKeys(), undelivered: 1, tight: true });
    open.push(mine);
    mine.sync.syncNow();
    await until(() => mine.sync.snapshot().state === 'waiting');
    expect(mine.sync.snapshot()).toMatchObject({ state: 'waiting', reason: SYNC_WAITING });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(mine.submitted()).toBe(0);
  });

  it('a roomy allowance does not wait for undelivered sends', async () => {
    const store = createInMemoryStatementStore();
    const mine = side({ store, own: makeDeviceKeys(), peer: makeDeviceKeys(), undelivered: 3, tight: false });
    open.push(mine);
    mine.sync.syncNow();
    await until(() => mine.sync.snapshot().state === 'connecting');
  });

  it('without an allowance it pauses with the reconnect text and submits nothing', async () => {
    const store = createInMemoryStatementStore();
    const space = createAccountSpace();
    space.markNoAllowance();
    const mine = side({ store, own: makeDeviceKeys(), peer: makeDeviceKeys(), space });
    open.push(mine);
    mine.sync.syncNow();
    await until(() => mine.sync.snapshot().state === 'paused');
    expect(mine.sync.snapshot()).toMatchObject({ reason: SYNC_NO_ALLOWANCE });
    expect(mine.submitted()).toBe(0);
  });

  it('a phone that never answers: 3 attempts, then paused until asked again (no endless signalling)', async () => {
    const store = createInMemoryStatementStore();
    const device = makeDeviceKeys();
    const mine = side({ store, own: device, peer: makeDeviceKeys() });
    open.push(mine);
    const attempts: number[] = [];
    mine.sync.subscribe(() => {
      const s = mine.sync.snapshot();
      if (s.state === 'connecting' && attempts.at(-1) !== s.attempt) attempts.push(s.attempt);
    });
    mine.sync.syncNow();
    await until(() => mine.sync.snapshot().state === 'paused', 10_000);
    expect(attempts).toEqual([1, 2, 3]);
    expect(mine.sync.snapshot()).toMatchObject({ reason: SYNC_NO_ANSWER });
    const after = mine.submitted();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(mine.submitted()).toBe(after);
  }, 15_000);

  it('no WebRTC: paused with the reason, syncNow does nothing', () => {
    const mine = side({ store: createInMemoryStatementStore(), own: makeDeviceKeys(), peer: makeDeviceKeys(), linkless: true });
    open.push(mine);
    mine.sync.syncNow();
    expect(mine.sync.snapshot().state).toBe('paused');
    expect(mine.submitted()).toBe(0);
  });
});
