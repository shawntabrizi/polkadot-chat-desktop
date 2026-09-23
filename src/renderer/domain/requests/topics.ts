// Ported from polkadot-desktop src/domains/chat/p2p/requests/service.ts
// (`chatRequestTopicService`). Only the topics that reach the wire are kept:
// the desktop's V2 (senderDevice, recipientUser) topics are never published or
// subscribed by any client, so they are not ported (docs/decisions.md).

/**
 * Discovery topics for chat requests. Must match iOS byte-for-byte:
 *   - ChatRequest+PaginationTopic.swift → allPeerTopic, paginationTopic
 *   - ChatRequestFactory.swift → channelTopic
 *
 * Topics are blake2b-256 hashes of SCALE-encoded inputs; the channel topic is
 * a keyed hash so only the two parties can derive it.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { khash } from '@novasamatech/statement-store';
import { mergeUint8 } from 'polkadot-api/utils';
import { Bytes, Struct, u64 } from 'scale-ts';

/** 2025-11-15T00:00:00Z — the same day epoch as iOS and Android. */
const EPOCH = 1_763_164_800;
const SECONDS_IN_DAY = 86_400;

const CONTEXT = new TextEncoder().encode('chat-request');

const TopicWithoutDay = Struct({ context: Bytes(), accountId: Bytes() });
const TopicWithDay = Struct({ context: Bytes(), accountId: Bytes(), day: u64 });

/** Day number since EPOCH and the seconds until the next day; null before the epoch. */
export const getCurrentDay = (now = Date.now()): { day: bigint; remainedTillNext: number } | null => {
  const nowSecs = Math.floor(now / 1000);
  const elapsed = nowSecs - EPOCH;
  if (elapsed < 0) return null;
  const dayNumber = Math.floor(elapsed / SECONDS_IN_DAY);
  return { day: BigInt(dayNumber), remainedTillNext: EPOCH + (dayNumber + 1) * SECONDS_IN_DAY - nowSecs };
};

/** Full-history topic for a recipient identity: blake2b-256(SCALE(context, accountId)). */
export const computeAllPeerTopic = (recipientAccountId: Uint8Array): Uint8Array =>
  blake2b(TopicWithoutDay.enc({ context: CONTEXT, accountId: recipientAccountId }), { dkLen: 32 });

/** Day-scoped topic for a recipient identity: blake2b-256(SCALE(context, accountId, day)). */
export const computePaginationTopic = (recipientAccountId: Uint8Array, day: bigint): Uint8Array =>
  blake2b(TopicWithDay.enc({ context: CONTEXT, accountId: recipientAccountId, day }), { dkLen: 32 });

/**
 * Channel of one request: khash(sharedSecret, "chat-request" || ephemeralPubKey).
 * Both sides derive it, so the receiver never depends on the statement's own
 * channel field (Android omits it on the wire).
 */
export const computeChannelTopic = (ephemeralPublicKey: Uint8Array, sharedSecret: Uint8Array): Uint8Array =>
  khash(sharedSecret, mergeUint8([CONTEXT, ephemeralPublicKey]));
