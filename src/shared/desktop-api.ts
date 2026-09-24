// Exposed by src/preload as `window.desktop`. Optional on Window because the
// renderer also runs without Electron (vitest, a plain browser).

import type { DemoBot } from './demoBots';
import type { Directive } from './directives';
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
  appOpenLink: 'app:openLink',
  appTakeOpenLink: 'app:takeOpenLink',
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
  chainTransferCall: 'chain:transferCall',
  chainTransfersOf: 'chain:transfersOf',
  faucetDrip: 'faucet:drip',
  diagnosticsAdd: 'diagnostics:add',
  diagnosticsGet: 'diagnostics:get',
  diagnosticsChanged: 'diagnostics:changed',
  demoBots: 'demo:bots',
  agentStatus: 'agent:status',
  agentClaim: 'agent:claim',
  agentProgress: 'agent:progress',
  agentUpdate: 'agent:update',
  agentSetContacts: 'agent:setContacts',
  agentKill: 'agent:kill',
  agentChanged: 'agent:changed',
  bulletinStore: 'bulletin:store',
  bulletinProgress: 'bulletin:progress',
  bulletinFetch: 'bulletin:fetch',
  bulletinAllowance: 'bulletin:allowance',
  fileOpen: 'file:open',
  fileSave: 'file:save',
  storageAtRestKey: 'storage:atRestKey',
  profilesState: 'profiles:state',
  profilesOpen: 'profiles:open',
  profilesOpenInNewWindow: 'profiles:openInNewWindow',
  profilesAdd: 'profiles:add',
  profilesRename: 'profiles:rename',
  profilesRemove: 'profiles:remove',
  profilesSetDefault: 'profiles:setDefault',
  profilesOpenPicker: 'profiles:openPicker',
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
  /**
   * M12g: the call data of `Balances.transfer_keep_alive(to, amount)` on
   * Asset Hub (`to`: a 0x-hex 32-byte account; `amount`: planck, decimal).
   */
  transferCall: (to: string, amount: string) => Promise<Uint8Array>;
  /**
   * M12g: what the transaction `hash` in block `block` moved, from the
   * block's `Balances.Transfer` events (best chain). Empty when the block
   * does not hold it.
   */
  transfersOf: (hash: string, block: number) => Promise<ChainTransfer[]>;
};

/** One `Balances.Transfer` event: accounts as 0x-hex, the amount in planck (decimal). */
export type ChainTransfer = { from: string; to: string; amount: string };

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
  /**
   * The limits signed for the contract calls whose intent set them (spec 0007
   * "Limits of a Revive call"): the deposit limit, planck, and the gas limit
   * over this client's estimate ("1.5"). Null when no call's intent set any.
   */
  caps: { deposit: string; gasFactor: string } | null;
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
export type AssistantDone = {
  conversationId: string;
  messageId: string;
  engine: AssistantEngineId;
  text?: string;
  sessionId?: string;
  /** M13: buttons the engine sent as a `send_buttons` tool call (the fenced block's JSON). */
  directive?: Directive;
};
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
   * A group invite link (`polkadot-chat://g#…`) is not handed out: it comes
   * back as `onOpenLink`.
   */
  openUrl: (url: string) => Promise<void>;
  /** M16b: a group invite link to open in the app (the OS, a message link, a button). */
  onOpenLink: (listener: (url: string) => void) => () => void;
  /** M16b: the invite link that launched the app before the page listened, once. */
  takeOpenLink: () => Promise<string | null>;
};

/**
 * Settings › Diagnostics (M12c): what this app submitted to the Statement
 * Store. Kept by the main process since M12e, so a window reload or a theme
 * switch does not zero it; it counts from the app's start.
 */
export type DiagnosticsCounts = {
  /** Statements submitted, session acknowledgements not included. */
  submissions: number;
  /** Session acknowledgements (responses) submitted. */
  acknowledgements: number;
  /** Messages the user sent: the denominator. */
  messages: number;
  /** Spec 0012: Bulletin transactions main broadcast (chunk stores, devnet grants); not statements. Main only. */
  bulletinTransactions?: number;
};

