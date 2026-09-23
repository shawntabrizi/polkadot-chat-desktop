/**
 * Peer identity lookup on the People chain (`Resources.Consumers`) through
 * @novasamatech/host-papp. The SDK already unwraps the RFC-0004 container
 * (`0x00 || x25519_pk || pad`) and hands back the 32-byte X25519 key as hex,
 * so nothing is stripped here (see docs/decisions.md).
 *
 * The repository caches per account. A memory cache is enough: keys are
 * re-read on every app start, and a rotated key must not be served from disk.
 */

import { type IdentityRepository, createIdentityRepository, createIdentityRpcAdapter } from '@novasamatech/host-papp';
import type { LazyClient } from '@novasamatech/statement-store';
import { errAsync, okAsync } from 'neverthrow';

import { bytesToHex, hexToBytes } from '../../app/bytes';

export type PeerIdentity = {
  accountId: Uint8Array;
  username: string;
  chatPublicKey: Uint8Array;
};

export type IdentityLookup = {
  /** `null` when the account has no People-chain record or no usable chat key. */
  getPeerIdentity: (accountId: Uint8Array) => Promise<PeerIdentity | null>;
};

type StorageAdapter = Parameters<typeof createIdentityRepository>[0]['storage'];

const CHAT_KEY_BYTES = 32;

const createMemoryStorage = (): StorageAdapter => {
  const values = new Map<string, string>();
  return {
    read: key => okAsync(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value);
      return okAsync(undefined);
    },
    clear: key => {
      values.delete(key);
      return okAsync(undefined);
    },
    subscribe: () => () => undefined,
  };
};

export const createIdentityLookup = (lazyClient: LazyClient): IdentityLookup =>
  fromRepository(createIdentityRepository({ adapter: createIdentityRpcAdapter(lazyClient), storage: createMemoryStorage() }));

/** Exposed for tests, which pass a stub repository instead of a chain. */
export const fromRepository = (repository: IdentityRepository): IdentityLookup => ({
  getPeerIdentity: async accountId => {
    // The SDK's account string is the 0x-hex public key: its RPC adapter runs it
    // through polkadot-api `AccountId().dec`, which reads hex and throws
    // "Invalid public key length" on an SS58 address (every lookup failed so).
    const result = await repository.getIdentity(bytesToHex(accountId)).orElse(error => {
      console.warn('[identity] lookup failed', error.message);
      return errAsync(error);
    });
    if (result.isErr()) return null;
    const identity = result.value;
    if (!identity?.identifierKey) return null;
    const chatPublicKey = hexToBytes(identity.identifierKey);
    if (chatPublicKey.length !== CHAT_KEY_BYTES) return null;
    return { accountId, username: identity.fullUsername ?? identity.liteUsername, chatPublicKey };
  },
});
