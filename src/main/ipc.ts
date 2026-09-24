/**
 * Every IPC handler of the main process. Inputs from the renderer are checked
 * here: the renderer loads remote chain data, so it is not trusted with more
 * than it asks for.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserWindow, Notification, app, ipcMain, shell } from 'electron';

import {
  type AccountBalance,
  type AssistantActivity,
  type AssistantChatMessage,
  type AssistantDone,
  type AssistantEngineStatus,
  type AssistantSendRequest,
  type AssistantSettings,
  type AssistantSettingsUpdate,
  type ChainTransfer,
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  IPC,
  type IdentitySummary,
  type NotifyRequest,
  type RendererSecrets,
  type TxDryRun,
  type FaucetDrip,
  type TxStatusEvent,
  type UsernameAvailability,
} from '../shared/desktop-api';
import { isNetworkProfileId } from '../shared/network';
import { openableUrl } from '../shared/openUrl';

import { ENGINES, ENGINE_IDS, type Turn, isEngineId } from './assistant/engines';
import { assistantConfig, publicSettings, updateSettings } from './assistant/settings';
import { TOOL_CAPABILITIES, createToolPolicy } from './assistant/toolPolicy';
import { type AssetHubChain, type TxService, createTxService, openAssetHub } from './chain/assetHub';
import { assertDevnetChain, dripDevnet } from './chain/faucet';
import { deriveIdentityKeys } from './identity/keys';
import { checkAvailability, createIdentity } from './identity/service';
import { dropIdentityBackup, loadIdentity, restoreIdentity, saveIdentity, stashIdentity } from './identity/store';
import { createDemoManifestSource } from './demoManifest';
import { createDiagnostics } from './diagnostics';
import { readMetadata, writeMetadata } from './metadataCache';
import { isHeadless } from './headless';
import { showNotification } from './notify';

// The mobile app's rule: lowercase letters only, 6 to 29 of them.
const USERNAME = /^[a-z]{6,29}$/;
const DIGITS = /^\d{2}$/;

let creating = false;

/**
 * How long a reset stays undoable. Longer than the renderer's 8 s Undo toast,
 * so an Undo clicked at the last moment still finds the backup.
 */
const RESET_GRACE_MS = 10_000;
let resetTimer: ReturnType<typeof setTimeout> | null = null;

// Limits on what the renderer may send to the proxy: a system prompt plus
// the last turns of one room, each a chat message of normal size.
const MAX_CONTEXT_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_SETTING_CHARS = 2_000;
const CONVERSATION_ID = /^[\w:.-]{1,64}$/;
const SESSION_ID = /^[\w.:-]{1,128}$/;
const MAX_NOTIFY_CHARS = 300;
const ROLES = new Set<AssistantChatMessage['role']>(['system', 'user', 'assistant']);

/** Largest `TxIntent` the renderer may pass: 8 calls of 16 KiB plus the texts. */
const MAX_INTENT_BYTES = 8 * 16 * 1024 + 4096;
const MAX_CALLDATA_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const CONTRACT = /^0x[0-9a-fA-F]{40}$/;
const GENESIS = /^0x[0-9a-fA-F]{64}$/;
const ACCOUNT = /^0x[0-9a-fA-F]{64}$/;

/**
 * Spec 0007: one Asset Hub connection and signing service for the identity
 * on this computer, opened on first use. A failed open is not kept, so the
 * next press tries again. The service holds the wallet key's sign function,
 * never the mnemonic.
 */
