/**
 * M10a: the identity the phone handed over, on disk as
 * `<userData>/paired-identity.json`: the public part in clear (the profile
 * picker reads it, as it reads `identity.json`), the keys sealed with
 * Electron `safeStorage`. A separate file, not a second shape of
 * `identity.json`: every seed user (`loadIdentity`) keeps its one shape, and
 * finds nothing for a paired identity.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, safeStorage } from 'electron';

import type { PairedIdentity } from '../../shared/desktop-api';
import { isNetworkProfileId } from '../../shared/network';
import { type PairedPublic, decodePairedSecrets, encodePairedSecrets, pairedIdentityProblem, pairedPublicOf } from '../../shared/pairedIdentity';

export const PAIRED_FILE = 'paired-identity.json';

type PairedFile = PairedPublic & { version: 1; kind: 'paired'; secretsEncrypted: string };

const pairedPath = (dir: string): string => join(dir, PAIRED_FILE);

const requireEncryption = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The system keychain is not available, so the sign-in cannot be stored safely.');
  }
};

const parseFile = (raw: unknown): PairedFile => {
  const value = raw as Partial<PairedFile> | null;
  if (
    value?.version !== 1 ||
    value.kind !== 'paired' ||
    typeof value.accountHex !== 'string' ||
    !isNetworkProfileId(value.profile) ||
    !(value.username === null || typeof value.username === 'string') ||
    typeof value.pairedAt !== 'number' ||
    typeof value.secretsEncrypted !== 'string'
  ) {
    throw new Error(`${PAIRED_FILE} is not a version 1 sign-in file`);
  }
  return value as PairedFile;
};

const publicOf = (file: PairedFile): PairedPublic => ({ profile: file.profile, username: file.username, pairedAt: file.pairedAt, accountHex: file.accountHex });

/** Writes the file in `dir` (write then rename, as store.ts). Refuses a malformed identity. */
export const savePairedAt = (dir: string, identity: PairedIdentity): void => {
  const problem = pairedIdentityProblem(identity);
  if (problem) throw new Error(problem);
  requireEncryption();
  const file: PairedFile = {
    version: 1,
    kind: 'paired',
    ...pairedPublicOf(identity),
    secretsEncrypted: safeStorage.encryptString(encodePairedSecrets(identity)).toString('base64'),
  };
  const target = pairedPath(dir);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
};

/** The public part only, without the keychain; null when there is no file. */
export const loadPairedPublicAt = (dir: string): PairedPublic | null => {
  if (!existsSync(pairedPath(dir))) return null;
  return publicOf(parseFile(JSON.parse(readFileSync(pairedPath(dir), 'utf8'))));
};

/** The whole identity, decrypted; null when there is no file. */
export const loadPairedAt = (dir: string): PairedIdentity | null => {
  if (!existsSync(pairedPath(dir))) return null;
  const file = parseFile(JSON.parse(readFileSync(pairedPath(dir), 'utf8')));
  requireEncryption();
  const text = safeStorage.decryptString(Buffer.from(file.secretsEncrypted, 'base64'));
  return decodePairedSecrets(text, publicOf(file));
};

export const forgetPairedAt = (dir: string): void => {
  rmSync(pairedPath(dir), { force: true });
};

const userData = (): string => app.getPath('userData');
export const savePaired = (identity: PairedIdentity): void => savePairedAt(userData(), identity);
export const loadPairedPublic = (): PairedPublic | null => loadPairedPublicAt(userData());
export const loadPaired = (): PairedIdentity | null => loadPairedAt(userData());
export const forgetPaired = (): void => forgetPairedAt(userData());
