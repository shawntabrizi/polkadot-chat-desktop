/**
 * People-chain reads for identity: the `Resources.Consumers` entry of an
 * account. Same contract as `createChainDirectory` in
 * `.refs/bot-core/lib/people-directory.mjs`, over polkadot-api with the
 * generated People descriptors (`.papi/`).
 */

import { paseoPeopleNext, productsDevnetPeople } from '@polkadot-api/descriptors';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';

import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';

const READ_TIMEOUT_MS = 15_000;
/** The node answers a block query (a dead endpoint fails fast). */
const CONNECT_TIMEOUT_MS = 12_000;
/** The public nodes take up to a minute to serve the runtime metadata. */
const METADATA_TIMEOUT_MS = 90_000;

export type Consumer = {
  account: string;
  username: string | null;
  /** RFC-0004 container, 0x-hex (65 bytes). */
  identifierKey: string;
  /** "Lite" or "Person"; null when the chain predates the field. */
  credibility: string | null;
};

export type PeopleDirectory = {
  consumerOf: (accountHex: string) => Promise<Consumer | null>;
  identifierKeyFor: (accountHex: string) => Promise<string | null>;
  destroy: () => void;
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = String(hex).trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map(b => Number.parseInt(b, 16)) ?? []);
};
const normHex = (hex: string): string => `0x${String(hex).trim().replace(/^0x/i, '').toLowerCase()}`;
const text = (value: Uint8Array | undefined): string | null => (value == null ? null : new TextDecoder().decode(value));

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/**
 * Opens a People-chain client for the profile and waits until it can serve
 * storage reads, so a read's own deadline never covers the metadata download.
 * The caller must `destroy()` it.
 */
export async function openPeopleDirectory(profileId: NetworkProfileId): Promise<PeopleDirectory> {
  const client = createClient(getWsProvider([...NETWORK_PROFILES[profileId].peopleEndpoints]));
  try {
    const block = await withTimeout(client.getFinalizedBlock(), CONNECT_TIMEOUT_MS, 'chain connect');
    await withTimeout(client.getMetadata(block.hash), METADATA_TIMEOUT_MS, 'runtime metadata');
  } catch (error) {
    client.destroy();
    throw error;
  }
  // Both runtimes have one `Consumers` shape (bot-core people-directory.mjs).
  const api = client.getTypedApi(profileId === 'paseo' ? paseoPeopleNext : productsDevnetPeople);
  const directory: PeopleDirectory = {
    async consumerOf(accountHex) {
      const value = await withTimeout(
        api.query.Resources.Consumers.getValue(ss58Address(hexToBytes(accountHex), 42)),
        READ_TIMEOUT_MS,
        'identifier lookup',
      );
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
    destroy: () => client.destroy(),
  };
  return directory;
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
