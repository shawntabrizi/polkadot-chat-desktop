/**
 * Spec 0011 private groups v2: keys, topic, channels, sealing and rekey
 * entries. Every value is pinned by docs/spec/vectors-0011.md.
 *
 *   Topic_e   = khash(K_e, b"grp-topic" : encode(groupId) : encode(e))
 *   MsgKey_e  = khash(K_e, b"grp-msg")
 *   ChMsgs_e  = khash(K_e, b"grp-ch-msgs")     a member's message carrier
 *   ChState_e = khash(K_e, b"grp-ch-state")    an admin's group state
 *   ChRekey_e = khash(K_e, b"grp-ch-rekey")    an admin's rekey out of epoch e
 *   Sealed    = AES-256-GCM(MsgKey_e, nonce, plaintext, aad = b"grp" : signer : encode(e) : variant)
 *   WrapKey(A, B, e) = khash(K(A, B), b"grp-wrap" : encode(groupId) : encode(e))
 *
 * K(A, B) is the raw X25519 agreement of the two identity chat keys (0011
 * reviewer ruling 4): the value the identity channel already uses, with no
 * HKDF step. Every device holds the identity chat key (mds.md), so every
 * device opens its member's rekey entry.
 *
 * AES-GCM runs on Web Crypto (renderer and Node alike), so seal and open are async.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import type { ExpiryAllocator } from '@novasamatech/statement-store';
import { str, u32 } from 'scale-ts';

import { type HexString, bytesEqual, hexToBytes } from '../../app/bytes';

import type { RekeyEntry, Sealed } from './groupCodec';

const label = (text: string): Uint8Array => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** Keyed BLAKE2b-256 (the base spec's `khash`). */
export const khash = (key: Uint8Array, payload: Uint8Array): Uint8Array => blake2b(payload, { key, dkLen: 32 });
/** Unkeyed BLAKE2b-256: `stateHash`. */
export const hash256 = (payload: Uint8Array): Uint8Array => blake2b(payload, { dkLen: 32 });

export type EpochKeys = {
  epoch: number;
  key: Uint8Array;
  topic: Uint8Array;
  msgKey: Uint8Array;
  channels: { msgs: Uint8Array; state: Uint8Array; rekey: Uint8Array };
};

export const groupTopic = (key: Uint8Array, groupId: string, epoch: number): Uint8Array => khash(key, concat(label('grp-topic'), str.enc(groupId), u32.enc(epoch)));

/** Everything a holder of `K_e` derives. */
export const deriveEpoch = (key: Uint8Array, groupId: string, epoch: number): EpochKeys => ({
  epoch,
  key,
  topic: groupTopic(key, groupId, epoch),
  msgKey: khash(key, label('grp-msg')),
  channels: { msgs: khash(key, label('grp-ch-msgs')), state: khash(key, label('grp-ch-state')), rekey: khash(key, label('grp-ch-rekey')) },
});

// ── AEAD ─────────────────────────────────────────────────────────────────

// Web Crypto wants ArrayBuffer-backed views; a copy makes any input one.
const buffer = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const aesGcmSeal = async (key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey('raw', buffer(key), 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(aad), tagLength: 128 }, cryptoKey, buffer(plaintext)));
};

/** Throws when the tag does not verify: a wrong key, signer, epoch or variant. */
export const aesGcmOpen = async (key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey('raw', buffer(key), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(aad), tagLength: 128 }, cryptoKey, buffer(sealed)));
};

/** `GroupData` variant bytes that `Sealed` binds to. */
export const VARIANT = { messages: 0, state: 1 } as const;

/** The AAD binds the ciphertext to its signer: a member cannot re-sign another's carrier as its own. */
export const sealAad = (signer: HexString, epoch: number, variant: number): Uint8Array => concat(label('grp'), hexToBytes(signer), u32.enc(epoch), Uint8Array.of(variant));

export const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export const seal = async (msgKey: Uint8Array, params: { signer: HexString; epoch: number; variant: number; plaintext: Uint8Array; nonce?: Uint8Array }): Promise<Sealed> => {
  const nonce = params.nonce ?? randomBytes(12);
  return { nonce, ciphertext: await aesGcmSeal(msgKey, nonce, params.plaintext, sealAad(params.signer, params.epoch, params.variant)) };
};

