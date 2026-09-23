import { x25519 } from '@noble/curves/ed25519.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';
import { forgetCachedDeviceKeys, getDeviceKeys } from '../device/repository';
import type { HandshakeSuccessState } from '../pairing/v2/state';

import { clearUserIdentity, readUserIdentity, saveUserIdentity } from './userIdentity';

const chatPrivateKey = new Uint8Array(32).fill(0xdd);

const success: HandshakeSuccessState = {
  tag: 'Success',
  identityAccountId: new Uint8Array(32).fill(0xa1),
  rootAccountId: new Uint8Array(32).fill(0xa2),
  identityChatPrivateKey: chatPrivateKey,
  identityChatPublicKey: x25519.getPublicKey(chatPrivateKey),
  deviceEncPubKey: new Uint8Array(32).fill(0x04),
  ssoEncPubKey: new Uint8Array(32).fill(0x06),
  rootEntropySource: new Uint8Array(32).fill(0x07),
  peerStatementAccountId: new Uint8Array(32).fill(0x44),
};

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('user identity persistence', () => {
  it('reads back nothing before pairing', async () => {
    expect(await readUserIdentity()).toBeNull();
  });

  it('persists the Success payload and survives a reload', async () => {
    await saveUserIdentity(success);
    const identity = await readUserIdentity();
    expect(identity).toMatchObject({
      identityAccountId: success.identityAccountId,
      rootAccountId: success.rootAccountId,
      identityChatPrivateKey: chatPrivateKey,
      identityChatPublicKey: success.identityChatPublicKey,
      peerDeviceEncPubKey: success.deviceEncPubKey,
      peerStatementAccountId: success.peerStatementAccountId,
    });
  });

  it('keeps the chat private key out of the identity row', async () => {
    await saveUserIdentity(success);
    const row = await db.userIdentity.get('self');
    expect(JSON.stringify(row)).not.toContain('identityChatPrivateKey');
    expect((await db.secrets.get('identity.chatPrivateKey'))?.bytes).toEqual(chatPrivateKey);
  });

  // The chat key is the only way to read traffic addressed to the identity;
  // a row without it is a broken pairing, not a paired user.
  it('reads as unpaired when the chat key is gone', async () => {
    await saveUserIdentity(success);
    await db.secrets.delete('identity.chatPrivateKey');
    expect(await readUserIdentity()).toBeNull();
  });

  it('logout wipes the identity and its chat key but keeps the device keys', async () => {
    const deviceKeys = await getDeviceKeys();
    await saveUserIdentity(success);
    await clearUserIdentity();

    expect(await readUserIdentity()).toBeNull();
    expect(await db.secrets.get('identity.chatPrivateKey')).toBeUndefined();
    forgetCachedDeviceKeys();
    expect(await getDeviceKeys()).toEqual(deviceKeys);
  });
});
