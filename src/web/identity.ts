/**
 * M22a: `DesktopIdentityApi` in the browser. The sign-up flow is the
 * desktop's (main/identity/service.ts), with the backend reached through
 * `/idb/*` (backend.ts) and the proof in a Web Worker (the build swaps
 * main/identity/litePerson.ts for web/litePerson.ts). What differs is the
 * store: the mnemonic and the at-rest key are sealed under a passphrase key
 * (vault.ts) in IndexedDB (database.ts), and open only after `unlock`.
 * M10a: a phone sign-in is kept the same way (its keys in place of the
 * mnemonic), under a passphrase asked when the pairing completes.
 */

import {
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  type DesktopIdentityApi,
  type IdentitySummary,
  NO_IDENTITY_BACKEND,
  type PairedIdentity,
  PHONE_SIGNED_IN,
  type RendererSecrets,
  type UsernameAvailability,
} from '../shared/desktop-api';
import { type NetworkProfileId, isNetworkProfileId } from '../shared/network';
import { decodePairedSecrets, encodePairedSecrets, pairedIdentityProblem, pairedPublicOf, pairedSummaryOf } from '../shared/pairedIdentity';

import { deriveIdentityKeys } from '../main/identity/keys';
import { revealRecoveryPhrase } from '../main/identity/recovery';
import { checkAvailability as desktopCheckAvailability, createIdentity as desktopCreateIdentity } from '../main/identity/service';
import { type ClipboardLike, createSecretClipboard } from '../main/secretClipboard';

import type { WebDatabase, WebIdentityRecord, WebPairedRecord } from './database';
import { type VaultParams, deriveVaultKey, newVaultParams, openSecret, passphraseProblem, sealSecret } from './vault';

// The desktop's input rules (main/ipc.ts).
const USERNAME = /^[a-z]{6,29}$/;
const DIGITS = /^\d{2}$/;
/** As main/ipc.ts: longer than the renderer's 8 s Undo toast. */
export const RESET_GRACE_MS = 10_000;

const MNEMONIC_AAD = 'identity.mnemonic';
const AT_REST_AAD = 'identity.atRestKey';
const PAIRED_AAD = 'paired.secrets';
const PAIRED_AT_REST_AAD = 'paired.atRestKey';

/** Sealed secrets opened for this page session. Never written anywhere. A phone sign-in has `paired` and no mnemonic. */
export type UnlockedIdentity = { mnemonic: string | null; atRestKey: Uint8Array; paired: PairedIdentity | null };

/** What the new passphrase protects: the copy on its screen differs. */
export type PassphrasePurpose = 'signUp' | 'paired';

export type WebIdentityDeps = {
  db: WebDatabase;
  /** Asks the person for a new passphrase (sign-up, or a phone sign-in); null when they cancel. */
  askNewPassphrase: (purpose: PassphrasePurpose) => Promise<string | null>;
  /** M22c: null on a build with no backend proxy; sign-up and the availability check reject with `NO_IDENTITY_BACKEND`. */
  backendFetch: typeof fetch | null;
  clipboard: ClipboardLike;
  createIdentity?: typeof desktopCreateIdentity;
  checkAvailability?: typeof desktopCheckAvailability;
  vaultParams?: () => VaultParams;
};

export type WebIdentityApi = DesktopIdentityApi & {
  /** A saved identity waits for its passphrase. */
  locked: () => Promise<boolean>;
  /** Opens the saved identity for this session; rejects with "Wrong passphrase." */
  unlock: (passphrase: string) => Promise<void>;
  /** Deletes the saved identity from this browser for good (a forgotten passphrase). */
  forget: () => Promise<void>;
  /** The at-rest key of this session (DesktopStorageApi.atRestKey). */
  atRestKey: () => Promise<Uint8Array>;
  /** The mnemonic of this session, for the chain services; throws while locked, and `PHONE_SIGNED_IN` for a phone sign-in. */
  mnemonic: () => string;
  /**
   * At page start: drops a backup a reset left. Unlike main/ipc.ts, it is not
   * put back: on the web the renderer's reload after its Undo time is the
   * page start, and that reload means the reset is final.
   */
  dropLeftoverBackup: () => Promise<void>;
};

const summaryOf = (record: WebIdentityRecord): IdentitySummary => ({ username: record.username, accountHex: record.accountHex, profile: record.profile });

