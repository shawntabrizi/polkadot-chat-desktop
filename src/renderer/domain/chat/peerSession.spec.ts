import { createExpiryAllocator, createInMemoryStatementStore, createSr25519Prover } from '@novasamatech/statement-store';
import { describe, expect, it } from 'vitest';

import type { PeerDevice } from '../../app/database';
import type { DeviceKeys } from '../device/keys';
import type { UserIdentity } from '../identity/userIdentity';
import { makeDeviceKeys, makeIdentity, waitFor } from '../testing/peers';

import { createPeerRoster } from './peerRoster';
import { type IncomingChatMessage, createPeerSession } from './peerSession';

const target = (device: DeviceKeys): PeerDevice => ({
  statementAccountId: device.statementAccountPublicKey,
  encryptionPublicKey: device.encryptionPublicKey,
});

type Side = {
  received: IncomingChatMessage[];
  sent: string[];
  delivered: string[];
  batches: number;
  session: ReturnType<typeof createPeerSession>;
  roster: ReturnType<typeof createPeerRoster>;
};

const open = (
  store: ReturnType<typeof createInMemoryStatementStore>,
  identity: UserIdentity,
  device: DeviceKeys,
  peer: UserIdentity,
  peerDevices: PeerDevice[],
): Side => {
  const side: Partial<Side> = { received: [], sent: [], delivered: [], batches: 0 };
  side.roster = createPeerRoster(peerDevices);
  side.session = createPeerSession({
    identity,
    deviceKeys: device,
    peerIdentityAccountId: peer.identityAccountId,
    peerIdentityChatPublicKey: peer.identityChatPublicKey,
    peerRoster: side.roster,
    prover: createSr25519Prover(device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onMessage: message => side.received!.push(message),
    onSent: id => side.sent!.push(id),
    onDelivered: id => side.delivered!.push(id),
    onBatchDelivered: () => {
      side.batches!++;
    },
  });
  return side as Side;
};

describe('peer session', () => {
  // Bob has two devices; Alice's one statement must reach both, and Alice's
  // row must go sent → delivered on the first ACK.
  it('delivers a text to every device of a two-device peer and reports the ack', async () => {
    const store = createInMemoryStatementStore();
    const alice = makeIdentity();
    const aliceDevice = makeDeviceKeys();
    const bob = makeIdentity();
    const bobPhone = makeDeviceKeys();
    const bobLaptop = makeDeviceKeys();

    const a = open(store, alice, aliceDevice, bob, [target(bobPhone), target(bobLaptop)]);
    const bPhone = open(store, bob, bobPhone, alice, [target(aliceDevice)]);
    const bLaptop = open(store, bob, bobLaptop, alice, [target(aliceDevice)]);

    await a.session.send({ tag: 'text', value: 'hello both' }, { messageId: 'm1', timestamp: 1 });
    expect(a.sent).toEqual(['m1']);

    await waitFor(() => bPhone.received.length === 1 && bLaptop.received.length === 1);
    // Spec 0013: each receiver names the device that sent it (the SDK does not; the session's sender tracker does).
    expect(bPhone.received[0]).toEqual({ messageId: 'm1', timestamp: 1, content: { tag: 'text', value: 'hello both' }, device: aliceDevice.statementAccountPublicKey });
    expect(bLaptop.received[0]?.messageId).toBe('m1');
    expect(bLaptop.received[0]?.device).toEqual(aliceDevice.statementAccountPublicKey);

    await waitFor(() => a.delivered.includes('m1'));
    expect(a.batches).toBeGreaterThan(0);

    // And back: a device of Bob answers, Alice reads it once.
    await bLaptop.session.send({ tag: 'text', value: 'laptop here' }, { messageId: 'm2', timestamp: 2 });
    await waitFor(() => a.received.length === 1);
    expect(a.received[0]?.content).toEqual({ tag: 'text', value: 'laptop here' });
    // The laptop, not the phone: capabilities from one device must never be filed under another.
    expect(a.received[0]?.device).toEqual(bobLaptop.statementAccountPublicKey);
    await waitFor(() => bLaptop.delivered.includes('m2'));
    await bPhone.session.send({ tag: 'text', value: 'phone here' }, { messageId: 'm3', timestamp: 3 });
    await waitFor(() => a.received.length === 2);
    expect(a.received[1]?.device).toEqual(bobPhone.statementAccountPublicKey);

    for (const side of [a, bPhone, bLaptop]) side.session.dispose();
  });

  it('is delivered once per message id even though the batch is re-sent until acked', async () => {
    const store = createInMemoryStatementStore();
    const alice = makeIdentity();
    const aliceDevice = makeDeviceKeys();
    const bob = makeIdentity();
    const bobDevice = makeDeviceKeys();
    const a = open(store, alice, aliceDevice, bob, [target(bobDevice)]);
    const b = open(store, bob, bobDevice, alice, [target(aliceDevice)]);

    await a.session.send({ tag: 'text', value: '1' }, { messageId: 'm1', timestamp: 1 });
    await a.session.send({ tag: 'text', value: '2' }, { messageId: 'm2', timestamp: 2 });
    await a.session.send({ tag: 'text', value: '3' }, { messageId: 'm3', timestamp: 3 });
    await waitFor(() => a.delivered.length === 3);
    // Give any late re-delivery a chance to show up.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(b.received.map(m => m.messageId)).toEqual(['m1', 'm2', 'm3']);

    a.session.dispose();
    b.session.dispose();
  });

  it('rejects a send while the peer has no known device', async () => {
    const store = createInMemoryStatementStore();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = open(store, alice, makeDeviceKeys(), bob, []);
    await expect(a.session.send({ tag: 'text', value: 'x' }, { messageId: 'm', timestamp: 1 })).rejects.toThrow();
    expect(a.sent).toEqual([]);
    a.session.dispose();
  });

  it('picks up a device added to the roster without a restart', async () => {
    const store = createInMemoryStatementStore();
    const alice = makeIdentity();
    const aliceDevice = makeDeviceKeys();
    const bob = makeIdentity();
    const bobDevice = makeDeviceKeys();
    const a = open(store, alice, aliceDevice, bob, []);
    const b = open(store, bob, bobDevice, alice, [target(aliceDevice)]);

    a.roster.set([target(bobDevice)]);
    await a.session.send({ tag: 'text', value: 'now' }, { messageId: 'm1', timestamp: 1 });
    await waitFor(() => b.received.length === 1);
    await waitFor(() => a.delivered.includes('m1'));

    a.session.dispose();
    b.session.dispose();
  });
});
