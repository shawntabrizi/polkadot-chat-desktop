import { describe, expect, it } from 'vitest';

import { WRONG_PASSPHRASE, deriveVaultKey, newVaultParams, openSecret, passphraseProblem, sealSecret } from './vault';

// M22a: the web keeps the mnemonic only sealed under the passphrase. These
// pin that a wrong passphrase or a moved ciphertext never opens.

const params = newVaultParams(1_000);
const secret = new TextEncoder().encode('twelve words of a recovery phrase');

describe('web vault', () => {
  it('opens what it sealed with the same passphrase', async () => {
    const sealed = await sealSecret(await deriveVaultKey('correct horse', params), secret, 'identity.mnemonic');
    expect(await openSecret(await deriveVaultKey('correct horse', params), sealed, 'identity.mnemonic')).toEqual(secret);
  });

  it('refuses a wrong passphrase with a plain message', async () => {
    const sealed = await sealSecret(await deriveVaultKey('correct horse', params), secret, 'identity.mnemonic');
    await expect(openSecret(await deriveVaultKey('wrong horse!', params), sealed, 'identity.mnemonic')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('refuses a sealed value moved to another field', async () => {
    const key = await deriveVaultKey('correct horse', params);
    const sealed = await sealSecret(key, secret, 'identity.mnemonic');
    await expect(openSecret(key, sealed, 'identity.atRestKey')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('uses a new salt per vault and a new nonce per seal, so equal inputs differ on disk', async () => {
    expect(newVaultParams().salt).not.toEqual(newVaultParams().salt);
    const key = await deriveVaultKey('correct horse', params);
    const [a, b] = [await sealSecret(key, secret, 'x'), await sealSecret(key, secret, 'x')];
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.ciphertext).not.toEqual(secret);
  });

  it('asks for at least 8 characters', () => {
    expect(passphraseProblem('short')).toMatch(/at least 8/);
    expect(passphraseProblem('long enough')).toBeNull();
  });
});
