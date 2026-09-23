// Copied from .refs/bot-core/lib/chain-client.mjs (metadataCache) on 2026-09-23; changes:
// TypeScript; the folder is set once by the caller (`<userData>/metadata` in
// the app, `.agent-runs/metadata` in the scripts) instead of ~/.pca; no
// onMiss hook; code hashes are checked before they become file names, as the
// renderer reaches this through IPC.
//
// The public People nodes take up to a minute to serve the runtime metadata
// (~500 KB through a runtime call), and polkadot-api's first storage read
// waits for it. The cache is keyed by the runtime's code hash, which is what
// polkadot-api hands to `getMetadata`/`setMetadata`: only the first start
// after a runtime upgrade pays. Metadata is public and content-addressed: an
// entry is never stale and never secret. A broken cache must never break a
// chain read, so every failure here is silent.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `{ getMetadata, setMetadata }` pair `createClient` takes. */
export type MetadataCache = {
  getMetadata: (codeHash: string) => Promise<Uint8Array | null>;
  setMetadata: (codeHash: string, metadata: Uint8Array) => void;
};

/** Larger than any runtime metadata; stops a bad IPC caller from filling the disk. */
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const CODE_HASH = /^(0x)?[0-9a-f]{64}$/i;

let cacheDir: string | null = null;

/** Where entries live; `null` turns the cache off. */
export const setMetadataCacheDir = (dir: string | null): void => {
  cacheDir = dir;
};

const entryPath = (dir: string, codeHash: string): string | null =>
  CODE_HASH.test(codeHash) ? join(dir, `${codeHash.replace(/^0x/i, '').toLowerCase()}.bin`) : null;

export const readMetadata = async (codeHash: string): Promise<Uint8Array | null> => {
  const path = cacheDir == null ? null : entryPath(cacheDir, codeHash);
  if (path == null) return null;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
};

export const writeMetadata = (codeHash: string, metadata: Uint8Array): void => {
  const dir = cacheDir;
  const path = dir == null ? null : entryPath(dir, codeHash);
  if (dir == null || path == null || !(metadata instanceof Uint8Array) || metadata.length > MAX_METADATA_BYTES) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, metadata);
    renameSync(tmp, path);
  } catch {
    /* best effort */
  }
};

export const metadataCache = (): MetadataCache => ({ getMetadata: readMetadata, setMetadata: writeMetadata });
