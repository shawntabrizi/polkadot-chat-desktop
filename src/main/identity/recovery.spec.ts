/**
 * M19 recovery phrase. The phrase is the whole identity: whoever reads it
 * from a log or a file owns the username and the funds. So the reveal needs
 * the typed word, nothing logs it, and the only file that holds it holds it
 * sealed. A restore is useful only if it gives back the very account the
 * sign-up made: the username, the chats' keys and the funds hang on it.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { bytesToHex, deriveIdentityKeys, generateMnemonic } = await import('./keys');
const { REVEAL_WORD, recoverIdentity, revealRecoveryPhrase } = await import('./recovery');
const { loadIdentityAt, saveIdentityAt } = await import('./store');
const { addRestoredProfile, ensureLayout, readProfiles } = await import('../profiles');

const temp = mkdtempSync(join(tmpdir(), 'pcd-recovery-spec-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let root = '';
let counter = 0;

/** Every console and stdout/stderr line the code under test writes. */
let printed: string[] = [];
beforeEach(() => {
  root = join(temp, `root-${++counter}`);
  mkdirSync(root);
  ensureLayout(root, 1);
  printed = [];
  const keep = (...args: unknown[]) => {
    printed.push(args.map(arg => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => (keep(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => (keep(String(chunk)), true));
});
afterEach(() => vi.restoreAllMocks());

/** The sign-up's account for a phrase: `createIdentity` computes it this way (service.ts). */
const signUpAccount = (mnemonic: string): string => bytesToHex(deriveIdentityKeys(mnemonic).accountId);

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const restore = async (phrase: string, username: string | null = 'alice.42') => {
  const asked: string[] = [];
  const identity = await recoverIdentity({
    phrase,
    network: 'devnet',
    usernameOf: async accountHex => {
      asked.push(accountHex);
      return username;
    },
  });
  const name = addRestoredProfile(root, identity.accountHex, dir => saveIdentityAt(join(dir, 'identity.json'), identity), 2);
  return { identity, name, asked };
};

describe('restore from a recovery phrase', () => {
  it('yields the account the sign-up made, even from a phrase typed with capitals and extra spaces', async () => {
    const mnemonic = generateMnemonic();
    const typed = `  ${mnemonic.toUpperCase().split(' ').join('   \n ')}  `;
    const { identity, name, asked } = await restore(typed);
    expect(identity.accountHex).toBe(signUpAccount(mnemonic));
    // The username is read for that same account, so the profile gets its own name back.
    expect(asked).toEqual([signUpAccount(mnemonic)]);
    expect(readProfiles(root)?.profiles.find(entry => entry.name === name)).toMatchObject({ username: 'alice.42', network: 'devnet', accountHex: signUpAccount(mnemonic) });
    // Opening the profile later decrypts to keys of the same account.
    const saved = loadIdentityAt(join(root, 'profiles', name, 'identity.json'));
    expect(saved && signUpAccount(saved.mnemonic)).toBe(signUpAccount(mnemonic));
  });

  it('refuses a phrase a profile already holds: one identity must not run in two profiles', async () => {
    const mnemonic = generateMnemonic();
    const first = await restore(mnemonic);
    await expect(restore(mnemonic)).rejects.toThrow(/already in the profile/);
    expect(readProfiles(root)?.profiles.map(entry => entry.name)).toEqual(['default', first.name]);
  });

  it('refuses a phrase with no username on the network and creates no profile', async () => {
    await expect(restore(generateMnemonic(), null)).rejects.toThrow(/No username on Devnet/);
    expect(readProfiles(root)?.profiles.map(entry => entry.name)).toEqual(['default']);
    expect(readdirSync(join(root, 'profiles'))).toEqual(['default']);
  });
});

describe('the phrase never leaks', () => {
  it('is never logged or written unsealed by a restore, a reveal or a refused attempt', async () => {
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    const { name } = await restore(mnemonic);
    const saved = loadIdentityAt(join(root, 'profiles', name, 'identity.json'));
    expect(revealRecoveryPhrase(REVEAL_WORD, saved)).toBe(mnemonic);
    // A typo in the phrase (two words swapped) is refused without echoing it.
    const typo = [words[1], words[0], ...words.slice(2)].join(' ');
    const refusal = await restore(typo).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    let wrongWord = '';
    try {
      revealRecoveryPhrase('show', saved);
    } catch (error) {
      wrongWord = (error as Error).message;
    }
    for (const message of [refusal, wrongWord]) {
      expect(message).not.toContain(mnemonic);
      expect(message).not.toContain(typo);
    }
    for (const line of printed) {
      expect(line).not.toContain(mnemonic);
      expect(line).not.toContain(typo);
    }
    // Every file the restore wrote: the phrase is in none of them, in any common shape.
    const shapes = [mnemonic, words.join(','), JSON.stringify(words), words.join('\n'), words.join('')];
    for (const path of filesUnder(root)) {
      const text = readFileSync(path, 'utf8');
      for (const shape of shapes) expect(text, path).not.toContain(shape);
    }
  });

  it('reveals only for the typed word, and only when there is an identity', () => {
    const identity = { mnemonic: generateMnemonic(), username: 'alice.42', accountHex: '0x00', profile: 'devnet' as const };
    for (const wrong of ['', 'yes', 'revea', undefined, 1]) expect(() => revealRecoveryPhrase(wrong, identity)).toThrow(/Type the word reveal/);
    expect(revealRecoveryPhrase('  Reveal ', identity)).toBe(identity.mnemonic);
    expect(() => revealRecoveryPhrase('reveal', null)).toThrow(/no identity/);
  });
});
