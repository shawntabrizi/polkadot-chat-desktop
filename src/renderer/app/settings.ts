import { DEFAULT_NETWORK_PROFILE, type NetworkProfileId, isNetworkProfileId } from './network';
import { type SettingKey, db } from './database';

export const readSetting = async (key: SettingKey): Promise<string | null> => (await db.settings.get(key))?.value ?? null;

export const writeSetting = (key: SettingKey, value: string): Promise<unknown> => db.settings.put({ key, value });

/** A value written by an older build that is no longer a profile id reads as the default. */
export const readNetworkProfileId = async (): Promise<NetworkProfileId> => {
  const stored = await readSetting('networkProfile');
  return isNetworkProfileId(stored) ? stored : DEFAULT_NETWORK_PROFILE;
};

export const writeNetworkProfileId = (id: NetworkProfileId): Promise<unknown> => writeSetting('networkProfile', id);