const parseCreateRequest = (value: CreateIdentityRequest): CreateIdentityRequest => {
  if (typeof value?.username !== 'string' || !USERNAME.test(value.username)) throw new Error('The username must be 6 to 29 lowercase letters.');
  if (value.digits !== null && (typeof value.digits !== 'string' || !DIGITS.test(value.digits))) throw new Error('The number must be two digits, 00 to 99.');
  if (!isNetworkProfileId(value.profile)) throw new Error('Unknown network.');
  return { username: value.username, digits: value.digits, profile: value.profile };
};

export const createWebIdentity = (deps: WebIdentityDeps): WebIdentityApi => {
  const { db } = deps;
  const createIdentity = deps.createIdentity ?? desktopCreateIdentity;
  const checkAvailability = deps.checkAvailability ?? desktopCheckAvailability;
  let unlocked: UnlockedIdentity | null = null;
  let creating = false;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  const progress = new Set<(line: string) => void>();
  const cleared = new Set<() => void>();
  const secretClipboard = createSecretClipboard(deps.clipboard, () => cleared.forEach(listener => listener()));

  const load = async () => (await db.records.get('identity')) as WebIdentityRecord | undefined;
  const loadPaired = async () => (await db.records.get('paired')) as WebPairedRecord | undefined;
  const session = (): UnlockedIdentity => {
    if (!unlocked) throw new Error('Unlock this account first.');
    return unlocked;
  };
  const seedSession = (): UnlockedIdentity & { mnemonic: string } => {
    const current = session();
    if (current.mnemonic === null) throw new Error(PHONE_SIGNED_IN);
    return { ...current, mnemonic: current.mnemonic };
  };

  const restore = async (): Promise<boolean> =>
    db.transaction('rw', db.records, async () => {
      const backup = (await db.records.get('identity.bak')) as WebIdentityRecord | undefined;
      if (!backup || (await load())) return false;
      await db.records.put({ ...backup, name: 'identity' });
      await db.records.delete('identity.bak');
      return true;
    });

  return {
    backendFetch: deps.backendFetch,

    get: async () => {
      const record = await load();
      if (record) return summaryOf(record);
      const paired = await loadPaired();
      return paired ? pairedSummaryOf(paired) : null;
    },

    available: (username: string, profile: NetworkProfileId): Promise<UsernameAvailability> => {
      if (typeof username !== 'string' || !USERNAME.test(username)) return Promise.reject(new Error('The username must be 6 to 29 lowercase letters.'));
      if (!isNetworkProfileId(profile)) return Promise.reject(new Error('Unknown network.'));
      if (!deps.backendFetch) return Promise.reject(new Error(NO_IDENTITY_BACKEND));
      return checkAvailability(username, profile, deps.backendFetch);
    },

    create: async (value: CreateIdentityRequest): Promise<CreateIdentityResponse> => {
      const request = parseCreateRequest(value);
      const fetchImpl = deps.backendFetch;
      if (!fetchImpl) throw new Error(NO_IDENTITY_BACKEND);
      if (creating) throw new Error('A sign-up is already running.');
      if (await load()) throw new Error('This browser already has an identity.');
      if (await loadPaired()) throw new Error('This browser is signed in with a phone. Sign out first.');
      creating = true;
      try {
        // Asked first: the mnemonic must be sealed the moment the backend binds the name to it.
        const passphrase = await deps.askNewPassphrase('signUp');
        if (passphrase === null) throw new Error('A passphrase is needed to keep the account in this browser.');
        const problem = passphraseProblem(passphrase);
        if (problem) throw new Error(problem);
        const vault = (deps.vaultParams ?? newVaultParams)();
        const key = await deriveVaultKey(passphrase, vault);
        const atRestKey = crypto.getRandomValues(new Uint8Array(32));
        const sealedAtRest = await sealSecret(key, atRestKey, AT_REST_AAD);
        return await createIdentity({
          ...request,
          fetchImpl,
          onProgress: line => progress.forEach(listener => listener(line)),
          store: {
            load: async () => {
              const record = await load();
              return record ? { mnemonic: '', username: record.username, accountHex: record.accountHex, profile: record.profile } : null;
            },
            save: async identity => {
              await db.records.put({
                name: 'identity',
                username: identity.username,
                accountHex: identity.accountHex,
                profile: identity.profile,
                vault,
                mnemonic: await sealSecret(key, new TextEncoder().encode(identity.mnemonic), MNEMONIC_AAD),
                atRestKey: sealedAtRest,
              });
              unlocked = { mnemonic: identity.mnemonic, atRestKey, paired: null };
            },
          },
        });
      } finally {
        creating = false;
      }
    },

    locked: async () => unlocked === null && ((await load()) !== undefined || (await loadPaired()) !== undefined),

    unlock: async (passphrase: string) => {
      const record = await load();
      if (!record) {
        const paired = await loadPaired();
        if (!paired) throw new Error('This browser has no identity.');
        const key = await deriveVaultKey(passphrase, paired.vault);
        const text = new TextDecoder().decode(await openSecret(key, paired.secrets, PAIRED_AAD));
        const atRestKey = await openSecret(key, paired.atRestKey, PAIRED_AT_REST_AAD);
        unlocked = { mnemonic: null, atRestKey, paired: decodePairedSecrets(text, paired) };
        return;
      }
      const key = await deriveVaultKey(passphrase, record.vault);
      const mnemonic = new TextDecoder().decode(await openSecret(key, record.mnemonic, MNEMONIC_AAD));
      const atRestKey = await openSecret(key, record.atRestKey, AT_REST_AAD);
      unlocked = { mnemonic, atRestKey, paired: null };
    },

    savePaired: async (identity: PairedIdentity) => {
      if (creating || (await load())) throw new Error('This browser already has an identity.');
      if (await loadPaired()) throw new Error('This browser is already signed in with a phone.');
      const problem = pairedIdentityProblem(identity);
      if (problem) throw new Error(problem);
      // Conformance with sign-up (docs/decisions.md M10a): nothing secret is kept without a passphrase.
      const passphrase = await deps.askNewPassphrase('paired');
      if (passphrase === null) throw new Error('A passphrase is needed to keep the sign-in in this browser.');
      const weak = passphraseProblem(passphrase);
      if (weak) throw new Error(weak);
      const vault = (deps.vaultParams ?? newVaultParams)();
      const key = await deriveVaultKey(passphrase, vault);
      const atRestKey = crypto.getRandomValues(new Uint8Array(32));
      await db.records.put({
        name: 'paired',
        ...pairedPublicOf(identity),
        vault,
        secrets: await sealSecret(key, new TextEncoder().encode(encodePairedSecrets(identity)), PAIRED_AAD),
        atRestKey: await sealSecret(key, atRestKey, PAIRED_AT_REST_AAD),
      });
      unlocked = { mnemonic: null, atRestKey, paired: identity };
    },

    pairedSecrets: async () => {
      if (!(await loadPaired())) throw new Error('This browser is not signed in with a phone.');
      const paired = session().paired;
      if (!paired) throw new Error('This browser is not signed in with a phone.');
      return paired;
    },

    forgetPaired: async () => {
      await db.records.delete('paired');
      unlocked = null;
    },

    forget: async () => {
      await db.records.clear();
      unlocked = null;
    },

    atRestKey: async () => new Uint8Array(session().atRestKey),

    mnemonic: () => seedSession().mnemonic,

    secretsForRenderer: async (): Promise<RendererSecrets> => {
      if (!(await load())) throw new Error((await loadPaired()) ? PHONE_SIGNED_IN : 'This browser has no identity yet.');
      const keys = deriveIdentityKeys(seedSession().mnemonic);
      return { statementSeed: keys.walletSecret64, chatPrivateKey: keys.chatPrivateKey, deviceEncryptionPrivateKey: keys.deviceEncryptionPrivateKey };
    },

    reset: async () => {
      if (creating) throw new Error('A sign-up is running. Wait for it to end.');
      await db.transaction('rw', db.records, async () => {
        const record = await load();
        if (!record) return;
        await db.records.put({ ...record, name: 'identity.bak' });
        await db.records.delete('identity');
      });
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetTimer = null;
        unlocked = null;
        void db.records.delete('identity.bak');
      }, RESET_GRACE_MS);
    },

    resetUndo: async () => {
      if (!resetTimer) return false;
      clearTimeout(resetTimer);
      resetTimer = null;
      return restore();
    },

    dropLeftoverBackup: async () => {
      await db.records.delete('identity.bak');
    },

    recoveryPhrase: async (confirm: string) => {
      const record = await load();
      if (!record && (await loadPaired())) throw new Error(PHONE_SIGNED_IN);
      return revealRecoveryPhrase(confirm, record ? { ...summaryOf(record), mnemonic: seedSession().mnemonic } : null);
    },

    copySecret: async (secret: string) => {
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1_000) throw new Error('Nothing to copy.');
      await secretClipboard.copy(secret);
    },

    onSecretCleared: listener => {
      cleared.add(listener);
      return () => {
        cleared.delete(listener);
      };
    },

    onProgress: listener => {
      progress.add(listener);
      return () => {
        progress.delete(listener);
      };
    },
  };
};
