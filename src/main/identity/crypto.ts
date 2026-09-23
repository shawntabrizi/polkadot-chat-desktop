// Copied from .refs/bot-core/vendor/lib/wallet-keys.mjs and
// .refs/bot-core/vendor/app-chat-codec.mjs on 2026-09-23; changes: only the
// functions identity registration needs (chainCode, parseSr25519DerivationPath,
// deriveSr25519PrivateKeyFromSeed, sr25519PairFromPrivateKey,
// deriveSr25519PairFromSeed, deriveX25519PrivateKey,
// x25519PublicKeyFromPrivateKey, encodeAccountEcdhKey and their private
// helpers), TypeScript types, `encodeAccountEcdhKey` takes a plain 32-byte key
// (the `{ kind }` forms are for peers' keys, which this app does not encode).

import crypto from 'node:crypto';

import { blake2b } from '@noble/hashes/blake2.js';
import { sr25519, sr25519Derive } from '@polkadot-labs/hdkd-helpers';

export type Sr25519Pair = {
  publicKey: Uint8Array;
  /** 64-byte sr25519 secret in the scure/HDKD form. */
  privateKey: Uint8Array;
  sign: (message: Uint8Array) => Uint8Array;
};

const textEncoder = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

// ── wallet-keys.mjs ──────────────────────────────────────────────────────

function scaleCompactLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`invalid SCALE compact length: ${length}`);
  }
  if (length < 1 << 6) {
    return Uint8Array.of(length << 2);
  }
  if (length < 1 << 14) {
    const value = (length << 2) | 0x01;
    return Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
  }
  if (length < 1 << 30) {
    const value = (length << 2) | 0x02;
    return Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  }
  throw new Error(`SCALE compact length is too large for derivation path: ${length}`);
}

// Substrate/app numeric path components use SCALE u64.
export function chainCode(junction: string | number | bigint): Uint8Array {
  const output = new Uint8Array(32);
  if (typeof junction === 'number' || typeof junction === 'bigint') {
    if (typeof junction === 'number' && (!Number.isSafeInteger(junction) || junction < 0)) {
      throw new Error(`substrate junction index must be a safe non-negative integer: ${junction}`);
    }
    let value = BigInt(junction);
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new Error(`substrate junction index must fit u64: ${junction}`);
    }
    for (let offset = 0; offset < 8; offset += 1) {
      output[offset] = Number(value & 0xffn);
      value >>= 8n;
    }
    return output;
  }

  const bytes = textEncoder.encode(String(junction));
  const encoded = concatBytes(scaleCompactLength(bytes.length), bytes);
  const chainBytes = encoded.length > 32 ? blake2b(encoded, { dkLen: 32 }) : encoded;
  output.set(chainBytes);
  return output;
}

export function parseSr25519DerivationPath(path: string): { hard: boolean; junction: string | bigint }[] {
  const derivations: { hard: boolean; junction: string | bigint }[] = [];
  for (const match of path.matchAll(/(\/{1,2})([^/]+)/g)) {
    const junction = match[2] ?? '';
    derivations.push({
      hard: match[1] === '//',
      junction: /^\d+$/.test(junction) ? BigInt(junction) : junction,
    });
  }
  return derivations;
}

export function deriveSr25519PrivateKeyFromSeed(seed: Uint8Array, derivationPath: string): Uint8Array {
  const derivations = parseSr25519DerivationPath(derivationPath).map(
    ({ hard, junction }): ['hard' | 'soft', Uint8Array] => [hard ? 'hard' : 'soft', chainCode(junction)],
  );
  const extractor = sr25519Derive(
    seed,
    {
      getPublicKey() {
        throw new Error('unused sr25519 private-key extractor public-key callback');
      },
      sign(_message, privateKey) {
        return privateKey as Uint8Array;
      },
      verify() {
        return false;
      },
    },
    derivations,
  );
  const privateKey = extractor.sign(new Uint8Array());
  if (privateKey.length !== 64) {
    throw new Error(`sr25519 derivation returned ${privateKey.length} bytes, expected 64`);
  }
  return privateKey;
}

export function sr25519PairFromPrivateKey(privateKey: Uint8Array): Sr25519Pair {
  if (privateKey.length !== 64) {
    throw new Error(`sr25519 private key must be 64 bytes, got ${privateKey.length}`);
  }
  return {
    publicKey: sr25519.getPublicKey(privateKey),
    privateKey,
    sign: message => sr25519.sign(message, privateKey),
  };
}

export function deriveSr25519PairFromSeed(seed: Uint8Array, derivationPath: string): Sr25519Pair {
  return sr25519PairFromPrivateKey(deriveSr25519PrivateKeyFromSeed(seed, derivationPath));
}

// ── app-chat-codec.mjs ───────────────────────────────────────────────────

function blake2b32(data: Uint8Array, key?: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, key });
}

function scaleCompactEncodeLength(length: number): Uint8Array {
  if (length < 0) {
    throw new Error(`Invalid compact length: ${length}`);
  }
  if (length < 64) {
    return Uint8Array.of(length << 2);
  }
  if (length < 16_384) {
    const encoded = (length << 2) | 0x01;
    return Uint8Array.of(encoded & 0xff, encoded >> 8);
  }
  // The codec goes on to larger forms; nothing here encodes more than a few bytes.
  throw new Error(`compact length too large: ${length}`);
}

function scaleEncodeBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes(scaleCompactEncodeLength(bytes.length), bytes);
}

const X25519_PRIVATE_KEY_DER_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function requireX25519Key(key: Uint8Array, label: string): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return key;
}

function x25519PrivateKeyObject(privateKey: Uint8Array): crypto.KeyObject {
  requireX25519Key(privateKey, 'X25519 private key');
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_KEY_DER_PREFIX, Buffer.from(privateKey)]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function deriveX25519PrivateKey(rootSeed: Uint8Array): Uint8Array {
  requireX25519Key(rootSeed, 'bot root seed');
  const ecdhRoot = blake2b32(rootSeed, textEncoder.encode('ecdh'));
  const chatChainCode = new Uint8Array(32);
  chatChainCode.set(scaleEncodeBytes(textEncoder.encode('chat')));
  // The app roots this tree in BIP39 entropy. Bots retain only BOT_SEED_HEX at
  // runtime, so registration and transport deliberately root it in that
  // 32-byte mini-secret instead. Interop requires their published key to match
  // each other; it does not require matching a mobile wallet's mnemonic tree.
  return blake2b32(ecdhRoot, chatChainCode);
}

export function x25519PublicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  const der = crypto.createPublicKey(x25519PrivateKeyObject(privateKey)).export({ format: 'der', type: 'spki' });
  return new Uint8Array(der.subarray(der.length - 32));
}

/** RFC-0004 container: `0x00 || x25519_pk || 32 zero bytes`. */
export function encodeAccountEcdhKey(publicKey: Uint8Array): Uint8Array {
  requireX25519Key(publicKey, 'X25519 public key');
  const container = new Uint8Array(65);
  container.set(publicKey, 1);
  return container;
}
