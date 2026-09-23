// Vendored from triangle-js-sdks packages/host-papp/src/sso/auth/v2/topic.ts
// (package @novasamatech/host-papp 0.10.2; the .refs checkout has no git metadata).
// The package does not export the V2 pairing flow from its index, so the file is
// copied here. Keep the diff against the source minimal; edits are marked "web:".

/**
 * Pairing topic + channel derivation for the V2 SSO handshake.
 *
 *   topic   = blake2b256_keyed(encryptionPublicKey || "topic",   key=statementAccountId)
 *   channel = blake2b256_keyed(encryptionPublicKey || "channel", key=statementAccountId)
 *
 * Where:
 *   - `statementAccountId`     = the host's sr25519 device public key (32 bytes)
 *   - `encryptionPublicKey`    = the host's X25519 device public key (32 bytes)
 *
 * Both sides compute the same topic/channel deterministically from the same
 * pubkeys carried in the QR-coded `VersionedHandshakeProposal::V2`, so they
 * agree on where the response statement is delivered without any shared
 * secret negotiation.
 */

import { khash } from '@novasamatech/statement-store';
// web: polkadot-api/utils re-exports @polkadot-api/utils; avoids a direct dependency.
import { mergeUint8 } from 'polkadot-api/utils';

const TOPIC_SUFFIX = new TextEncoder().encode('topic');
const CHANNEL_SUFFIX = new TextEncoder().encode('channel');

export const computePairingTopic = (statementAccountId: Uint8Array, encryptionPublicKey: Uint8Array): Uint8Array =>
  khash(statementAccountId, mergeUint8([encryptionPublicKey, TOPIC_SUFFIX]));

export const computePairingChannel = (statementAccountId: Uint8Array, encryptionPublicKey: Uint8Array): Uint8Array =>
  khash(statementAccountId, mergeUint8([encryptionPublicKey, CHANNEL_SUFFIX]));
