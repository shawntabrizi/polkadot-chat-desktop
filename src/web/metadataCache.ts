/**
 * The web twin of src/main/metadataCache.ts (M22a): the runtime-metadata
 * cache in IndexedDB instead of `<userData>/metadata`. vite.web.config.ts
 * swaps it in for the main module, so the reused chain modules (assetHub.ts,
 * bulletin.ts, directory.ts) get it without a change. Metadata is public and
 * content-addressed; every failure here is silent, as on the desktop.
 */

import type { MetadataCache } from '../main/metadataCache';

import { webDatabase } from './database';

const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const CODE_HASH = /^(0x)?[0-9a-f]{64}$/i;

const keyOf = (codeHash: string): string | null => (CODE_HASH.test(codeHash) ? codeHash.replace(/^0x/i, '').toLowerCase() : null);

export const readMetadata = async (codeHash: string): Promise<Uint8Array | null> => {
  const key = keyOf(codeHash);
  if (!key) return null;
  try {
    const row = await webDatabase().metadata.get(key);
    return row ? new Uint8Array(row.bytes) : null;
  } catch {
    return null;
  }
};

export const writeMetadata = (codeHash: string, metadata: Uint8Array): void => {
  const key = keyOf(codeHash);
  if (!key || !(metadata instanceof Uint8Array) || metadata.length > MAX_METADATA_BYTES) return;
  webDatabase()
    .metadata.put({ codeHash: key, bytes: metadata })
    .catch(() => undefined);
};

/** Only the desktop sets a folder; kept so the twin has the main module's exports. */
export const setMetadataCacheDir = (): void => undefined;

export const metadataCache = (): MetadataCache => ({ getMetadata: readMetadata, setMetadata: writeMetadata });