let txService: { key: string; service: Promise<TxService>; chain: Promise<AssetHubChain> } | null = null;
/** The Asset Hub connection the tx service uses (the embedded Faucet sends on it too). */
const assetHubFor = async (getWindow: () => BrowserWindow | null): Promise<AssetHubChain> => {
  await txServiceFor(getWindow);
  if (!txService) throw new Error('Asset Hub is not open.');
  return txService.chain;
};
const sendTxStatus = (getWindow: () => BrowserWindow | null, event: TxStatusEvent): void => {
  const win = getWindow();
  if (win && !win.webContents.isDestroyed()) win.webContents.send(IPC.chainTxStatus, event);
};
const txServiceFor = (getWindow: () => BrowserWindow | null): Promise<TxService> => {
  const identity = loadIdentity();
  if (!identity) return Promise.reject(new Error('This computer has no identity yet.'));
  const key = `${identity.profile}:${identity.accountHex}`;
  if (txService?.key === key) return txService.service;
  void txService?.service.then(old => old.dispose(), () => undefined);
  const chain = openAssetHub(identity.profile);
  const service = chain.then(chain => {
    const keys = deriveIdentityKeys(identity.mnemonic);
    const created = createTxService(chain, { publicKey: keys.accountId, sign: keys.sign });
    created.onStatus((event: TxStatusEvent) => {
      const win = getWindow();
      if (win && !win.webContents.isDestroyed()) win.webContents.send(IPC.chainTxStatus, event);
    });
    created.onBestBlock(block => {
      const win = getWindow();
      if (win && !win.webContents.isDestroyed()) win.webContents.send(IPC.chainBestBlock, block);
    });
    return created;
  });
  const entry = { key, service, chain };
  txService = entry;
  service.catch(() => {
    if (txService === entry) txService = null;
  });
  return service;
};

/** One running reply per conversation; `assistant:cancel` aborts it. */
const assistantStreams = new Map<string, AbortController>();

const parseSendRequest = (value: unknown): AssistantSendRequest => {
  const request = value as Partial<AssistantSendRequest> | null;
  if (typeof request?.conversationId !== 'string' || !CONVERSATION_ID.test(request.conversationId)) {
    throw new Error('Invalid conversation id.');
  }
  const messages = request.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_CONTEXT_MESSAGES) {
    throw new Error(`Send 1 to ${MAX_CONTEXT_MESSAGES} messages.`);
  }
  // A session id goes to a CLI as an argument: plain characters only.
  if (request.sessionId !== undefined && (typeof request.sessionId !== 'string' || !SESSION_ID.test(request.sessionId))) {
    throw new Error('Invalid session id.');
  }
  return {
    conversationId: request.conversationId,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    messages: messages.map((entry: unknown): AssistantChatMessage => {
      const message = entry as Partial<AssistantChatMessage> | null;
      if (!message || !ROLES.has(message.role as AssistantChatMessage['role'])) throw new Error('Invalid message role.');
      if (typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_CHARS) throw new Error('Invalid message text.');
      return { role: message.role as AssistantChatMessage['role'], content: message.content };
    }),
  };
};

const parseSettingsUpdate = (value: unknown): AssistantSettingsUpdate => {
  const update = value as Record<string, unknown> | null;
  const field = (name: 'model' | 'baseUrl' | 'key'): string | undefined => {
    const entry = update?.[name];
    if (entry === undefined) return undefined;
    if (typeof entry !== 'string' || entry.length > MAX_SETTING_CHARS) throw new Error(`Invalid ${name}.`);
    return entry;
  };
  const baseUrl = field('baseUrl');
  if (baseUrl?.trim() && !/^https?:\/\//.test(baseUrl.trim())) throw new Error('The base URL must start with https:// or http://.');
  const engine = update?.engine;
  if (engine !== undefined && !isEngineId(engine)) throw new Error('Unknown engine.');
  const tools = update?.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !(TOOL_CAPABILITIES as readonly string[]).includes(tool)))) {
    throw new Error('Unknown tool.');
  }
  return {
    model: field('model'),
    baseUrl,
    key: field('key'),
    ...(engine !== undefined ? { engine } : {}),
    ...(tools !== undefined ? { tools: tools as AssistantSettingsUpdate['tools'] } : {}),
  };
};

const parseNotify = (value: unknown): NotifyRequest => {
  const request = value as Partial<NotifyRequest> | null;
  const text = (entry: unknown): string => (typeof entry === 'string' ? entry.slice(0, MAX_NOTIFY_CHARS) : '');
  if (typeof request?.peerId !== 'string' || request.peerId.length > 200) throw new Error('Invalid notification.');
  return {
    title: text(request.title),
    body: text(request.body),
    peerId: request.peerId,
    ...(typeof request.requestId === 'string' && request.requestId.length <= 200 ? { requestId: request.requestId } : {}),
    sound: request.sound === true,
  };
};

/**
 * The folder a CLI engine runs in, created empty on first use. The real
 * path, so the engines' path rules match what the CLI sees (macOS /var is
 * /private/var).
 */
const assistantWorkspace = (): string => {
  const dir = join(app.getPath('userData'), 'assistant-workspace');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return realpathSync(dir);
};



