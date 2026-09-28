// Test helpers for a phone sign-in (M10a): the identity the phone hands over,
// the app's start as App.tsx runs it (seed Dexie, then the chat manager with
// the phone as one of our devices), and the phone's own writes on the store.

import { type StatementStoreAdapter, createExpiryAllocator, createSr25519Prover } from '@novasamatech/statement-store';

import { bytesToHex } from '../../app/bytes';
import type { IdentitySummary, PairedIdentity } from '../../../shared/desktop-api';
import { type ChatManager, createChatManager } from '../chat/manager';
import { createIdentityChannel } from '../chat/identityChannel';
import { deriveEncryptionPublicKey, generateEncryptionPrivateKey } from '../device/keys';
import { forgetCachedDeviceKeys, getDeviceKeys } from '../device/repository';
import type { IdentityLookup } from '../identity/lookup';
import { ensurePairedIdentitySeeded, pairedIdentityOf } from '../identity/pairedIdentity';
import { readUserIdentity } from '../identity/userIdentity';

import { type TestPeer, makeDeviceKeys, makePeer } from './peers';

/** Our identity as the phone holds it, the phone's device, and the sign-in this device keeps. */
export type PhoneSignIn = {
  phone: TestPeer;
  identityChatPrivateKey: Uint8Array;
  identityChatPublicKey: Uint8Array;
  paired: PairedIdentity;
  summary: IdentitySummary;
};

export const makePhoneSignIn = (): PhoneSignIn => {
  const phone = makePeer();
  const identityChatPrivateKey = generateEncryptionPrivateKey();
  const paired = pairedIdentityOf(
    {
      tag: 'Success',
      identityAccountId: phone.identity.identityAccountId,
      rootAccountId: phone.identity.rootAccountId,
      identityChatPrivateKey,
      identityChatPublicKey: deriveEncryptionPublicKey(identityChatPrivateKey),
      deviceEncPubKey: phone.device.encryptionPublicKey,
      ssoEncPubKey: new Uint8Array(32).fill(3),
      rootEntropySource: new Uint8Array(32).fill(4),
      peerStatementAccountId: phone.device.statementAccountPublicKey,
    },
    makeDeviceKeys(),
    'paseo',
    'me.01',
  );
  const summary: IdentitySummary = { username: 'me.01', accountHex: bytesToHex(paired.identityAccountId), profile: paired.profile, paired: true };
  return { phone, identityChatPrivateKey, identityChatPublicKey: deriveEncryptionPublicKey(identityChatPrivateKey), paired, summary };
};

/** One app start on the Dexie there is: App.tsx `start`, then the manager as App.tsx makes it for a phone sign-in. */
export const startPhoneSignedIn = async (
  signIn: PhoneSignIn,
  statementStore: StatementStoreAdapter,
  lookup: IdentityLookup,
  pairedSecrets: () => Promise<PairedIdentity> = async () => signIn.paired,
): Promise<ChatManager> => {
  forgetCachedDeviceKeys();
  await ensurePairedIdentitySeeded(signIn.summary, pairedSecrets);
  const [deviceKeys, identity] = await Promise.all([getDeviceKeys(), readUserIdentity()]);
  if (!identity) throw new Error('no identity after seeding');
  return createChatManager({
    identity,
    deviceKeys,
    statementStore,
    lookup,
    phone: {
      device: { statementAccountId: signIn.phone.device.statementAccountPublicKey, encryptionPublicKey: signIn.phone.device.encryptionPublicKey },
      linkFactory: null,
      tightBudget: async () => true,
      onRemoved: () => undefined,
    },
  });
};

/**
 * The phone accepts `requestId` from `peer`, as Android does: `DeviceChatAccepted`
 * on the identity session SessionId(us, peer), signed by the phone's statement account.
 * `signer` overrides who signs (a forger).
 */
export const acceptOnPhone = async (
  signIn: PhoneSignIn,
  statementStore: StatementStoreAdapter,
  peer: TestPeer,
  requestId: string,
  signer: TestPeer = signIn.phone,
): Promise<VoidFunction> => {
  const channel = createIdentityChannel({
    ownIdentityAccountId: signIn.paired.identityAccountId,
    ownIdentityChatPrivateKey: signIn.identityChatPrivateKey,
    peerIdentityAccountId: peer.identity.identityAccountId,
    peerIdentityChatPublicKey: peer.identity.identityChatPublicKey,
    prover: createSr25519Prover(signer.device.statementAccountSeed),
    allocator: createExpiryAllocator(),
    statementStore,
    onEvent: () => undefined,
  });
  await channel.post({
    tag: 'deviceChatAccepted',
    value: { requestId, device: { statementAccountId: signIn.phone.device.statementAccountPublicKey, encryptionPublicKey: signIn.phone.device.encryptionPublicKey } },
  });
  return channel.dispose;
};
