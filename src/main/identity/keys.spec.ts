import { x25519 } from '@noble/curves/ed25519.js';
import { deriveSr25519PublicKey } from '@novasamatech/statement-store';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { describe, expect, it } from 'vitest';

import { deriveIdentityKeys, generateMnemonic } from './keys';

// Generated per run: no mnemonic, real or test, is written in the repo.
const mnemonic = generateMnemonic();

describe('generateMnemonic', () => {
  it('yields a valid 12-word English mnemonic, new each call', () => {
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validateMnemonic(mnemonic, wordlist)).toBe(true);
    expect(generateMnemonic()).not.toBe(mnemonic);
  });
});

describe('deriveIdentityKeys', () => {
  // The account and the chat key are what peers know this identity by; a
  // derivation that drifts between launches would orphan every contact.
  it('is deterministic for one mnemonic', () => {
    const first = deriveIdentityKeys(mnemonic);
    const second = deriveIdentityKeys(mnemonic);
    expect(second.accountId).toEqual(first.accountId);
    expect(second.chatPublicKey).toEqual(first.chatPublicKey);
    expect(second.walletSecret64).toEqual(first.walletSecret64);
    expect(deriveIdentityKeys(generateMnemonic()).accountId).not.toEqual(first.accountId);
  });

  it('publishes the chat key in the RFC-0004 container peers read', () => {
    const keys = deriveIdentityKeys(mnemonic);
    expect(keys.identifierKey65).toHaveLength(65);
    expect(keys.identifierKey65[0]).toBe(0);
    expect(keys.identifierKey65.slice(1, 33)).toEqual(keys.chatPublicKey);
    expect(keys.identifierKey65.slice(33)).toEqual(new Uint8Array(32));
  });

  // The renderer derives the X25519 public key with @noble; it must match the
  // key registration publishes, or peers encrypt to a key this app cannot open.
  it('chat public key matches @noble x25519, as the renderer derives it', () => {
    const keys = deriveIdentityKeys(mnemonic);
    expect(keys.chatPrivateKey).toHaveLength(32);
    expect(keys.chatPublicKey).toEqual(x25519.getPublicKey(keys.chatPrivateKey));
  });

  // Single device: the statement account must be the identity account, so the
  // 64-byte wallet secret seeded into Dexie must derive the attested account.
  it('wallet secret derives the identity account through the statement-store SDK', () => {
    const keys = deriveIdentityKeys(mnemonic);
    expect(keys.walletSecret64).toHaveLength(64);
    expect(deriveSr25519PublicKey(keys.walletSecret64)).toEqual(keys.accountId);
  });

  it('signs with the wallet key', () => {
    const keys = deriveIdentityKeys(mnemonic);
    expect(keys.sign(new Uint8Array([1, 2, 3]))).toHaveLength(64);
    expect(keys.liteEntropy).toHaveLength(32);
  });
});
