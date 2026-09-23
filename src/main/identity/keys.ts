/**
 * The keys one identity binds together, all from one mnemonic. Same math as
 * `deriveIdentityKeys` in `.refs/bot-core/lib/register.mjs`:
 * - the `//wallet` sr25519 pair: the account the backend attests, and (single
 *   device) the account that signs this app's statements;
 * - the X25519 chat key, whose public half is the published identifier key.
 * The desktop adds a third, not in register.mjs: this device's X25519
 * encryption key (see `deviceEncryptionPrivateKey`).
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { mnemonicToEntropy, mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { generateMnemonic as bip39Generate } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import {
  deriveSr25519PairFromSeed,
  deriveX25519PrivateKey,
  encodeAccountEcdhKey,
  x25519PublicKeyFromPrivateKey,
} from './crypto';

export type IdentityKeys = {
  /** `//wallet` sr25519 public key: the identity account. */
  accountId: Uint8Array;
  /** 64-byte sr25519 secret (scure/HDKD form); the statement store accepts it as is. */
  walletSecret64: Uint8Array;
  chatPrivateKey: Uint8Array;
  chatPublicKey: Uint8Array;
  /**
   * This device's X25519 key (the `deviceEncPubKey` peers address), apart
   * from the chat key, as the mobile app keeps them apart. When the two are
   * equal, the device session's topics are the identity session's topics,
   * and bot-core reads a device statement with the identity key and drops it
   * (BOT_SESSION_DECODE_FAILED, docs/decisions.md M2). Derived, not random,
   * so a re-seed after a wiped IndexedDB gives back the key peers know.
   */
  deviceEncryptionPrivateKey: Uint8Array;
  /** RFC-0004 container published on chain: `0x00 || chatPublicKey || 32 zero bytes`. */
  identifierKey65: Uint8Array;
  /** Entropy for the lite-person proof. */
  liteEntropy: Uint8Array;
  sign: (message: Uint8Array) => Uint8Array;
};

/** A new 12-word English BIP39 mnemonic (128 bits), the length the Polkadot app uses. */
export const generateMnemonic = (): string => bip39Generate(wordlist, 128);

const DEVICE_KEY_CONTEXT = new TextEncoder().encode('polkadot-chat-desktop/device-encryption');

export const deriveIdentityKeys = (mnemonic: string): IdentityKeys => {
  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, '//wallet');
  const chatPrivateKey = deriveX25519PrivateKey(rootSeed);
  const chatPublicKey = x25519PublicKeyFromPrivateKey(chatPrivateKey);
  return {
    accountId: wallet.publicKey,
    walletSecret64: wallet.privateKey,
    chatPrivateKey,
    chatPublicKey,
    deviceEncryptionPrivateKey: blake2b(rootSeed, { key: DEVICE_KEY_CONTEXT, dkLen: 32 }),
    identifierKey65: encodeAccountEcdhKey(chatPublicKey),
    liteEntropy: blake2b(mnemonicToEntropy(mnemonic), { dkLen: 32 }),
    sign: wallet.sign,
  };
};

export const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