const parseCreateRequest = (value: unknown): CreateIdentityRequest => {
  const request = value as Partial<CreateIdentityRequest> | null;
  if (typeof request?.username !== 'string' || !USERNAME.test(request.username)) {
    throw new Error('The username must be 6 to 29 lowercase letters.');
  }
  if (request.digits !== null && (typeof request.digits !== 'string' || !DIGITS.test(request.digits))) {
    throw new Error('The number must be two digits, 00 to 99.');
  }
  if (!isNetworkProfileId(request.profile)) throw new Error('Unknown network.');
  return { username: request.username, digits: request.digits, profile: request.profile };
};

export const registerIpc = (getWindow: () => BrowserWindow | null): void => {
  ipcMain.handle(IPC.identityGet, (): IdentitySummary | null => {
    const identity = loadIdentity();
    return identity ? { username: identity.username, accountHex: identity.accountHex, profile: identity.profile } : null;
  });

  ipcMain.handle(IPC.identityAvailable, (_event, username: unknown, profile: unknown): Promise<UsernameAvailability> => {
    if (typeof username !== 'string' || !USERNAME.test(username)) throw new Error('The username must be 6 to 29 lowercase letters.');
    if (!isNetworkProfileId(profile)) throw new Error('Unknown network.');
    return checkAvailability(username, profile);
  });

  ipcMain.handle(IPC.identityCreate, async (event, value: unknown): Promise<CreateIdentityResponse> => {
    const request = parseCreateRequest(value);
    if (creating) throw new Error('A sign-up is already running.');
    creating = true;
    try {
      return await createIdentity({
        ...request,
        store: { save: saveIdentity, load: loadIdentity },
        onProgress: line => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.identityProgress, line);
        },
      });
    } finally {
      creating = false;
    }
  });

  // A backup left by a reset whose grace period did not end (the app quit or
  // crashed first) is restored: the renderer may not have wiped its database
  // yet, and restoring loses nothing. With a new identity in place it is dropped.
  if (!restoreIdentity()) dropIdentityBackup();

  ipcMain.handle(IPC.identityReset, (): void => {
    // A reset during a sign-up would race the save of the new mnemonic.
    if (creating) throw new Error('A sign-up is running. Wait for it to end.');
    stashIdentity();
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetTimer = null;
      dropIdentityBackup();
    }, RESET_GRACE_MS);
  });

  ipcMain.handle(IPC.identityResetUndo, (): boolean => {
    if (!resetTimer) return false;
    clearTimeout(resetTimer);
    resetTimer = null;
    return restoreIdentity();
  });

  // Runtime metadata is public; the cache module checks the code hash and the size.
  ipcMain.handle(IPC.chainMetadataGet, (_event, codeHash: unknown): Promise<Uint8Array | null> =>
    typeof codeHash === 'string' ? readMetadata(codeHash) : Promise.resolve(null),
  );
  ipcMain.handle(IPC.chainMetadataSet, (_event, codeHash: unknown, metadata: unknown): void => {
    if (typeof codeHash === 'string' && metadata instanceof Uint8Array) writeMetadata(codeHash, metadata);
  });

  // Spec 0007. The intent bytes are decoded and checked again in main; sign
  // takes only the id of a dry-run that passed (assetHub.ts).
  ipcMain.handle(IPC.chainDryRun, async (_event, intent: unknown): Promise<TxDryRun> => {
    if (!(intent instanceof Uint8Array) || intent.length > MAX_INTENT_BYTES) throw new Error('Invalid action.');
    return (await txServiceFor(getWindow)).dryRun(intent);
  });
  ipcMain.handle(IPC.chainSign, async (_event, dryRunId: unknown): Promise<{ hash: string }> => {
    if (typeof dryRunId !== 'string' || !UUID.test(dryRunId)) throw new Error('Run the test first.');
    return (await txServiceFor(getWindow)).sign(dryRunId);
  });
  ipcMain.handle(IPC.chainWatch, async (_event, hash: unknown): Promise<TxStatusEvent | null> => {
    if (typeof hash !== 'string' || !TX_HASH.test(hash)) return null;
    return (await txServiceFor(getWindow)).status(hash);
  });
  ipcMain.handle(IPC.chainTrack, async (_event, hash: unknown, block: unknown): Promise<void> => {
    if (typeof hash !== 'string' || !TX_HASH.test(hash)) return;
    if (block !== null && !(typeof block === 'number' && Number.isInteger(block) && block >= 0)) return;
    (await txServiceFor(getWindow)).track(hash, block);
  });
  ipcMain.handle(IPC.chainContractRead, async (_event, chainId: unknown, address: unknown, calldata: unknown): Promise<Uint8Array> => {
    if (typeof chainId !== 'string' || !GENESIS.test(chainId)) throw new Error('Invalid chain id.');
    if (typeof address !== 'string' || !CONTRACT.test(address)) throw new Error('Invalid contract address.');
    if (!(calldata instanceof Uint8Array) || calldata.length > MAX_CALLDATA_BYTES) throw new Error('Invalid call data.');
    return (await txServiceFor(getWindow)).contractRead(chainId, address, calldata);
  });
  ipcMain.handle(IPC.chainBalance, async (): Promise<AccountBalance> => (await txServiceFor(getWindow)).balance());
  // M12g: call data only; nothing is signed without a dry-run of the intent that holds it.
  ipcMain.handle(IPC.chainTransferCall, async (_event, to: unknown, amount: unknown): Promise<Uint8Array> => {
    if (typeof to !== 'string' || !ACCOUNT.test(to)) throw new Error('Invalid account.');
    if (typeof amount !== 'string' || !/^[1-9]\d{0,37}$/.test(amount)) throw new Error('Invalid amount.');
    return (await txServiceFor(getWindow)).transferCall(Uint8Array.from(Buffer.from(to.slice(2), 'hex')), BigInt(amount));
  });
  ipcMain.handle(IPC.chainTransfersOf, async (_event, hash: unknown, block: unknown): Promise<ChainTransfer[]> => {
    if (typeof hash !== 'string' || !TX_HASH.test(hash)) throw new Error('Invalid transaction hash.');
    if (!(typeof block === 'number' && Number.isInteger(block) && block >= 0)) throw new Error('Invalid block.');
    return (await txServiceFor(getWindow)).transfersOf(hash, block);
  });
  // The embedded Faucet: devnet Asset Hub only (the guard is checked before anything opens).
  ipcMain.handle(IPC.faucetDrip, async (_event, chainId: unknown): Promise<FaucetDrip> => {
    const allowed = assertDevnetChain(chainId);
    const identity = loadIdentity();
    if (!identity) throw new Error('This computer has no identity yet.');
    const to = deriveIdentityKeys(identity.mnemonic).accountId;
    return dripDevnet(await assetHubFor(getWindow), allowed, to, event => sendTxStatus(getWindow, event));
  });

  ipcMain.handle(IPC.assistantGetSettings, (): AssistantSettings => publicSettings());
  ipcMain.handle(IPC.assistantSetSettings, (_event, value: unknown): AssistantSettings => {
    updateSettings(parseSettingsUpdate(value));
    return publicSettings();
  });

  // Returns the reply id at once; the reply streams as events. The key is
  // read here, in main, and never crosses to the renderer. The engine is the
  // one chosen in Settings; a CLI engine runs in the assistant workspace with
  // the tools chosen there (none by default).
  ipcMain.handle(IPC.assistantSend, (event, value: unknown): { messageId: string } => {
    const { conversationId, messages, sessionId } = parseSendRequest(value);
    if (assistantStreams.has(conversationId)) throw new Error('The assistant is still answering. Stop it first.');
    const last = messages.at(-1);
    if (last?.role !== 'user') throw new Error('The last message must be the user\'s.');
    const config = assistantConfig();
    const engine = ENGINES[config.engine];
    const messageId = randomUUID();
    const controller = new AbortController();
    assistantStreams.set(conversationId, controller);
    const emit = (channel: string, payload: object) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };
    const history = messages.slice(0, -1).filter((message): message is Turn => message.role !== 'system');
    const systemPrompt = messages.find(message => message.role === 'system')?.content ?? '';
    Promise.resolve()
      .then(() =>
        engine.run({
          prompt: last.content,
          history,
          systemPrompt,
          ...(sessionId && engine.id !== 'proxy' ? { sessionId } : {}),
          signal: controller.signal,
          onDelta: text => emit(IPC.assistantDelta, { conversationId, messageId, text }),
          onEvent: engineEvent => {
            if (engineEvent.type === 'tool_use' || engineEvent.type === 'thinking') {
              const activity: AssistantActivity = { conversationId, messageId, event: engineEvent };
              emit(IPC.assistantEvent, activity);
            }
          },
          workspace: engine.id === 'proxy' ? '' : assistantWorkspace(),
          policy: createToolPolicy({ capabilities: config.tools }),
          model: config.model,
          baseUrl: config.baseUrl,
          key: config.key,
        }),
      )
      .then(result => {
        const done: AssistantDone = {
          conversationId,
          messageId,
          engine: engine.id,
          ...(engine.id !== 'proxy' ? { text: result.text } : {}),
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        };
        emit(IPC.assistantDone, done);
      })
      .catch((cause: unknown) => {
        const message = controller.signal.aborted ? 'Stopped.' : cause instanceof Error ? cause.message : 'The assistant failed.';
        emit(IPC.assistantError, { conversationId, messageId, message });
      })
      .finally(() => {
        if (assistantStreams.get(conversationId) === controller) assistantStreams.delete(conversationId);
      });
    return { messageId };
  });

  ipcMain.handle(IPC.assistantDetect, (): Promise<AssistantEngineStatus[]> =>
    Promise.all(
      ENGINE_IDS.map(async id => {
        const found = await ENGINES[id].detect();
        return { id, label: ENGINES[id].label, installed: found.installed, ...(found.version ? { version: found.version } : {}) };
      }),
    ),
  );

  // A click focuses the window and opens the room. The body is the message
  // text the renderer already shows; nothing else leaves the app.
  ipcMain.handle(IPC.notifyShow, (_event, value: unknown): void => {
    showNotification(parseNotify(value), {
      isSupported: () => Notification.isSupported(),
      create: options => new Notification(options),
      beep: () => shell.beep(),
      getWindow,
      headless: isHeadless(),
    });
  });

  // M12e: the Diagnostics totals outlive a page load (main/diagnostics.ts).
  const diagnostics = createDiagnostics();
  ipcMain.handle(IPC.diagnosticsAdd, (_event, delta: unknown): void => {
    const totals = diagnostics.add(delta);
    const win = getWindow();
    if (totals && win && !win.webContents.isDestroyed()) win.webContents.send(IPC.diagnosticsChanged, totals);
  });
  ipcMain.handle(IPC.diagnosticsGet, () => diagnostics.snapshot());

  // M12i: the demo bots list; a manifest URL is fetched here, never by the renderer.
  const demoManifest = createDemoManifestSource();
  ipcMain.handle(IPC.demoBots, async (_event, profile: unknown) => {
    if (!isNetworkProfileId(profile)) throw new Error('Unknown network.');
    return [...(await demoManifest())[profile]];
  });

  ipcMain.handle(IPC.appSetBadge, (_event, count: unknown): void => {
    const n = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 9999) : 0;
    app.dock?.setBadge(n > 0 ? String(n) : '');
  });

  // Spec 0006 `url` buttons. The renderer shows remote content, so the scheme
  // rule is checked again here: nothing but https and polkadotapp leaves.
  ipcMain.handle(IPC.openUrl, async (_event, value: unknown): Promise<void> => {
    const target = typeof value === 'string' ? openableUrl(value) : null;
    if (!target) throw new Error('Only https and polkadotapp links can be opened.');
    await shell.openExternal(target.href);
  });

  ipcMain.handle(IPC.assistantCancel, (_event, conversationId: unknown): void => {
    if (typeof conversationId === 'string') assistantStreams.get(conversationId)?.abort();
  });

  // The only channel that carries secrets. It exists so the renderer can seed
  // its Dexie device and identity rows (single device: the identity wallet is
  // the statement account; the device has its own encryption key). It sends
  // derived keys, never the mnemonic.
  ipcMain.handle(IPC.identitySecretsForRenderer, (): RendererSecrets => {
    const identity = loadIdentity();
    if (!identity) throw new Error('This computer has no identity yet.');
    const keys = deriveIdentityKeys(identity.mnemonic);
    return {
      statementSeed: keys.walletSecret64,
      chatPrivateKey: keys.chatPrivateKey,
      deviceEncryptionPrivateKey: keys.deviceEncryptionPrivateKey,
    };
  });
};
