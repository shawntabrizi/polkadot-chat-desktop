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
  identityResetUndo: 'identity:resetUndo',
  chainMetadataGet: 'chain:metadataGet',
  chainMetadataSet: 'chain:metadataSet',
  assistantGetSettings: 'assistant:getSettings',
  assistantSetSettings: 'assistant:setSettings',
  assistantSend: 'assistant:send',
  assistantCancel: 'assistant:cancel',
  assistantDelta: 'assistant:delta',
  assistantDone: 'assistant:done',
  assistantError: 'assistant:error',
  assistantEvent: 'assistant:event',
  assistantDetect: 'assistant:detect',
  notifyShow: 'notify:show',
  notifyOpen: 'notify:open',
  appSetBadge: 'app:setBadge',
  menuSettings: 'menu:settings',
  openUrl: 'open:url',
} as const;

/** Who answers the Assistant: the LLM proxy, or a coding-agent CLI on this computer. */
export type AssistantEngineId = 'proxy' | 'claude' | 'codex' | 'opencode';

/** Tool capabilities of a CLI engine (main/assistant/toolPolicy.ts). The UI offers the first four. */
export type AssistantTool = 'read' | 'write' | 'bash' | 'web' | 'subagents';

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
   * Removes `identity.json` from this computer, undoable for 10 s with
   * `resetUndo` (the main process keeps a `.bak` until then). After that the
   * username stays claimed on chain, but without a backup (v1) it can never be
   * used again. The caller wipes the renderer database once its own grace
   * period ends, then reloads.
   */
  reset: () => Promise<void>;
  /** Puts back the identity a `reset` removed. `false` when the grace period is over. */
  resetUndo: () => Promise<boolean>;
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
  engine: AssistantEngineId;
  /** Tools a CLI engine may use, inside the assistant workspace only. Empty: tools off. */
  tools: AssistantTool[];
};

/** Fields to change. `key: ''` removes the stored key. */
export type AssistantSettingsUpdate = { model?: string; baseUrl?: string; key?: string; engine?: AssistantEngineId; tools?: AssistantTool[] };

/** What `detect` found for one engine. */
export type AssistantEngineStatus = { id: AssistantEngineId; label: string; installed: boolean; version?: string };

export type AssistantChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * `sessionId`: the engine's own session from an earlier turn (a CLI engine
 * resumes it and needs only the last message); ignored by the proxy.
 */
export type AssistantSendRequest = { conversationId: string; messages: AssistantChatMessage[]; sessionId?: string };

/** One piece of reply text for the reply `messageId` (the id `send` returned). */
export type AssistantDelta = { conversationId: string; messageId: string; text: string };
/**
 * `text`: the whole answer as the engine closed it (replaces the streamed
 * text: a CLI may stream narration before its answer). `sessionId`: keep it
 * for the next `send` to this engine.
 */
export type AssistantDone = { conversationId: string; messageId: string; engine: AssistantEngineId; text?: string; sessionId?: string };
export type AssistantError = { conversationId: string; messageId: string; message: string };
/** Progress of a running reply: a tool the engine uses, or "thinking". */
export type AssistantActivity = {
  conversationId: string;
  messageId: string;
  event: { type: 'tool_use'; name: string; title: string } | { type: 'thinking' };
};

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
  onActivity: (listener: (event: AssistantActivity) => void) => () => void;
  /** Looks for every engine on this computer (the proxy is always there). */
  detect: () => Promise<AssistantEngineStatus[]>;
};

/**
 * A native notification. `peerId` is the room to open on click; a request
 * notification carries `requestId` instead. `sound` plays the system sound.
 */
export type NotifyRequest = { title: string; body: string; peerId: string; requestId?: string; sound: boolean };
export type NotifyOpen = { peerId: string; requestId?: string };

/** The window and the OS around it. */
export type DesktopAppApi = {
  /** The dock badge: `0` clears it. */
  setBadge: (count: number) => void;
  notify: (request: NotifyRequest) => void;
  /** A notification was clicked: the window is focused; open this room. */
  onNotifyOpen: (listener: (event: NotifyOpen) => void) => () => void;
  /** The app menu's "Preferences…". */
  onMenuSettings: (listener: () => void) => () => void;
  /**
   * Opens a button's link in the system browser (spec 0006), after the user
   * saw its host. Only https and polkadotapp links; anything else rejects.
   */
  openUrl: (url: string) => Promise<void>;
};

export type DesktopApi = {
  version: string;
  identity: DesktopIdentityApi;
  chain: DesktopChainApi;
  assistant: DesktopAssistantApi;
  app: DesktopAppApi;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
