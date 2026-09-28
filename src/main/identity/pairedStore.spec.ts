/**
 * M10a: the phone's sign-in on disk. The identity chat key reads every
 * message sent to the person, and the device key signs as this device on the
 * phone's allowance, so neither may sit in the file in clear. A damaged file
 * must fail loudly: a wrong key would chat as nobody, with no error to show.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import type { PairedIdentity } from '../../shared/desktop-api';

// A stand-in for the keychain: reversible, and never the plain text.
const seal = (bytes: Uint8Array): Buffer => Buffer.from(Array.from(bytes, byte => byte ^ 0x5a));
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => seal(Buffer.from(text, 'utf8')),
    decryptString: (sealed: Buffer) => seal(sealed).toString('utf8'),
  },
}));

const { PAIRED_FILE, forgetPairedAt, loadPairedAt, loadPairedPublicAt, savePairedAt } = await import('./pairedStore');
const { identityDisplay } = await import('../profiles');

const temp = mkdtempSync(join(tmpdir(), 'pcd-paired-spec-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;
const freshDir = (): string => mkdtempSync(join(temp, `p${++counter}-`));

const filled = (length: number, value: number) => new Uint8Array(length).fill(value);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

const identity = (overrides: Partial<PairedIdentity> = {}): PairedIdentity => ({
  profile: 'devnet',
  username: 'alicephone.07',
  pairedAt: 1_790_000_000_000,
  identityAccountId: filled(32, 1),
  rootAccountId: filled(32, 2),
  identityChatPrivateKey: filled(32, 3),
  phoneDeviceEncPubKey: filled(32, 4),
  phoneStatementAccountId: filled(32, 5),
  ssoEncPubKey: filled(32, 6),
  rootEntropySource: filled(32, 7),
  deviceStatementSeed: filled(64, 8),
  deviceEncryptionPrivateKey: filled(32, 9),
  ...overrides,
});

describe('paired identity store', () => {
  it('gives back every field it was given', () => {
    const dir = freshDir();
    savePairedAt(dir, identity());
    expect(loadPairedAt(dir)).toEqual(identity());
  });

  it('keeps no key in the clear, only the public fields', () => {
    const dir = freshDir();
    savePairedAt(dir, identity());
    const text = readFileSync(join(dir, PAIRED_FILE), 'utf8');
    for (const secret of [filled(32, 3), filled(64, 8), filled(32, 9), filled(32, 7)]) expect(text).not.toContain(hex(secret));
    expect(loadPairedPublicAt(dir)).toEqual({ profile: 'devnet', username: 'alicephone.07', pairedAt: 1_790_000_000_000, accountHex: `0x${hex(filled(32, 1))}` });
  });

  it('refuses a truncated key before it is saved', () => {
    const dir = freshDir();
    expect(() => savePairedAt(dir, identity({ identityChatPrivateKey: filled(31, 3) }))).toThrow(/identityChatPrivateKey/);
    expect(() => savePairedAt(dir, identity({ deviceStatementSeed: filled(32, 8) }))).toThrow(/device statement key/);
    expect(loadPairedPublicAt(dir)).toBeNull();
  });

  it('keeps a phone answer without a known signer', () => {
    const dir = freshDir();
    savePairedAt(dir, identity({ phoneStatementAccountId: null, username: null }));
    expect(loadPairedAt(dir)?.phoneStatementAccountId).toBeNull();
  });

  it('fails loudly on a damaged file instead of loading wrong keys', () => {
    const dir = freshDir();
    savePairedAt(dir, identity());
    const path = join(dir, PAIRED_FILE);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { secretsEncrypted: string };
    const opened = JSON.parse(seal(Buffer.from(file.secretsEncrypted, 'base64')).toString('utf8')) as Record<string, string>;
    opened.identityChatPrivateKey = '0x0102';
    writeFileSync(path, JSON.stringify({ ...file, secretsEncrypted: seal(Buffer.from(JSON.stringify(opened))).toString('base64') }));
    expect(() => loadPairedAt(dir)).toThrow(/damaged/);
  });

  it('sign out removes the file', () => {
    const dir = freshDir();
    savePairedAt(dir, identity());
    forgetPairedAt(dir);
    expect(loadPairedAt(dir)).toBeNull();
  });

  it('the profile picker names a phone sign-in by its username, else a short account', () => {
    const named = freshDir();
    savePairedAt(named, identity());
    expect(identityDisplay(named)).toEqual({ username: 'alicephone.07', network: 'devnet', accountHex: `0x${hex(filled(32, 1))}` });
    const unnamed = freshDir();
    savePairedAt(unnamed, identity({ username: null }));
    expect(identityDisplay(unnamed).username).toBe('0x010101…0101');
  });
});
