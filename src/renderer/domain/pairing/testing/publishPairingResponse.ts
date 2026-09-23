// Ported from `publishPairingResponse` in triangle-js-sdks
// packages/host-papp/__tests__/peerSession.ts (host-papp 0.10.2). Test helper only.

import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import { toHex } from 'polkadot-api/utils';

import { computePairingChannel, computePairingTopic } from '../v2/topic.js';

// web: statement-store does not re-export SignedStatement; the SDK test takes it from sdk-statement.
type SignedStatement = Parameters<StatementStoreAdapter['submitStatement']>[0];

// Successive responses to one device share a channel, and the store keeps only
// the highest expiry — so each publish must outrank the last or it is silently
// dropped. Counted per channel rather than left to callers.
const publishedPerChannel = new Map<string, bigint>();

/**
 * Publish what the paired app answers a pairing proposal with, on the topic and
 * channel both sides derive from the device pubkeys in the QR proposal — so a
 * host subscribed to the wrong topic never sees it.
 */
export function publishPairingResponse(
  statementStore: StatementStoreAdapter,
  device: { statementAccountPublicKey: Uint8Array; encryptionPublicKey: Uint8Array },
  data: Uint8Array,
  { signer = `0x${'44'.repeat(32)}` }: { signer?: string } = {},
) {
  const channel = toHex(computePairingChannel(device.statementAccountPublicKey, device.encryptionPublicKey));
  const expiry = (publishedPerChannel.get(channel) ?? 0n) + 1n;
  publishedPerChannel.set(channel, expiry);

  return statementStore.submitStatement({
    data,
    expiry,
    channel,
    topics: [toHex(computePairingTopic(device.statementAccountPublicKey, device.encryptionPublicKey))],
    proof: { type: 'sr25519', value: { signature: `0x${'00'.repeat(64)}`, signer } },
  } as SignedStatement);
}
