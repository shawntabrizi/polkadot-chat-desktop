/**
 * M10a: the paired identity (desktop-api.ts `PairedIdentity`) as the two
 * stores keep it. Main seals the secret part with safeStorage
 * (main/identity/pairedStore.ts); the web build seals it under the
 * passphrase key (web/identity.ts). Both check it here first, so a
 * malformed answer from the phone is refused before it is saved, not when
 * the first statement fails to verify.
 */

import type { IdentitySummary, PairedIdentity } from './desktop-api';
import { isNetworkProfileId } from './network';

const KEY_BYTES = 32;
const SEED_BYTES = 64;

/** The fields that go sealed; the rest (profile, username, pairedAt, the identity account) is public. */
const SECRET_FIELDS = [
  'rootAccountId',
  'identityChatPrivateKey',
  'phoneDeviceEncPubKey',
  'ssoEncPubKey',
  'rootEntropySource',
  'deviceStatementSeed',
  'deviceEncryptionPrivateKey',
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];

const toHex = (bytes: Uint8Array): string => `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;

const fromHex = (hex: unknown): Uint8Array | null => {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  return Uint8Array.from(hex.slice(2).match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? []);
};

const sized = (bytes: unknown, length: number): boolean => bytes instanceof Uint8Array && bytes.length === length;

/** Why `identity` cannot be kept, or null. */
export const pairedIdentityProblem = (identity: PairedIdentity): string | null => {
  if (!isNetworkProfileId(identity?.profile)) return 'Unknown network.';
  if (identity.username !== null && (typeof identity.username !== 'string' || identity.username.length === 0 || identity.username.length > 64)) return 'Invalid username.';
  if (!Number.isSafeInteger(identity.pairedAt) || identity.pairedAt <= 0) return 'Invalid pairing time.';
  if (!sized(identity.identityAccountId, KEY_BYTES)) return 'Invalid identity account.';
  if (identity.phoneStatementAccountId !== null && !sized(identity.phoneStatementAccountId, KEY_BYTES)) return 'Invalid phone statement account.';
  if (!sized(identity.deviceStatementSeed, SEED_BYTES)) return 'Invalid device statement key.';
  for (const field of SECRET_FIELDS) {
    if (field !== 'deviceStatementSeed' && !sized(identity[field], KEY_BYTES)) return `Invalid ${field}.`;
  }
  return null;
};

/** The sealed part as text (0x-hex fields in JSON), for safeStorage `encryptString` or the web vault. */
export const encodePairedSecrets = (identity: PairedIdentity): string => {
  const out: Record<string, string | null> = {};
  for (const field of SECRET_FIELDS) out[field] = toHex(identity[field]);
  out.phoneStatementAccountId = identity.phoneStatementAccountId ? toHex(identity.phoneStatementAccountId) : null;
  return JSON.stringify(out);
};

export type PairedPublic = Pick<PairedIdentity, 'profile' | 'username' | 'pairedAt'> & { accountHex: string };

/** The public part, stored in clear next to the sealed text. */
export const pairedPublicOf = (identity: PairedIdentity): PairedPublic => ({
  profile: identity.profile,
  username: identity.username,
  pairedAt: identity.pairedAt,
  accountHex: toHex(identity.identityAccountId),
});

/** Throws when the stored text or the public part is damaged: signing with a wrong key would chat as nobody. */
export const decodePairedSecrets = (text: string, publicPart: PairedPublic): PairedIdentity => {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const secrets = {} as Record<SecretField, Uint8Array>;
  for (const field of SECRET_FIELDS) {
    const bytes = fromHex(raw[field]);
    if (!bytes) throw new Error('The saved sign-in is damaged.');
    secrets[field] = bytes;
  }
  const phone = raw.phoneStatementAccountId === null ? null : fromHex(raw.phoneStatementAccountId);
  const identityAccountId = fromHex(publicPart.accountHex);
  if (!identityAccountId || (raw.phoneStatementAccountId !== null && !phone)) throw new Error('The saved sign-in is damaged.');
  const identity: PairedIdentity = {
    profile: publicPart.profile,
    username: publicPart.username,
    pairedAt: publicPart.pairedAt,
    identityAccountId,
    phoneStatementAccountId: phone,
    ...secrets,
  };
  const problem = pairedIdentityProblem(identity);
  if (problem) throw new Error(`The saved sign-in is damaged: ${problem}`);
  return identity;
};

/** The name to show: the username, else a short form of the account. */
export const pairedDisplayName = (publicPart: Pick<PairedPublic, 'username' | 'accountHex'>): string =>
  publicPart.username ?? `${publicPart.accountHex.slice(0, 8)}…${publicPart.accountHex.slice(-4)}`;

export const pairedSummaryOf = (publicPart: PairedPublic): IdentitySummary => ({
  username: pairedDisplayName(publicPart),
  accountHex: publicPart.accountHex,
  profile: publicPart.profile,
  paired: true,
});
