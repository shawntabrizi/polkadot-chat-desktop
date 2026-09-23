import { AccountId } from '@polkadot-api/substrate-bindings';

const ss58 = AccountId(0);

export const toSs58 = (bytes: Uint8Array): string => ss58.dec(bytes);

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export const shortAccount = (ss58Address: string): string => `${ss58Address.slice(0, 6)}…${ss58Address.slice(-6)}`;

export const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString();
