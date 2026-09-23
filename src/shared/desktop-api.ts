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
  identityReset: 'identity:reset',
  chainMetadataGet: 'chain:metadataGet',
  chainMetadataSet: 'chain:metadataSet',
  assistantGetSettings: 'assistant:getSettings',
  assistantSetSettings: 'assistant:setSettings',
  assistantSend: 'assistant:send',
  assistantCancel: 'assistant:cancel',
  assistantDelta: 'assistant:delta',
  assistantDone: 'assistant:done',
  assistantError: 'assistant:error',
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
  /** True when the best block holds the key; false when the wait ended first. */
  confirmed: boolean;
  /** True when the finalized head also holds it. Shown as "finalizing" when false. */
  finalized: boolean;
};

/** Key material the renderer needs to seed Dexie. Never the mnemonic. */
export type RendererSecrets = {
  /** 64-byte sr25519 secret of the identity wallet (= this device's statement account). */
  statementSeed: Uint8Array;
  /** 32-byte X25519 identity chat private key. */
  chatPrivateKey: Uint8Array;
  /** 32-byte X25519 private key of this device, apart from the chat key. */
  deviceEncryptionPrivateKey: Uint8Array;
};

export type DesktopIdentityApi = {
  get: () => Promise<IdentitySummary | null>;
  available: (username: string, profile: NetworkProfileId) => Promise<UsernameAvailability>;
  create: (request: CreateIdentityRequest) => Promise<CreateIdentityResponse>;
  secretsForRenderer: () => Promise<RendererSecrets>;
  /**
   * Deletes `identity.json` from this computer. The username stays claimed on
   * chain, but without a backup (v1) it can never be used again. The caller
   * then wipes the renderer database and reloads.
   */
  reset: () => Promise<void>;
  /** Progress lines of a running `create`. Returns the unsubscribe function. */
  onProgress: (listener: (line: string) => void) => () => void;
};

/**
 * The runtime-metadata cache on disk (`<userData>/metadata/<codeHash>.bin`),
 * in the shape polkadot-api's `createClient` takes. The renderer cannot
 * write files, so its People connection reaches the cache through IPC.
 */
export type DesktopChainApi = {
  getMetadata: (codeHash: string) => Promise<Uint8Array | null>;
  setMetadata: (codeHash: string, metadata: Uint8Array) => void;
};

/** Assistant settings as the renderer sees them: never the key itself. */
export type AssistantSettings = {
  model: string;
  baseUrl: string;
  /** An API key is stored (encrypted) in `<userData>/assistant.json`. */
  hasKey: boolean;
  /** `LLM_PROXY_KEY` is set in the app's environment (used when no key is stored). */
  envKey: boolean;
};

/** Fields to change. `key: ''` removes the stored key. */
export type AssistantSettingsUpdate = { model?: string; baseUrl?: string; key?: string };

export type AssistantChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AssistantSendRequest = { conversationId: string; messages: AssistantChatMessage[] };

/** One piece of reply text for the reply `messageId` (the id `send` returned). */
export type AssistantDelta = { conversationId: string; messageId: string; text: string };
export type AssistantDone = { conversationId: string; messageId: string };
export type AssistantError = { conversationId: string; messageId: string; message: string };

/**
 * The LLM proxy, reached through the main process, which holds the key.
 * `send` starts one streamed reply and returns its id; the reply then comes
 * as `delta` events and ends with one `done` or one `error` (a cancel ends
 * with `error` too).
 */
export type DesktopAssistantApi = {
  getSettings: () => Promise<AssistantSettings>;
  setSettings: (update: AssistantSettingsUpdate) => Promise<AssistantSettings>;
  send: (request: AssistantSendRequest) => Promise<{ messageId: string }>;
  cancel: (conversationId: string) => Promise<void>;
  onDelta: (listener: (event: AssistantDelta) => void) => () => void;
  onDone: (listener: (event: AssistantDone) => void) => () => void;
  onError: (listener: (event: AssistantError) => void) => () => void;
};

export type DesktopApi = {
  version: string;
  identity: DesktopIdentityApi;
  chain: DesktopChainApi;
  assistant: DesktopAssistantApi;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