export type DesktopDiagnosticsApi = {
  /** What the renderer counted since its last call; main adds it to the totals. */
  add: (delta: DiagnosticsCounts) => void;
  get: () => Promise<DiagnosticsCounts>;
  onChanged: (listener: (counts: DiagnosticsCounts) => void) => () => void;
};

/** M12i: the demo bots of a network (a fetched manifest, else the built-in list). */
export type DesktopDemoApi = {
  bots: (profile: NetworkProfileId) => Promise<DemoBot[]>;
};

/** M13: one line of the Settings › Agent log (the last 100 events). */
export type AgentLogEntry = { at: number; kind: 'info' | 'in' | 'out' | 'refused' | 'error'; text: string };

/** Who may talk to the published agent. */
export type AgentAudience = 'contacts' | 'anyone';

/** M13 Settings › Agent: the published agent as the renderer sees it (never a key). */
export type AgentStatus = {
  /** The agent's own identity; null until a username is claimed. */
  identity: IdentitySummary | null;
  /** "Publish my agent" is on. */
  enabled: boolean;
  audience: AgentAudience;
  dailyCap: number;
  cooldownSeconds: number;
  state: 'stopped' | 'starting' | 'running' | 'failed';
  /** Before bot-core starts: `waiting` for the network's attestation of the agent (its statement allowance), `late` when 120 s passed without it (checked again each minute); else null. */
  attestation: 'waiting' | 'late' | null;
  /** Replies left today under the daily cap. */
  repliesLeft: number;
  /** Replies and bot-core submissions since the app started, per peer too (0x-less hex keys). */
  stats: { replies: number; submissions: number; perPeer: Record<string, { replies: number; submissions: number }> };
  log: AgentLogEntry[];
};

/** A username claim for the agent: the same rules as sign-up. */
export type ClaimAgentRequest = { username: string; digits: string | null; profile: NetworkProfileId };

export type AgentSettingsUpdate = { enabled?: boolean; audience?: AgentAudience; dailyCap?: number; cooldownSeconds?: number };

export type DesktopAgentApi = {
  status: () => Promise<AgentStatus>;
  /** Registers the agent's own username (a second identity of this app, its own keys) and turns it on. */
  claim: (request: ClaimAgentRequest) => Promise<CreateIdentityResponse>;
  update: (change: AgentSettingsUpdate) => Promise<AgentStatus>;
  /** The person's contacts (0x-hex accounts): the allowlist of "My contacts only". */
  setContacts: (accounts: string[]) => void;
  /** The kill switch: turns the toggle off, stops accepting and aborts running turns. */
  kill: () => Promise<AgentStatus>;
  onChanged: (listener: (status: AgentStatus) => void) => () => void;
  /** Progress lines of a running `claim`. */
  onProgress: (listener: (line: string) => void) => () => void;
};

/**
 * Spec 0012: a running upload's steps ("storing k of n"). `uploadId` is the
 * caller's; `chunk` (M15c) is the index of the chunk this step stored.
 */
export type BulletinProgress = { uploadId: string; stored: number; total: number; chunk?: number };

/** M15c: what a store call broadcast (chunks the chain had already cost nothing): the quota panel's day meter. */
export type BulletinStoreResult = { submitted: number; submittedBytes: number };

/** M15c: the account's Bulletin authorization at the best block (Settings › Storage). */
export type BulletinQuota = {
  address: string;
  transactionsLeft: number;
  bytesLeft: number;
  transactionsTotal: number;
  bytesTotal: number;
  expiresAtBlock: number;
  /** Estimate, ms since epoch (the expiry block × 6 s from the best block). */
  refillsAt: number;
};

/**
 * Spec 0012 attachments (M15a). The main process holds the Bulletin signer
 * (`//allowance//bulletin//chat` of the identity) and talks to the chain;
 * the renderer encrypts, decrypts and checks hashes.
 */
