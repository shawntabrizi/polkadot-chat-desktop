/**
 * The identity mnemonic on disk: `<userData>/identity.json`, the mnemonic
 * encrypted with Electron `safeStorage` (the OS keychain on macOS). It lives in
 * the main process so it survives a wiped IndexedDB; the renderer never sees it.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, safeStorage } from 'electron';

import { type NetworkProfileId, isNetworkProfileId } from '../../shared/network';

export type StoredIdentity = {
  username: string;
  accountHex: string;
  profile: NetworkProfileId;
  mnemonic: string;
};

type IdentityFile = {
  version: 1;
  username: string;
  accountHex: string;
  profile: NetworkProfileId;
  mnemonicEncrypted: string;
};

const identityPath = (): string => join(app.getPath('userData'), 'identity.json');

// No plaintext fallback: a mnemonic on disk in the clear is worse than no app.
const requireEncryption = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The system keychain is not available, so the identity cannot be stored safely.');
  }
};

export const saveIdentity = ({ mnemonic, username, accountHex, profile }: StoredIdentity): void => {
  requireEncryption();
  const file: IdentityFile = {
    version: 1,
    username,
    accountHex,
    profile,
    mnemonicEncrypted: safeStorage.encryptString(mnemonic).toString('base64'),
  };
  const target = identityPath();
  const tmp = `${target}.tmp`;
  // Write then rename: a crash mid-write must not leave a half file where the only copy of the key was.
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
};

const parseFile = (raw: unknown): IdentityFile => {
  const value = raw as Partial<IdentityFile> | null;
  if (
    value?.version !== 1 ||
    typeof value.username !== 'string' ||
    typeof value.accountHex !== 'string' ||
    !isNetworkProfileId(value.profile) ||
    typeof value.mnemonicEncrypted !== 'string'
  ) {
    throw new Error('identity.json is not a version 1 identity file');
  }
  return value as IdentityFile;
};

/** `null` when this machine has no identity yet. */
export const loadIdentity = (): StoredIdentity | null => {
  const path = identityPath();
  if (!existsSync(path)) return null;
  const file = parseFile(JSON.parse(readFileSync(path, 'utf8')));
  requireEncryption();
  const mnemonic = safeStorage.decryptString(Buffer.from(file.mnemonicEncrypted, 'base64'));
  return { username: file.username, accountHex: file.accountHex, profile: file.profile, mnemonic };
};

const backupPath = (): string => `${identityPath()}.bak`;

/**
 * "Reset identity" acts at once but can be undone for a short grace period
 * (SKILL.md "Destructive actions must be undoable"): the file moves aside to
 * `identity.json.bak` instead of being deleted. `restoreIdentity` undoes it,
 * `dropIdentityBackup` ends it. There is no other backup in v1, so once the
 * backup is dropped the mnemonic, and with it the claimed username, is gone.
 */
export const stashIdentity = (): void => {
  if (!existsSync(identityPath())) throw new Error('This computer has no identity to reset.');
  renameSync(identityPath(), backupPath());
};

/** `false` when there is nothing to restore or a new identity took the place. */
export const restoreIdentity = (): boolean => {
  if (!existsSync(backupPath()) || existsSync(identityPath())) return false;
  renameSync(backupPath(), identityPath());
  return true;
};

export const dropIdentityBackup = (): void => {
  rmSync(backupPath(), { force: true });
};
