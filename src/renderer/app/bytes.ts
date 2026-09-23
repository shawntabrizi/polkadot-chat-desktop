/**
 * Byte helpers shared by the domain modules. Account ids are 32-byte
 * `Uint8Array`s on the wire and `0x`-hex strings as Dexie keys and React keys.
 */

import { fromHex, toHex } from 'polkadot-api/utils';

export type HexString = `0x${string}`;

export const bytesToHex = (bytes: Uint8Array): HexString => toHex(bytes) as HexString;

export const hexToBytes = (hex: string): Uint8Array => fromHex(hex);

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** A random id for messages and requests; the apps use UUID strings too. */
export const randomId = (): string => crypto.randomUUID();
