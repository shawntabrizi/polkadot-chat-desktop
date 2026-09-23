// Test helpers: throwaway identities and devices with real keys, so the
// session provers and the identity proof verify for real.

import { x25519 } from '@noble/curves/ed25519.js';
import { createSr25519Secret, deriveSr25519PublicKey } from '@novasamatech/statement-store';

import type { DeviceKeys } from '../device/keys';
import type { UserIdentity } from '../identity/userIdentity';

let counter = 1;
const nextEntropy = (): Uint8Array => new Uint8Array(32).fill(counter++);

export const makeDeviceKeys = (): DeviceKeys => {
  const statementAccountSeed = createSr25519Secret(nextEntropy());
  const encryptionPrivateKey = x25519.utils.randomSecretKey();
  return {
    statementAccountSeed,
    statementAccountPublicKey: deriveSr25519PublicKey(statementAccountSeed),
    encryptionPrivateKey,
    encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey),
  };
};

export const makeIdentity = (): UserIdentity => {
  const identityChatPrivateKey = x25519.utils.randomSecretKey();
  return {
    identityAccountId: nextEntropy(),
    rootAccountId: nextEntropy(),
    identityChatPrivateKey,
    identityChatPublicKey: x25519.getPublicKey(identityChatPrivateKey),
    peerDeviceEncPubKey: new Uint8Array(32).fill(0x77),
    peerStatementAccountId: null,
    pairedAt: 0,
  };
};

/** A user with one device, as both sides of every test see them. */
export type TestPeer = { identity: UserIdentity; device: DeviceKeys };

export const makePeer = (): TestPeer => ({ identity: makeIdentity(), device: makeDeviceKeys() });

export const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Poll until `probe` returns a truthy value; sessions settle over several macrotask turns. */
export const waitFor = async <T>(probe: () => T | Promise<T>, attempts = 200): Promise<NonNullable<T>> => {
  for (let i = 0; i < attempts; i++) {
    const value = await probe();
    if (value) return value;
    await tick();
  }
  throw new Error('waitFor: condition not met');
};
