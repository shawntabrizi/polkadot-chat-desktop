/**
 * The at-rest key of the renderer's `keys` table (M16b): 32 random bytes,
 * made once per profile and kept in `<userData>/storage-key.json` encrypted
 * with Electron `safeStorage` (the OS keychain on macOS), as the identity
 * mnemonic is. The renderer holds it in memory only, so a copy of the
 * IndexedDB folder alone opens no group key.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, safeStorage } from 'electron';

type KeyFile = { version: 1; keyEncrypted: string };

const keyPath = (): string => join(app.getPath('userData'), 'storage-key.json');

let cached: Uint8Array | null = null;

export const storageKey = (): Uint8Array => {
  if (cached) return cached;
  // No plaintext fallback, as for the mnemonic: a key in the clear next to the data protects nothing.
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain is not available, so group keys cannot be stored safely.');
  const path = keyPath();
  if (existsSync(path)) {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<KeyFile>;
    if (file.version !== 1 || typeof file.keyEncrypted !== 'string') throw new Error('storage-key.json is not a version 1 key file');
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(file.keyEncrypted, 'base64')), 'base64');
    if (key.length !== 32) throw new Error('storage-key.json holds a key of the wrong length');
    cached = new Uint8Array(key);
    return cached;
  }
  const key = randomBytes(32);
  const file: KeyFile = { version: 1, keyEncrypted: safeStorage.encryptString(key.toString('base64')).toString('base64') };
  // Write then rename: a half-written file would lose every group key sealed with it.
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  cached = new Uint8Array(key);
  return cached;
};
