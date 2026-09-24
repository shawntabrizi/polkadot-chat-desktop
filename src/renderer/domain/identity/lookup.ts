/**
 * Peer identity lookup on the People chain (`Resources.Consumers`) through
 * @novasamatech/host-papp's repository. The RFC-0004 container
 * (`0x00 || x25519_pk || pad`) is unwrapped to the 32-byte X25519 key as hex,
 * as the SDK does, so nothing is stripped further down (see docs/decisions.md).
 *
 * The chain adapter is ours, not the SDK's `createIdentityRpcAdapter`: that
 * one reads at polkadot-api's default block, the finalized head, so a peer who
 * just signed up looked unknown for the finality lag. This one reads at the
 * best block (PLAN.md "Best block first"), waits for the runtime once before
 * the first read, and retries a timed-out read once on the next endpoint.
 *
 * The repository caches per account. A memory cache is enough: keys are
 * re-read on every app start, and a rotated key must not be served from disk.
 */

import { Bytes, Enum } from '@novasamatech/scale';
import { type Identity, type IdentityAdapter, type IdentityRepository, createIdentityRepository } from '@novasamatech/host-papp';
import type { LazyClient } from '@novasamatech/statement-store';
import { ResultAsync, okAsync } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import { type Observable, defer, map, throwError } from 'rxjs';
import { Struct } from 'scale-ts';

import { bytesToHex, hexToBytes } from '../../app/bytes';
import { READ_TIMEOUT_MS, awaitBestRuntime, isTimeoutError, retryOnNextEndpoint, withTimeout } from '../../../shared/chainRead';

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

/** The People connection a lookup reads through (see app/statementStore.ts). */
export type LookupConnection = { lazyClient: LazyClient; switchEndpoint: () => void };

/** The `Resources.Consumers` fields read here; both People runtimes share them. */
type RawConsumer = {
  identifier_key: string;
  full_username?: Uint8Array;
  lite_username: Uint8Array;
  credibility: { type: 'Lite' } | { type: 'Person'; value: { alias: string; last_update?: bigint } };
};

type ConsumersEntry = {
  getValues: (keys: [string][], options: { at: 'best' }) => Promise<(RawConsumer | undefined)[]>;
  watchValue: (key: string, options: { at: 'best' }) => Observable<{ value: RawConsumer | undefined }>;
};

// Copied from @novasamatech/host-papp 0.10.2 dist/identity/identifierKey.js and
// rpcAdapter.js `decodeRawIdentity` on 2026-09-23 (not exported by the SDK);
// changes: TypeScript.
const IdentifierKey = Enum({ X25519: Struct({ key: Bytes(32), padding: Bytes(32) }) });
const textDecoder = new TextDecoder();
export const decodeRawIdentity = (accountId: string, raw: RawConsumer | undefined): Identity | null => {
  if (!raw) return null;
  let identifierKey: `0x${string}` | null = null;
  try {
    identifierKey = bytesToHex(IdentifierKey.dec(raw.identifier_key).value.key);
  } catch {
    // A keypair type we can't encrypt to is a normal condition, not a fault.
  }
  return {
    accountId,
    fullUsername: raw.full_username ? textDecoder.decode(raw.full_username) : null,
    liteUsername: textDecoder.decode(raw.lite_username),
    credibility:
      raw.credibility.type === 'Lite'
        ? { type: 'Lite' }
        : { type: 'Person', alias: raw.credibility.value.alias as `0x${string}`, lastUpdate: raw.credibility.value.last_update?.toString() ?? null },
    identifierKey,
  };
};

const toError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(String(cause)));

/** A host-papp `IdentityAdapter` that reads at the best block. Exposed for tests. */
export const createBestBlockIdentityAdapter = ({ lazyClient, switchEndpoint }: LookupConnection): IdentityAdapter => {
  const accountCodec = AccountId();
  const consumers = (): ConsumersEntry =>
    (lazyClient.getClient().getUnsafeApi().query as unknown as { Resources: { Consumers: ConsumersEntry } }).Resources.Consumers;
  // Once per connection: the metadata download must not count against a read's deadline.
  let runtime: Promise<unknown> | null = null;
  const ready = (): Promise<unknown> => {
    runtime ??= awaitBestRuntime(lazyClient.getClient()).catch((error: unknown) => {
      runtime = null;
      throw error;
    });
    return runtime;
  };
  const readAtBest = async (accounts: string[]): Promise<(RawConsumer | undefined)[]> => {
    await ready();
    return withTimeout(consumers().getValues(accounts.map(account => [accountCodec.dec(account)]), { at: 'best' }), READ_TIMEOUT_MS, 'identity lookup');
  };
  return {
    readIdentities: accounts =>
      ResultAsync.fromPromise(retryOnNextEndpoint(() => readAtBest(accounts), switchEndpoint), toError).map(values =>
        Object.fromEntries(accounts.map((account, index) => [account, decodeRawIdentity(account, values[index])])),
      ),
    watchIdentity: accountId =>
      defer(() => {
        try {
          return consumers()
            .watchValue(accountCodec.dec(accountId), { at: 'best' })
            .pipe(map(emission => decodeRawIdentity(accountId, emission.value)));
        } catch (error) {
          return throwError(() => toError(error));
        }
      }),
  };
};

export const createIdentityLookup = (connection: LookupConnection): IdentityLookup =>
  fromRepository(createIdentityRepository({ adapter: createBestBlockIdentityAdapter(connection), storage: createMemoryStorage() }));

/**
 * A lookup that timed out (the read already moved to the next endpoint
 * once) is asked again once after this pause before it counts as failed: a
 * failed lookup drops a chat request for good (M12 review carry).
 */
export const LOOKUP_RETRY_MS = 5_000;

const isTimeout = (error: Error): boolean => isTimeoutError(error) || /timed out/i.test(error.message);

/** Exposed for tests, which pass a stub repository instead of a chain. */
export const fromRepository = (repository: IdentityRepository): IdentityLookup => ({
  getPeerIdentity: async accountId => {
    // The SDK's account string is the 0x-hex public key: its RPC adapter runs it
    // through polkadot-api `AccountId().dec`, which reads hex and throws
    // "Invalid public key length" on an SS58 address (every lookup failed so).
    const account = bytesToHex(accountId);
    let result = await repository.getIdentity(account);
    if (result.isErr() && isTimeout(result.error)) {
      console.warn('[identity] lookup timed out for %s; asking once more in %d s', account, LOOKUP_RETRY_MS / 1000);
      await new Promise(resolve => setTimeout(resolve, LOOKUP_RETRY_MS));
      result = await repository.getIdentity(account);
    }
    if (result.isErr()) {
      console.warn('[identity] lookup failed', result.error.message);
      return null;
    }
    const identity = result.value;
    if (!identity?.identifierKey) return null;
    const chatPublicKey = hexToBytes(identity.identifierKey);
    if (chatPublicKey.length !== CHAT_KEY_BYTES) return null;
    return { accountId, username: identity.fullUsername ?? identity.liteUsername, chatPublicKey };
  },
});
