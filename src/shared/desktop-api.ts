// Exposed by src/preload as `window.desktop`. Optional on Window because the
// renderer also runs without Electron (vitest, a plain browser).

import type { NetworkProfileId } from './network';

/** Every IPC channel name, shared by main and preload. */
export const IPC = {
  identityGet: 'identity:get',
  identityAvailable: 'identity:available',
  identityCreate: 'identity:create',
  identitySecretsForRenderer: 'identity:secretsForRenderer',
  identityProgress: 'identity:progress',
} as const;

/** The public part of the identity saved on this machine. */
export type IdentitySummary = { username: string; accountHex: string; profile: NetworkProfileId };

/** The backend's answer for one name (letters only, no number). */
export type UsernameAvailability = {
  status: 'AVAILABLE' | 'TAKEN';
  /** Numbers still free for the name, e.g. `[1, 42]` for `name.01` and `name.42`. */
  availableDigits: number[];
};

export type CreateIdentityRequest = {
  /** 6 to 29 lowercase letters, without the number. */
  username: string;
  /** `00`–`99`, or null to let the network pick. */
  digits: string | null;
  profile: NetworkProfileId;
};

export type CreateIdentityResponse = {
  /** What the backend assigned, `name.NN`. */
  username: string;
  accountHex: string;
  identifierKeyHex: string;
  /** False when the chain had not shown the key before the wait ended. */
  confirmed: boolean;
};

/** Key material the renderer needs to seed Dexie. Never the mnemonic. */
export type RendererSecrets = {
  /** 64-byte sr25519 secret of the identity wallet (= this device's statement account). */
  statementSeed: Uint8Array;
  /** 32-byte X25519 identity chat private key. */
  chatPrivateKey: Uint8Array;
};

export type DesktopIdentityApi = {
  get: () => Promise<IdentitySummary | null>;
  available: (username: string, profile: NetworkProfileId) => Promise<UsernameAvailability>;
  create: (request: CreateIdentityRequest) => Promise<CreateIdentityResponse>;
  secretsForRenderer: () => Promise<RendererSecrets>;
  /** Progress lines of a running `create`. Returns the unsubscribe function. */
  onProgress: (listener: (line: string) => void) => () => void;
};

export type DesktopApi = { version: string; identity: DesktopIdentityApi };

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
