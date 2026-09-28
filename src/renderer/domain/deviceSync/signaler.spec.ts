import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { describe, expect, it, vi } from 'vitest';

import { createSubmissionMeter } from '../chat/submissions';
import { makeDeviceKeys } from '../testing/peers';

import type { SyncSignalingEnvelope } from './codec';
import { type SignalSession, createSignalSession, lastOfferOnly } from './phoneSession';
import { isInitiator, pairSessionId, startSignaler } from './signaler';
import { createLoopbackLink } from './testing/loopback';

/** Signalling waits out the 500 ms candidate window, longer than `peers.waitFor` polls. */
const waitFor = async (probe: () => boolean, ms = 5_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!probe()) {
    if (Date.now() > until) throw new Error('waitFor: condition not met');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const sessionPair = () => {
  const store = createInMemoryStatementStore();
  const a = makeDeviceKeys();
  const b = makeDeviceKeys();
  const open = (own: typeof a, peer: typeof a) =>
    createSignalSession({
      own: { statementAccountId: own.statementAccountPublicKey, encryptionPrivateKey: own.encryptionPrivateKey },
      peer: { statementAccountId: peer.statementAccountPublicKey, encryptionPublicKey: peer.encryptionPublicKey },
      prover: createSr25519Prover(own.statementAccountSeed),
      allocator: createExpiryAllocator(),
      // As in the app: the meter sends back-to-back requests of one task as one statement.
      statementStore: createSubmissionMeter(store).store,
    });
  return { a, b, sessionA: open(a, b), sessionB: open(b, a) };
};

const received = (session: SignalSession) => {
  const all: SyncSignalingEnvelope[] = [];
  session.subscribe(envelopes => all.push(...envelopes));
  return all;
};

describe('initiator rule (DeviceSyncEngine.kt)', () => {
  it('the smaller statement account, unsigned, initiates; both ends name the pair alike', () => {
    const small = new Uint8Array([0x01, 0xff]);
    const big = new Uint8Array([0x80, 0x00]);
    expect(isInitiator(small, big)).toBe(true);
    expect(isInitiator(big, small)).toBe(false);
    expect(pairSessionId(small, big)).toBe('device-sync:01ff:8000');
    expect(pairSessionId(big, small)).toBe('device-sync:01ff:8000');
  });
});

describe('phone session (DevicesSessionManager.kt parameters)', () => {
  it('carries envelopes both ways in order, and keeps only the last Offer of one request', async () => {
    const { sessionA, sessionB } = sessionPair();
    const atB = received(sessionB);
    const atA = received(sessionA);
    await sessionA.send([
      { offerId: 'old', message: { tag: 'Reconnected', value: undefined } },
      { offerId: 'new', message: { tag: 'Offer', value: { sdp: new Uint8Array([1]) } } },
    ]);
    await waitFor(() => atB.length >= 2);
    expect(atB.map(e => `${e.message.tag}:${e.offerId}`)).toEqual(['Reconnected:old', 'Offer:new']);
    await sessionB.send([{ offerId: 'new', message: { tag: 'Answer', value: { sdp: new Uint8Array([2]) } } }]);
    await waitFor(() => atA.length === 1);
    expect(atA[0]?.message.tag).toBe('Answer');
    const twoOffers = [
      { offerId: '1', message: { tag: 'Offer' as const, value: { sdp: new Uint8Array() } } },
      { offerId: 'x', message: { tag: 'Candidates' as const, value: { candidates: new Uint8Array() } } },
      { offerId: '2', message: { tag: 'Offer' as const, value: { sdp: new Uint8Array() } } },
    ];
    expect(lastOfferOnly(twoOffers).map(e => e.offerId)).toEqual(['x', '2']);
    sessionA.dispose();
    sessionB.dispose();
  });

  it('a request statement fits the phone’s 2 KB budget', async () => {
    const store = createInMemoryStatementStore();
    const sizes: number[] = [];
    const watched = { ...store, submitStatement: (statement: Parameters<typeof store.submitStatement>[0]) => (sizes.push(statement.data?.length ?? 0), store.submitStatement(statement)) };
    const a = makeDeviceKeys();
    const b = makeDeviceKeys();
    const session = createSignalSession({
      own: { statementAccountId: a.statementAccountPublicKey, encryptionPrivateKey: a.encryptionPrivateKey },
      peer: { statementAccountId: b.statementAccountPublicKey, encryptionPublicKey: b.encryptionPublicKey },
      prover: createSr25519Prover(a.statementAccountSeed),
      allocator: createExpiryAllocator(),
      statementStore: watched,
    });
    await session.send([{ offerId: crypto.randomUUID(), message: { tag: 'Offer', value: { sdp: new Uint8Array(400) } } }]);
    await waitFor(() => sizes.length > 0);
    expect(Math.max(...sizes)).toBeLessThan(2048);
    session.dispose();
  });
});

describe('signaler (SyncPeerChannelSignaling.kt rules)', () => {
  it('offer and answer over the session open the data channel; both save the same offerId', async () => {
    const { sessionA, sessionB } = sessionPair();
    const linkA = createLoopbackLink('initiator');
    const linkB = createLoopbackLink('acceptor');
    const savedA: string[] = [];
    const savedB: string[] = [];
    const a = startSignaler({ session: sessionA, link: linkA, role: 'initiator', onAcceptedOfferId: id => savedA.push(id), onReset: () => undefined });
    const b = startSignaler({ session: sessionB, link: linkB, role: 'acceptor', onAcceptedOfferId: id => savedB.push(id), onReset: () => undefined });
    const [portA, portB] = await Promise.all([linkA.opened, linkB.opened]);
    const got: number[] = [];
    portB.onFrame(frame => got.push(frame[0] ?? -1));
    portA.send(new Uint8Array([42]));
    await waitFor(() => got.length === 1);
    expect(got).toEqual([42]);
    await waitFor(() => savedA.length === 1);
    expect(savedB).toEqual(savedA);
    expect(a.offerId()).toBe(b.offerId());
    a.close();
    b.close();
    sessionA.dispose();
    sessionB.dispose();
  });

  it('an Answer of another attempt is dropped; a matching Reconnected asks for a new attempt', async () => {
    const { sessionA, sessionB } = sessionPair();
    const linkA = createLoopbackLink('initiator');
    const onReset = vi.fn();
    const applied = vi.spyOn(linkA, 'applyRemote');
    const atB = received(sessionB);
    const a = startSignaler({ session: sessionA, link: linkA, role: 'initiator', onReset, newOfferId: () => 'current' });
    await waitFor(() => atB.some(e => e.message.tag === 'Offer'));
    await sessionB.send([{ offerId: 'stale', message: { tag: 'Answer', value: { sdp: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]) } } }]);
    await sessionB.send([{ offerId: 'stale', message: { tag: 'Reconnected', value: undefined } }]);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(applied).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    await sessionB.send([{ offerId: 'current', message: { tag: 'Reconnected', value: undefined } }]);
    await waitFor(() => onReset.mock.calls.length === 1);
    a.close();
    sessionA.dispose();
    sessionB.dispose();
  });

  it('the initiator sends Reconnected(saved id) in the same request as its new Offer', async () => {
    const { sessionA, sessionB } = sessionPair();
    const atB = received(sessionB);
    const a = startSignaler({ session: sessionA, link: createLoopbackLink('initiator'), role: 'initiator', reconnectOfferId: 'before-restart', onReset: () => undefined, newOfferId: () => 'fresh' });
    await waitFor(() => atB.length >= 2);
    expect(atB.slice(0, 2).map(e => `${e.message.tag}:${e.offerId}`)).toEqual(['Reconnected:before-restart', 'Offer:fresh']);
    a.close();
    sessionA.dispose();
    sessionB.dispose();
  });
});
