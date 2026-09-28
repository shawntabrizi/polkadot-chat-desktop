/**
 * M22a: what the web build keeps in place of the desktop's files under
 * `<userData>` (docs/web.md "What is stored where"). Its own IndexedDB
 * database, apart from the renderer's chat database.
 * - `records`: the identity (public fields in clear, the mnemonic sealed
 *   under the passphrase key), its reset backup, the sealed at-rest key.
 * - `metadata`: public runtime metadata by code hash.
 */

import Dexie, { type Table } from 'dexie';

import type { SealedSecret, VaultParams } from './vault';

import type { NetworkProfileId } from '../shared/network';

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

export type MetadataRow = { codeHash: string; bytes: Uint8Array };

export type WebDatabase = Dexie & {
  records: Table<WebIdentityRecord, WebIdentityRecord['name']>;
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
