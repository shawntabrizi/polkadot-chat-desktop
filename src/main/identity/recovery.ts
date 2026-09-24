/**
 * M19: the recovery phrase is the only backup of an identity. "Show recovery
 * phrase" (Settings › Security) hands the sealed mnemonic to the page only
 * after the person typed `reveal`; "Add profile from a recovery phrase" (the
 * picker) derives the identity again and reads its username from the People
 * chain. Neither logs the phrase or puts it in an error message; the only
 * place it is written is `saveIdentityAt`, sealed with safeStorage.
 */

import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';

import { bytesToHex, deriveIdentityKeys } from './keys';
import type { StoredIdentity } from './store';

/** The word the person types before the phrase shows (Settings › Security). */
export const REVEAL_WORD = 'reveal';

/** The mnemonic of `identity`, only for the typed word: a stray click or a script must not get it. */
export const revealRecoveryPhrase = (confirm: unknown, identity: StoredIdentity | null): string => {
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== REVEAL_WORD) throw new Error(`Type the word ${REVEAL_WORD} to show the recovery phrase.`);
  if (!identity) throw new Error('This profile has no identity yet.');
  return identity.mnemonic;
};

/** Lowercase words with one space between them, as `generateMnemonic` makes them. */
export const normalizePhrase = (phrase: string): string => phrase.trim().toLowerCase().split(/\s+/).join(' ');

export type RecoverInput = {
  phrase: string;
  network: NetworkProfileId;
  /** The username the People chain holds for the account (best block); null when none. */
  usernameOf: (accountHex: string) => Promise<string | null>;
};

/**
 * The identity a phrase restores: the same keys as at sign-up (the account
 * comes from the phrase, not from the chain) and the username the chain
 * holds for that account. Refuses a phrase with no username on `network`:
 * a restored profile without a name could not be found by anyone.
 */
export const recoverIdentity = async ({ phrase, network, usernameOf }: RecoverInput): Promise<StoredIdentity> => {
  const mnemonic = normalizePhrase(phrase);
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('This is not a valid recovery phrase. Check the words and their order.');
  const accountHex = bytesToHex(deriveIdentityKeys(mnemonic).accountId);
  const username = await usernameOf(accountHex);
  if (!username) throw new Error(`No username on ${NETWORK_PROFILES[network].label} belongs to this recovery phrase. Check the network.`);
  return { mnemonic, username, accountHex, profile: network };
};
