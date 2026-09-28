// M10a test helper: what the Polkadot app puts on the pairing topic, byte for
// byte (Android SsoHandshakeProtocol.kt / HandshakeAnswerScale.kt, checked
// 2026-09-28): the inner answer, ECDH-encrypted with a one-shot X25519 key to
// the device key in the QR offer, wrapped as `VersionedHandshakeResponse::V2`.
// Publish the result with `publishPairingResponse`. Test code only.

import { x25519 } from '@noble/curves/ed25519.js';
import { createEncryption } from '@novasamatech/statement-store';
import type { CodecType } from 'scale-ts';

import { EncryptedHandshakeResponseV2, type HandshakeSuccessV2, VersionedHandshakeResponse } from '../scale/handshakeV2';

type Inner = CodecType<typeof EncryptedHandshakeResponseV2>;

/** The statement data the phone submits for `inner`, readable only with the private half of `deviceEncryptionPublicKey`. */
export const phoneAnswer = (deviceEncryptionPublicKey: Uint8Array, inner: Inner): Uint8Array => {
  const tmpPrivate = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(tmpPrivate, deviceEncryptionPublicKey);
  const encrypted = createEncryption(shared).encrypt(EncryptedHandshakeResponseV2.enc(inner));
  if (encrypted.isErr()) throw encrypted.error;
  return VersionedHandshakeResponse.enc({ tag: 'V2', value: { encrypted: encrypted.value, tmpKey: x25519.getPublicKey(tmpPrivate) } });
};

export const pendingAnswer = (): Inner => ({ tag: 'Pending', value: { tag: 'AllowanceAllocation', value: undefined } });
export const failedAnswer = (reason: string): Inner => ({ tag: 'Failed', value: reason });
export const successAnswer = (value: CodecType<typeof HandshakeSuccessV2>): Inner => ({ tag: 'Success', value });
