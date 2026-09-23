/**
 * Sign-up: mint an identity on this machine and claim a username for it, the
 * way `pca create` does (`.refs/bot-core/cli.mjs` runRegistration). The store
 * is passed in so the same flow runs in Electron (safeStorage) and in the Node
 * script `scripts/identity-register.mjs` (a plain file under .agent-runs/).
 */

import { NETWORK_PROFILES, type NetworkProfileId } from '../../shared/network';

import { withPeopleDirectory } from './directory';
import { bytesToHex, deriveIdentityKeys, generateMnemonic } from './keys';
import {
  type BackendError,
  type UsernameAvailability,
  acquireIdentitySession,
  checkUsernameAvailable,
  jwtExpiresSoon,
  normalizeUsername,
  obtainAnonymousSession,
  registerIdentity,
  waitForAttestation,
} from './register';
import type { StoredIdentity } from './store';

export type IdentityStore = {
  save: (identity: StoredIdentity) => void | Promise<void>;
  load: () => StoredIdentity | null | Promise<StoredIdentity | null>;
};

export type CreateIdentityInput = {
  /** At least 6 lowercase letters, without the number. */
  username: string;
  /** `00`–`99`, or null to let the backend pick. */
  digits: string | null;
  profile: NetworkProfileId;
  onProgress?: (line: string) => void;
  store: IdentityStore;
  /** How long to wait for the chain to publish the key. */
  attestationTimeoutMs?: number;
};

export type CreateIdentityResult = {
  /** The name the backend assigned, `name.NN`. */
  username: string;
  accountHex: string;
  identifierKeyHex: string;
  /** False when the chain did not show the key within the wait; the claim stands and may land later. */
  confirmed: boolean;
};

const ATTESTATION_TIMEOUT_MS = 180_000;

const readable = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function createIdentity({
  username,
  digits,
  profile,
  onProgress = () => undefined,
  store,
  attestationTimeoutMs = ATTESTATION_TIMEOUT_MS,
}: CreateIdentityInput): Promise<CreateIdentityResult> {
  const { base } = normalizeUsername(username);
  if (digits != null && !/^\d{2}$/.test(digits)) throw new Error('The number must be two digits, 00 to 99.');
  // One identity per machine: a second sign-up would overwrite the only copy of the first mnemonic.
  if (await store.load()) throw new Error('This computer already has an identity.');
  const network = NETWORK_PROFILES[profile];

  onProgress('Creating keys');
  const mnemonic = generateMnemonic();
  const keys = deriveIdentityKeys(mnemonic);
  const accountHex = bytesToHex(keys.accountId);

  onProgress('Claiming username');
  let claimed: string;
  try {
    const session =
      network.identityRegistrationAuth === 'client-proof'
        ? await acquireIdentitySession({ backendUrl: network.identityBackend, mnemonic })
        : null;
    const result = await registerIdentity({
      mnemonic,
      username: base,
      digits,
      backendUrl: network.identityBackend,
      identityToken: session?.token ?? null,
    });
    claimed = result.username;
  } catch (error) {
    throw new Error(`The username could not be claimed: ${readable(error)}`, { cause: error });
  }
  // Saved before the wait: the backend has bound the name to this key, so
  // losing the mnemonic now would lose the name.
  await store.save({ mnemonic, username: claimed, accountHex, profile });

  onProgress('Waiting for the network');
  let confirmed = false;
  try {
    confirmed = await withPeopleDirectory(profile, directory =>
      waitForAttestation(directory, accountHex, { timeoutMs: attestationTimeoutMs, onTick: () => onProgress('Waiting for the network') }),
    );
  } catch (error) {
    onProgress(`Could not reach the network: ${readable(error)}`);
  }
  return { username: claimed, accountHex, identifierKeyHex: bytesToHex(keys.identifierKey65), confirmed };
}

// One throwaway bearer per backend for availability checks, reused until it
// is about to expire so each keystroke pause costs one request, not three.
const anonymousTokens = new Map<string, string>();

const anonymousToken = async (backendUrl: string, fresh: boolean): Promise<string> => {
  const cached = anonymousTokens.get(backendUrl);
  if (cached && !fresh && !jwtExpiresSoon(cached)) return cached;
  const { token } = await obtainAnonymousSession({ backendUrl });
  anonymousTokens.set(backendUrl, token);
  return token;
};

/** Whether `username` (letters only) is free on the profile's backend, and which numbers are left. */
export async function checkAvailability(username: string, profile: NetworkProfileId): Promise<UsernameAvailability> {
  const backendUrl = NETWORK_PROFILES[profile].identityBackend;
  try {
    return await checkUsernameAvailable({ backendUrl, username, token: await anonymousToken(backendUrl, false) });
  } catch (error) {
    // A revoked or expired bearer: mint a new one once.
    if ((error as BackendError).status !== 401) throw error;
    return checkUsernameAvailable({ backendUrl, username, token: await anonymousToken(backendUrl, true) });
  }
}
