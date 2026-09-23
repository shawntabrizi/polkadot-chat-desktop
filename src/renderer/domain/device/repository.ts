import { DEVICE_ROW_ID, appDatabase, db } from '../../app/database';

import {
  type DeviceKeys,
  ENCRYPTION_KEY_BYTES,
  STATEMENT_SEED_BYTES,
  generateEncryptionPrivateKey,
  generateStatementAccountSeed,
  toDeviceKeys,
} from './keys';

// One in-flight load per process, so two callers in the same tick converge on one
// key set instead of both minting.
let loading: Promise<DeviceKeys> | null = null;

const readStored = async (): Promise<DeviceKeys | null> => {
  const row = await db.device.get(DEVICE_ROW_ID);
  if (!row) return null;
  const [seed, encryptionPrivateKey] = await Promise.all([
    db.secrets.get('device.statementSeed'),
    db.secrets.get('device.encryptionPrivateKey'),
  ]);
  // A row without its secrets, or with a truncated key, reads as a miss: signing
  // with a malformed seed would produce statements no peer can verify.
  if (seed?.bytes.length !== STATEMENT_SEED_BYTES || encryptionPrivateKey?.bytes.length !== ENCRYPTION_KEY_BYTES) {
    console.warn('[device] dropped a malformed persisted key set');
    return null;
  }
  return toDeviceKeys(seed.bytes, encryptionPrivateKey.bytes);
};

const load = (): Promise<DeviceKeys> =>
  // One read-write transaction: a concurrent first launch in another tab sees
  // either nothing or the complete key set, never a row without its secrets.
  appDatabase.transaction('rw', db.device, db.secrets, async () => {
    const existing = await readStored();
    if (existing) return existing;

    const keys = toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey());
    await db.device.put({
      id: DEVICE_ROW_ID,
      statementAccountPublicKey: keys.statementAccountPublicKey,
      encryptionPublicKey: keys.encryptionPublicKey,
      createdAt: Date.now(),
    });
    await db.secrets.bulkPut([
      { id: 'device.statementSeed', bytes: keys.statementAccountSeed },
      { id: 'device.encryptionPrivateKey', bytes: keys.encryptionPrivateKey },
    ]);
    return keys;
  });

/** This device's keys, minted on first use and stable for the install. */
export const getDeviceKeys = (): Promise<DeviceKeys> => {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
};

/** Test hook: forget the cached promise so the next read hits the database. */
export const forgetCachedDeviceKeys = (): void => {
  loading = null;
};