export type DesktopBulletinApi = {
  /**
   * Stores encrypted chunks (1 to 14, each at most 2 MiB) and resolves when a
   * best block holds every one. On devnet a missing storage grant is asked
   * of `//Eve` first; elsewhere a missing or spent budget rejects with the
   * reason. Progress arrives on `onProgress`.
   */
  store: (uploadId: string, chunks: Uint8Array[]) => Promise<BulletinStoreResult>;
  onProgress: (listener: (progress: BulletinProgress) => void) => () => void;
  /**
   * One chunk by its content hash (0x-hex) on the Bulletin chain `genesis`:
   * `bitswap_v1_get`, then `mirror`, then the network's gateway (or only
   * `only`). `gatewayFirst` (a chunk over 512 KB, spec 0012 "Source order")
   * puts the gateway first and bitswap last. The bytes match the hash; the
   * renderer checks again.
   */
  fetch: (genesis: string, hash: string, mirror: string | null, only?: 'bitswap' | 'mirror' | 'gateway', gatewayFirst?: boolean) => Promise<{ bytes: Uint8Array; source: string }>;
  /** M15c: the authorization left, or null when the account has none. Never grants. */
  allowance: () => Promise<BulletinQuota | null>;
};

/** Spec 0012: a decrypted attachment leaves the renderer only through these. */
export type DesktopFilesApi = {
  /** Opens the file with the system's default app. */
  open: (bytes: Uint8Array, name: string | null, mime: string) => Promise<void>;
  /** The system save dialog; false when cancelled. */
  save: (bytes: Uint8Array, name: string | null, mime: string) => Promise<boolean>;
};

/** M16b: the key that seals the renderer's `keys` table at rest (safeStorage in main). */
export type DesktopStorageApi = {
  atRestKey: () => Promise<Uint8Array>;
};

/** M18: one profile as the picker and Settings › Profiles list it. */
export type ProfileRow = {
  /** The directory name under `profiles/` (never changes). */
  name: string;
  /** The rename, else the username, else a placeholder before sign-up. */
  label: string;
  username: string | null;
  network: NetworkProfileId | null;
  /** Open in some window now (this one included). */
  running: boolean;
  /** The profile of this window. */
  current: boolean;
  /** Opened at launch without asking. */
  isDefault: boolean;
};

export type ProfilesState = {
  /** This window's profile; null in the picker. */
  current: string | null;
  profiles: ProfileRow[];
  /** The profile opened at launch; null shows the picker when there are several. */
  defaultProfile: string | null;
};

/** M18 profiles: several identities on one computer, one process per open profile. */
export type DesktopProfilesApi = {
  state: () => Promise<ProfilesState>;
  /** Opens the profile in this window (the app restarts into it). */
  open: (name: string) => Promise<void>;
  /** Starts the profile in its own window; one that is open already comes to the front. */
  openInNewWindow: (name: string) => Promise<void>;
  /** A new empty profile, opened in this window: sign-up follows. */
  add: () => Promise<void>;
  rename: (name: string, label: string) => Promise<ProfilesState>;
  /** Deletes the directory; refused for a running profile. The caller runs the Undo time first. */
  remove: (name: string) => Promise<ProfilesState>;
  setDefault: (name: string | null) => Promise<ProfilesState>;
  /** The picker in a new window. */
  openPicker: () => Promise<void>;
};

export type DesktopApi = {
  version: string;
  identity: DesktopIdentityApi;
  chain: DesktopChainApi;
  assistant: DesktopAssistantApi;
  app: DesktopAppApi;
  diagnostics: DesktopDiagnosticsApi;
  demo: DesktopDemoApi;
  agent: DesktopAgentApi;
  bulletin: DesktopBulletinApi;
  files: DesktopFilesApi;
  storage: DesktopStorageApi;
  profiles: DesktopProfilesApi;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
