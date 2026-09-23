import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase } from './database';
import { readNetworkProfileId, readSetting, writeNetworkProfileId, writeSetting } from './settings';

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('settings', () => {
  it('defaults the network profile to devnet and persists a change', async () => {
    expect(await readNetworkProfileId()).toBe('devnet');
    await writeNetworkProfileId('paseo');
    expect(await readNetworkProfileId()).toBe('paseo');
  });

  it('falls back to the default when the stored profile id is unknown', async () => {
    await writeSetting('networkProfile', 'mainnet');
    expect(await readNetworkProfileId()).toBe('devnet');
  });

  it('round-trips the processed pairing statement marker', async () => {
    expect(await readSetting('pairing.processedStatementHex')).toBeNull();
    await writeSetting('pairing.processedStatementHex', '0xabcd');
    expect(await readSetting('pairing.processedStatementHex')).toBe('0xabcd');
  });
});
