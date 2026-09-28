/**
 * M22a: `DesktopIdentityApi` in the browser. The sign-up flow is the
 * desktop's (main/identity/service.ts), with the backend reached through
 * `/idb/*` (backend.ts) and the proof in a Web Worker (the build swaps
 * main/identity/litePerson.ts for web/litePerson.ts). What differs is the
 * store: the mnemonic and the at-rest key are sealed under a passphrase key
 * (vault.ts) in IndexedDB (database.ts), and open only after `unlock`.
 */

import {
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  type DesktopIdentityApi,
  type IdentitySummary,
  type RendererSecrets,
  type UsernameAvailability,
} from '../shared/desktop-api';
import { type NetworkProfileId, isNetworkProfileId } from '../shared/network';

import { deriveIdentityKeys } from '../main/identity/keys';
import { revealRecoveryPhrase } from '../main/identity/recovery';
import { checkAvailability as desktopCheckAvailability, createIdentity as desktopCreateIdentity } from '../main/identity/service';
import { type ClipboardLike, createSecretClipboard } from '../main/secretClipboard';

import type { WebDatabase, WebIdentityRecord } from './database';
import { type VaultParams, deriveVaultKey, newVaultParams, openSecret, passphraseProblem, sealSecret } from './vault';

// The desktop's input rules (main/ipc.ts).
const USERNAME = /^[a-z]{6,29}$/;
const DIGITS = /^\d{2}$/;
/** As main/ipc.ts: longer than the renderer's 8 s Undo toast. */
export const RESET_GRACE_MS = 10_000;

const MNEMONIC_AAD = 'identity.mnemonic';
const AT_REST_AAD = 'identity.atRestKey';

/** Sealed secrets opened for this page session. Never written anywhere. */
export type UnlockedIdentity = { mnemonic: string; atRestKey: Uint8Array };

export type WebIdentityDeps = {
  db: WebDatabase;
  /** Asks the person for a new passphrase (sign-up); null when they cancel. */
  askNewPassphrase: () => Promise<string | null>;
  backendFetch: typeof fetch;
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
  /** The mnemonic of this session, for the chain services; throws while locked. */
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

  const load = () => db.records.get('identity');
  const session = (): UnlockedIdentity => {
    if (!unlocked) throw new Error('Unlock this account first.');
    return unlocked;
  };

  const restore = async (): Promise<boolean> =>
    db.transaction('rw', db.records, async () => {
      const backup = await db.records.get('identity.bak');
      if (!backup || (await load())) return false;
      await db.records.put({ ...backup, name: 'identity' });
      await db.records.delete('identity.bak');
      return true;
    });

  return {
    get: async () => {
      const record = await load();
      return record ? summaryOf(record) : null;
    },

    available: (username: string, profile: NetworkProfileId): Promise<UsernameAvailability> => {
      if (typeof username !== 'string' || !USERNAME.test(username)) return Promise.reject(new Error('The username must be 6 to 29 lowercase letters.'));
      if (!isNetworkProfileId(profile)) return Promise.reject(new Error('Unknown network.'));
      return checkAvailability(username, profile, deps.backendFetch);
    },

    create: async (value: CreateIdentityRequest): Promise<CreateIdentityResponse> => {
      const request = parseCreateRequest(value);
      if (creating) throw new Error('A sign-up is already running.');
      if (await load()) throw new Error('This browser already has an identity.');
      creating = true;
      try {
        // Asked first: the mnemonic must be sealed the moment the backend binds the name to it.
        const passphrase = await deps.askNewPassphrase();
        if (passphrase === null) throw new Error('A passphrase is needed to keep the account in this browser.');
        const problem = passphraseProblem(passphrase);
        if (problem) throw new Error(problem);
        const vault = (deps.vaultParams ?? newVaultParams)();
        const key = await deriveVaultKey(passphrase, vault);
        const atRestKey = crypto.getRandomValues(new Uint8Array(32));
        const sealedAtRest = await sealSecret(key, atRestKey, AT_REST_AAD);
        return await createIdentity({
          ...request,
          fetchImpl: deps.backendFetch,
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
              unlocked = { mnemonic: identity.mnemonic, atRestKey };
            },
          },
        });
      } finally {
        creating = false;
      }
    },

    locked: async () => unlocked === null && (await load()) !== undefined,

    unlock: async (passphrase: string) => {
      const record = await load();
      if (!record) throw new Error('This browser has no identity.');
      const key = await deriveVaultKey(passphrase, record.vault);
      const mnemonic = new TextDecoder().decode(await openSecret(key, record.mnemonic, MNEMONIC_AAD));
      const atRestKey = await openSecret(key, record.atRestKey, AT_REST_AAD);
      unlocked = { mnemonic, atRestKey };
    },

    forget: async () => {
      await db.records.clear();
      unlocked = null;
    },

    atRestKey: async () => new Uint8Array(session().atRestKey),

    mnemonic: () => session().mnemonic,

    secretsForRenderer: async (): Promise<RendererSecrets> => {
      if (!(await load())) throw new Error('This browser has no identity yet.');
      const keys = deriveIdentityKeys(session().mnemonic);
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
      return revealRecoveryPhrase(confirm, record ? { ...summaryOf(record), mnemonic: session().mnemonic } : null);
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
