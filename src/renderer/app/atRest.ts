/**
 * Sealing secrets at rest (M16b): the renderer's `keys` table holds each
 * epoch key sealed with AES-256-GCM under the app's at-rest key. That key
 * comes from the main process (`safeStorage`, `src/main/storageKey.ts`) and
 * lives only in memory here, so a copy of the IndexedDB folder alone opens
 * nothing.
 *
 * Outside Electron (vitest, the e2e children in Node) there is no main
 * process: a random key for this process stands in. It dies with the process,
 * exactly as those in-memory databases do.
 */

let provider: () => Promise<Uint8Array> = async () => {
  const desktop = typeof window === 'undefined' ? undefined : window.desktop;
  return desktop ? desktop.storage.atRestKey() : crypto.getRandomValues(new Uint8Array(32));
};
let key: Promise<CryptoKey> | null = null;

/** Tests: a fixed key, or a new one (a "restart" with a different key). */
export const setAtRestKeyProvider = (next: () => Promise<Uint8Array>): void => {
  provider = next;
  key = null;
};

const atRestKey = (): Promise<CryptoKey> => {
  key ??= provider().then(raw => {
    if (raw.length !== 32) throw new Error('The at-rest key must be 32 bytes.');
    return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  });
  // A failed fetch is not cached: the next call asks again.
  key.catch(() => {
    key = null;
  });
  return key;
};

export type SealedAtRest = { nonce: Uint8Array; sealed: Uint8Array };

/** `aad` binds the ciphertext to its row, so a sealed key moved to another row does not open. */
export const sealAtRest = async (plaintext: Uint8Array, aad: string): Promise<SealedAtRest> => {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) }, await atRestKey(), new Uint8Array(plaintext));
  return { nonce, sealed: new Uint8Array(sealed) };
};

export const openAtRest = async (value: SealedAtRest, aad: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.nonce), additionalData: new TextEncoder().encode(aad) }, await atRestKey(), new Uint8Array(value.sealed)),
  );
