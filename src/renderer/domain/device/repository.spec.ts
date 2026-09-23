import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';

import { ENCRYPTION_KEY_BYTES, STATEMENT_SEED_BYTES, deriveEncryptionPublicKey, deriveStatementAccountPublicKey } from './keys';
import { forgetCachedDeviceKeys, getDeviceKeys } from './repository';

beforeEach(async () => {
  forgetCachedDeviceKeys();
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('getDeviceKeys', () => {
  it('mints a complete key set on first use', async () => {
    const keys = await getDeviceKeys();
    expect(keys.statementAccountSeed).toHaveLength(STATEMENT_SEED_BYTES);
    expect(keys.encryptionPrivateKey).toHaveLength(ENCRYPTION_KEY_BYTES);
    expect(keys.statementAccountPublicKey).toEqual(deriveStatementAccountPublicKey(keys.statementAccountSeed));
    expect(keys.encryptionPublicKey).toEqual(deriveEncryptionPublicKey(keys.encryptionPrivateKey));
  });

  // Peers address this device by its statement account: a second mint would
  // orphan every peer that knows the first, and the phone rejects a re-pair
  // from a device it already knows under different keys.
  it('returns the same keys on every later read, including after a reload', async () => {
    const first = await getDeviceKeys();
    forgetCachedDeviceKeys();
    const second = await getDeviceKeys();
    expect(second).toEqual(first);
  });

  it('keeps the private halves only in the secrets table', async () => {
    const keys = await getDeviceKeys();
    const row = await db.device.get('self');
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual(['createdAt', 'encryptionPublicKey', 'id', 'statementAccountPublicKey']);
    expect((await db.secrets.get('device.statementSeed'))?.bytes).toEqual(keys.statementAccountSeed);
    expect((await db.secrets.get('device.encryptionPrivateKey'))?.bytes).toEqual(keys.encryptionPrivateKey);
  });

  it('treats a row whose secrets are missing as a miss and mints again', async () => {
    const first = await getDeviceKeys();
    await db.secrets.delete('device.statementSeed');
    forgetCachedDeviceKeys();
    const second = await getDeviceKeys();
    expect(second.statementAccountPublicKey).not.toEqual(first.statementAccountPublicKey);
    expect((await db.secrets.get('device.statementSeed'))?.bytes).toEqual(second.statementAccountSeed);
  });
});
