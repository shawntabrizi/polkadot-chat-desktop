/**
 * People-chain reads for identity: the `Resources.Consumers` entry of an
 * account. Same contract as `createChainDirectory` in
 * `.refs/bot-core/lib/people-directory.mjs`, over polkadot-api with the
 * generated People descriptors (`.papi/`).
 *
 * PLAN.md "Best block first": the client is ready at the first best block, and
 * reads go to the best block. `isFinalized` is the one read at the finalized
 * head; it reports, it never waits.
 */

import { paseoPeopleNext, productsDevnetPeople } from '@polkadot-api/descriptors';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';

import { READ_TIMEOUT_MS, type RuntimeClient, awaitBestRuntime, retryOnNextEndpoint, withTimeout } from '../../shared/chainRead';
import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';
import { metadataCache } from '../metadataCache';

export type Consumer = {
  account: string;
  username: string | null;
  /** RFC-0004 container, 0x-hex (65 bytes). */
  identifierKey: string;
  /** "Lite" or "Person"; null when the chain predates the field. */
  credibility: string | null;
};

export type PeopleDirectory = {
  /** The record at the best block. */
  consumerOf: (accountHex: string) => Promise<Consumer | null>;
  identifierKeyFor: (accountHex: string) => Promise<string | null>;
  /** Whether the finalized head already holds the account's identifier key. */
  isFinalized: (accountHex: string) => Promise<boolean>;
  destroy: () => void;
};

type At = 'best' | 'finalized';

/** The fields of `Resources.Consumers` this module reads (both runtimes share them). */
export type ConsumerValue = {
  identifier_key?: string | null;
  full_username?: Uint8Array;
  lite_username?: Uint8Array;
  credibility?: { type?: unknown };
};

/** What the directory needs from a chain connection; a fake in the spec. */
export type DirectoryChain = RuntimeClient & {
  readConsumer: (ss58: string, at: At) => Promise<ConsumerValue | undefined>;
  /** Moves the connection to the profile's next endpoint. */
  switchEndpoint: () => void;
  destroy: () => void;
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = String(hex).trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);
};
const normHex = (hex: string): string => `0x${String(hex).trim().replace(/^0x/i, '').toLowerCase()}`;
const text = (value: Uint8Array | undefined): string | null => (value == null ? null : new TextDecoder().decode(value));

/**
 * A directory over a ready-made chain connection. Waits for the first best
 * block and its runtime, retrying once on the next endpoint when that times
 * out. The caller must `destroy()` it.
 */
export async function createPeopleDirectory(chain: DirectoryChain): Promise<PeopleDirectory> {
  try {
    await retryOnNextEndpoint(() => awaitBestRuntime(chain), chain.switchEndpoint);
  } catch (error) {
    chain.destroy();
    throw error;
  }
  const read = (accountHex: string, at: At): Promise<ConsumerValue | undefined> => {
    const ss58 = ss58Address(hexToBytes(accountHex), 42);
    return retryOnNextEndpoint(() => withTimeout(chain.readConsumer(ss58, at), READ_TIMEOUT_MS, 'identifier lookup'), chain.switchEndpoint);
  };
  const directory: PeopleDirectory = {
    async consumerOf(accountHex) {
      const value = await read(accountHex, 'best');
      if (value == null || value.identifier_key == null) return null;
      return {
        account: normHex(accountHex),
        username: text(value.full_username) ?? text(value.lite_username),
        identifierKey: normHex(value.identifier_key),
        credibility: typeof value.credibility?.type === 'string' ? value.credibility.type : null,
      };
    },
    async identifierKeyFor(accountHex) {
      return (await directory.consumerOf(accountHex))?.identifierKey ?? null;
    },
    async isFinalized(accountHex) {
      const value = await read(accountHex, 'finalized');
      return value?.identifier_key != null;
    },
    destroy: () => chain.destroy(),
  };
  return directory;
}

/** Opens a People-chain client for the profile, with the on-disk metadata cache. */
export async function openPeopleDirectory(profileId: NetworkProfileId): Promise<PeopleDirectory> {
  const provider = getWsProvider([...NETWORK_PROFILES[profileId].peopleEndpoints]);
  const client = createClient(provider, metadataCache());
  // Both runtimes have one `Consumers` shape (bot-core people-directory.mjs).
  const api = client.getTypedApi(profileId === 'paseo' ? paseoPeopleNext : productsDevnetPeople);
  return createPeopleDirectory({
    bestBlocks$: client.bestBlocks$,
    getMetadata: hash => client.getMetadata(hash),
    readConsumer: (ss58, at) => api.query.Resources.Consumers.getValue(ss58, { at }),
    switchEndpoint: () => provider.switch(),
    destroy: () => client.destroy(),
  });
}

/** Runs `fn` with a directory and always closes the connection. */
export async function withPeopleDirectory<T>(profileId: NetworkProfileId, fn: (directory: PeopleDirectory) => Promise<T>): Promise<T> {
  const directory = await openPeopleDirectory(profileId);
  try {
    return await fn(directory);
  } finally {
    directory.destroy();
  }
}
