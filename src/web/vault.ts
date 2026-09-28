/**
 * M22a secrets on the web: nothing secret is stored in clear. A key derived
 * from the person's passphrase (PBKDF2-SHA256, WebCrypto) seals the
 * mnemonic and the at-rest key with AES-256-GCM. The derived key is
 * non-extractable and lives in memory for one page session only; a reload
 * asks for the passphrase again. No Argon2: it is not a dependency here.
 */

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;
export const WRONG_PASSPHRASE = 'Wrong passphrase.';

export type VaultParams = { kdf: 'PBKDF2-SHA256'; iterations: number; salt: Uint8Array };
export type SealedSecret = { iv: Uint8Array; ciphertext: Uint8Array };

export const newVaultParams = (iterations = PBKDF2_ITERATIONS): VaultParams => ({
  kdf: 'PBKDF2-SHA256',
  iterations,
  salt: crypto.getRandomValues(new Uint8Array(16)),
});

export const passphraseProblem = (passphrase: string): string | null =>
  passphrase.length < MIN_PASSPHRASE_LENGTH ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` : null;

export const deriveVaultKey = async (passphrase: string, params: VaultParams): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(params.salt), iterations: params.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

/** `aad` names the record field, so a sealed value moved to another field does not open. */
export const sealSecret = async (key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<SealedSecret> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new Uint8Array(plaintext));
  return { iv, ciphertext: new Uint8Array(ciphertext) };
};

/** Rejects with `WRONG_PASSPHRASE` when the key does not open it (GCM tag mismatch). */
export const openSecret = async (key: CryptoKey, sealed: SealedSecret, aad: string): Promise<Uint8Array> => {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: new TextEncoder().encode(aad) }, key, new Uint8Array(sealed.ciphertext)),
    );
  } catch {
    throw new Error(WRONG_PASSPHRASE);
  }
};
