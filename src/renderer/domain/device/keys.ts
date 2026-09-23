// Mirrors polkadot-desktop src/domains/device/identity/service.ts.

import { x25519 } from '@noble/curves/ed25519.js';
import { createSr25519Secret, deriveSr25519PublicKey } from '@novasamatech/statement-store';

const STATEMENT_ENTROPY_BYTES = 32;
/** Expanded sr25519 secret, as `createSr25519Secret` produces it. */
export const STATEMENT_SEED_BYTES = 64;
/** X25519 key size (CHAT-RFC-0004). */
export const ENCRYPTION_KEY_BYTES = 32;

/**
 * This device's own keys. Minted once per install and never derived from the
 * paired identity: `statementAccountPublicKey` is how peers address this device,
 * so minting a second set would orphan every peer that knows the first.
 */
export type DeviceKeys = {
  statementAccountSeed: Uint8Array;
  statementAccountPublicKey: Uint8Array;
  encryptionPrivateKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
};

export const generateStatementAccountSeed = (): Uint8Array =>
  createSr25519Secret(crypto.getRandomValues(new Uint8Array(STATEMENT_ENTROPY_BYTES)));

export const deriveStatementAccountPublicKey = (seed: Uint8Array): Uint8Array => deriveSr25519PublicKey(seed);

export const generateEncryptionPrivateKey = (): Uint8Array => x25519.utils.randomSecretKey();

export const deriveEncryptionPublicKey = (privateKey: Uint8Array): Uint8Array => x25519.getPublicKey(privateKey);

/**
 * Size is all that can be checked: every 32-byte string is a valid X25519 key.
 * Degenerate keys are caught at agreement time (@noble rejects an all-zero
 * shared secret, RFC 7748).
 */
export const isValidEncryptionPublicKey = (bytes: Uint8Array): boolean => bytes.length === ENCRYPTION_KEY_BYTES;

const ACCOUNT_ID_BYTES = 32;

/**
 * A peer device as wire data. A malformed entry would break every outgoing
 * envelope to that contact (the per-device wrap throws), so it is checked
 * before it is persisted.
 */
export const isUsablePeerDevice = (device: { statementAccountId: Uint8Array; encryptionPublicKey: Uint8Array }): boolean =>
  device.statementAccountId.length === ACCOUNT_ID_BYTES && isValidEncryptionPublicKey(device.encryptionPublicKey);

export const toDeviceKeys = (statementAccountSeed: Uint8Array, encryptionPrivateKey: Uint8Array): DeviceKeys => ({
  statementAccountSeed,
  statementAccountPublicKey: deriveStatementAccountPublicKey(statementAccountSeed),
  encryptionPrivateKey,
  encryptionPublicKey: deriveEncryptionPublicKey(encryptionPrivateKey),
});
