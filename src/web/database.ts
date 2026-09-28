/**
 * M22a: what the web build keeps in place of the desktop's files under
 * `<userData>` (docs/web.md "What is stored where"). Its own IndexedDB
 * database, apart from the renderer's chat database.
 * - `records`: the identity (public fields in clear, the mnemonic sealed
 *   under the passphrase key), its reset backup, the sealed at-rest key;
 *   or (M10a) a phone sign-in, its keys sealed the same way.
 * - `metadata`: public runtime metadata by code hash.
 */

import Dexie, { type Table } from 'dexie';

import type { SealedSecret, VaultParams } from './vault';

import type { NetworkProfileId } from '../shared/network';
import type { PairedPublic } from '../shared/pairedIdentity';

/** The identity as this browser keeps it: never the mnemonic in clear. */
export type WebIdentityRecord = {
  name: 'identity' | 'identity.bak';
  username: string;
  accountHex: string;
  profile: NetworkProfileId;
  vault: VaultParams;
  mnemonic: SealedSecret;
  /** The renderer's at-rest key (M16b), sealed under the same passphrase key. */
  atRestKey: SealedSecret;
};

/**
 * M10a: a phone sign-in as this browser keeps it. The public part in clear,
 * the keys (shared/pairedIdentity.ts `encodePairedSecrets`) sealed under the
 * passphrase key like the mnemonic of a local account.
 */
export type WebPairedRecord = PairedPublic & {
  name: 'paired';
  vault: VaultParams;
  secrets: SealedSecret;
  atRestKey: SealedSecret;
};

export type MetadataRow = { codeHash: string; bytes: Uint8Array };

export type WebDatabase = Dexie & {
  records: Table<WebIdentityRecord | WebPairedRecord, (WebIdentityRecord | WebPairedRecord)['name']>;
  metadata: Table<MetadataRow, string>;
};

export const WEB_DATABASE_NAME = 'polkadot-chat-web-platform';

let database: WebDatabase | null = null;

export const webDatabase = (): WebDatabase => {
  if (database) return database;
  const created = new Dexie(WEB_DATABASE_NAME) as WebDatabase;
  created.version(1).stores({ records: 'name', metadata: 'codeHash' });
  database = created;
  return created;
};

/** Tests: forget the open database (fake-indexeddb is reset between files). */
export const closeWebDatabase = (): void => {
  database?.close();
  database = null;
};
