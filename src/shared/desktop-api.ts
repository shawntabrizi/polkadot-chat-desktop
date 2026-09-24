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
  chainDryRun: 'chain:dryRun',
  chainSign: 'chain:sign',
  chainWatch: 'chain:watch',
  chainTrack: 'chain:track',
  chainTxStatus: 'chain:txStatus',
  chainContractRead: 'chain:contractRead',
  chainBalance: 'chain:balance',
  chainBestBlock: 'chain:bestBlock',
  faucetDrip: 'faucet:drip',
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
  /**
   * Spec 0007: checks, dry-runs and prices a `TxIntent` (its SCALE bytes) at
   * the best block of Asset Hub, as the identity's account. A refusal is
   * `ok: false` with the reason; only a transport failure rejects.
   */
  dryRun: (intent: Uint8Array) => Promise<TxDryRun>;
  /** Signs and submits the dry-run `id` with the identity key; resolves with the hash once broadcast. */
  sign: (dryRunId: string) => Promise<{ hash: string }>;
  /** The latest state of a transaction this app submitted, or null. */
  watch: (hash: string) => Promise<TxStatusEvent | null>;
  /**
   * Spec 0007 (M12c): follow a transaction on Asset Hub by hash, own or a
   * peer's reference, until it is finalized (`block`: where the reference
   * says it is, or null). Its states arrive on `onTxStatus`.
   */
  track: (hash: string, block: number | null) => Promise<void>;
  /** Every state change of the transactions this app submits or tracks. Returns the unsubscribe function. */
  onTxStatus: (listener: (event: TxStatusEvent) => void) => () => void;
  /**
   * A read-only contract call at the best block (`ReviveApi_call`) on the
   * chain `chainId` (a genesis hash; Asset Hub is the one this app reads):
   * the return data.
   */
  contractRead: (chainId: string, address: string, calldata: Uint8Array) => Promise<Uint8Array>;
  /** The identity's account on Asset Hub at the best block (M11b balance chip). */
  balance: () => Promise<AccountBalance>;
  /** Every new Asset Hub best block, once the chain is open. Returns the unsubscribe function. */
  onBestBlock: (listener: (block: BestBlock) => void) => () => void;
  /**
   * The embedded Faucet (M12): 1 PAS to the identity from the first funded
   * Substrate dev account, on devnet Asset Hub only (`chainId` must be its
   * genesis; any other is refused). Resolves once broadcast; the states
   * arrive on `onTxStatus` under the returned hash.
   */
  faucetDrip: (chainId: string) => Promise<FaucetDrip>;
};

/** A drip the app sent: the extrinsic hash, the paying dev account ("//Bob"), the chain. */
export type FaucetDrip = { hash: string; from: string; chainId: string };

/** An account's balances at the best block, planck as decimal strings. */
export type AccountBalance = { chainId: string; free: string; reserved: string; frozen: string };

/** A new best block of a chain (`chainId`: its genesis hash). */
export type BestBlock = { chainId: string; number: number };

/**
 * The result of a spec 0007 dry-run. Amounts are planck as decimal strings.
 * `id` is what `sign` takes; null when the action must not be signed.
 */
export type TxDryRun = {
  id: string | null;
  ok: boolean;
  /** Why it will not be signed, in words for the strip. */
  error: string | null;
  /** The signing account, SS58 (prefix 42). */
  signer: string;
  /** The estimated fee, planck; null when the dry-run stopped before pricing. */
  fee: string | null;
  /** The value the calls transfer, planck. */
  value: string;
  /** `Revive.map_account` goes first (the account has never used a contract). */
  mapsAccount: boolean;
  /** 0x-hex return data of the last contract call, when there is one. */
  returnData: string | null;
};

/** One state of a submitted transaction (spec 0007 `TransactionReference.status`). */
export type TxStatusEvent = {
  hash: string;
  status: 'submitted' | 'inBlock' | 'finalized' | 'failed';
  block: number | null;
  /** Why it failed, in words. */
  error: string | null;
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