export const open = (msgKey: Uint8Array, params: { signer: HexString; epoch: number; variant: number; sealed: Sealed }): Promise<Uint8Array> =>
  aesGcmOpen(msgKey, params.sealed.nonce, params.sealed.ciphertext, sealAad(params.signer, params.epoch, params.variant));

// ── Pairwise wrap (rekey) ────────────────────────────────────────────────

/** K(A, B): raw X25519 of our identity chat private key and the peer's identity chat public key. */
export const pairwiseSecret = (ownIdentityChatPrivateKey: Uint8Array, peerIdentityChatPublicKey: Uint8Array): Uint8Array =>
  x25519.getSharedSecret(ownIdentityChatPrivateKey, peerIdentityChatPublicKey);

export const wrapKey = (kab: Uint8Array, groupId: string, epoch: number): Uint8Array => khash(kab, concat(label('grp-wrap'), str.enc(groupId), u32.enc(epoch)));
export const entryHint = (wrap: Uint8Array): Uint8Array => khash(wrap, label('grp-hint')).slice(0, 8);

export const makeRekeyEntry = async (kab: Uint8Array, params: { groupId: string; newEpoch: number; newKey: Uint8Array; nonce?: Uint8Array }): Promise<RekeyEntry> => {
  const wrap = wrapKey(kab, params.groupId, params.newEpoch);
  const nonce = params.nonce ?? randomBytes(12);
  return { hint: entryHint(wrap), nonce, box: await aesGcmSeal(wrap, nonce, params.newKey, u32.enc(params.newEpoch)) };
};

/** The new epoch key from our entry, or null (removed, or a rekey not meant for us). A hint can collide, so each match is tried. */
export const openRekeyEntry = async (kab: Uint8Array, params: { groupId: string; newEpoch: number; entries: readonly RekeyEntry[] }): Promise<Uint8Array | null> => {
  const wrap = wrapKey(kab, params.groupId, params.newEpoch);
  const hint = entryHint(wrap);
  for (const entry of params.entries) {
    if (!bytesEqual(entry.hint, hint)) continue;
    try {
      return await aesGcmOpen(wrap, entry.nonce, entry.box, u32.enc(params.newEpoch));
    } catch {
      // A colliding hint: try the next entry.
    }
  }
  return null;
};

/** Spec 0011 invite proof (M16b uses it; vector (e) pins it now). */
export const joinProof = (inviteSecret: Uint8Array, joiner: HexString): Uint8Array => khash(inviteSecret, concat(label('grp-join'), hexToBytes(joiner)));

// ── Statement expiry ─────────────────────────────────────────────────────

export const GROUP_EXPIRY_SECS = 14 * 86_400;
const PRIORITY_OFFSET = 1_763_164_800;

/**
 * The base spec's `Expiry` with `ExpirationTime` = now + 14 days:
 * `(now + 14 d) << 32 | (now − offset)`, strictly increasing per signer. The
 * expiration rises with each submission, so a replacement on the same
 * channel always wins; it is lower than a DM's `u32.max`, so a full account
 * loses group statements before DMs. The shape of the SDK's allocator, so the
 * SDK's submit adopts a chain-reported floor.
 */
export const createGroupExpiryAllocator = (now: () => number = Date.now): ExpiryAllocator => {
  let last = 0n;
  return {
    next: () => {
      const secs = Math.floor(now() / 1000);
      const fresh = (BigInt(secs + GROUP_EXPIRY_SECS) << 32n) | BigInt(Math.max(0, secs - PRIORITY_OFFSET));
      last = fresh > last ? fresh : last + 1n;
      return last;
    },
    // A channel floor (`ExpiryTooLow`) is adopted. An `AccountFull` floor from
    // a DM (expiration u32.max) is not: a group statement must stay below DMs,
    // or it would evict the account's DM statements (0011 GroupExpiry).
    raiseFloor: min => {
      const ceiling = BigInt(Math.floor(now() / 1000) + GROUP_EXPIRY_SECS);
      if (min > last && min >> 32n <= ceiling) last = min;
    },
  };
};
