import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';

import { type DesktopApi, IPC } from '../shared/desktop-api';

/** Subscribes to one main → renderer channel; returns the unsubscribe function. */
const listen =
  <T>(channel: string) =>
  (listener: (event: T) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, value: T) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };

const api: DesktopApi = {
  version: process.versions.electron,
  identity: {
    get: () => ipcRenderer.invoke(IPC.identityGet),
    available: (username, profile) => ipcRenderer.invoke(IPC.identityAvailable, username, profile),
    create: request => ipcRenderer.invoke(IPC.identityCreate, request),
    secretsForRenderer: () => ipcRenderer.invoke(IPC.identitySecretsForRenderer),
    reset: () => ipcRenderer.invoke(IPC.identityReset),
    resetUndo: () => ipcRenderer.invoke(IPC.identityResetUndo),
    onProgress: listener => {
      const handler = (_event: IpcRendererEvent, line: string) => listener(line);
      ipcRenderer.on(IPC.identityProgress, handler);
      return () => {
        ipcRenderer.removeListener(IPC.identityProgress, handler);
      };
    },
  },
  chain: {
    getMetadata: codeHash => ipcRenderer.invoke(IPC.chainMetadataGet, codeHash),
    setMetadata: (codeHash, metadata) => {
      void ipcRenderer.invoke(IPC.chainMetadataSet, codeHash, metadata);
    },
    dryRun: intent => ipcRenderer.invoke(IPC.chainDryRun, intent),
    sign: dryRunId => ipcRenderer.invoke(IPC.chainSign, dryRunId),
    watch: hash => ipcRenderer.invoke(IPC.chainWatch, hash),
    track: (hash, block) => ipcRenderer.invoke(IPC.chainTrack, hash, block),
    onTxStatus: listen(IPC.chainTxStatus),
    contractRead: (chainId, address, calldata) => ipcRenderer.invoke(IPC.chainContractRead, chainId, address, calldata),
    balance: () => ipcRenderer.invoke(IPC.chainBalance),
    onBestBlock: listen(IPC.chainBestBlock),
    faucetDrip: chainId => ipcRenderer.invoke(IPC.faucetDrip, chainId),
    transferCall: (to, amount) => ipcRenderer.invoke(IPC.chainTransferCall, to, amount),
    transfersOf: (hash, block) => ipcRenderer.invoke(IPC.chainTransfersOf, hash, block),
  },
  assistant: {
    getSettings: () => ipcRenderer.invoke(IPC.assistantGetSettings),
    setSettings: update => ipcRenderer.invoke(IPC.assistantSetSettings, update),
    send: request => ipcRenderer.invoke(IPC.assistantSend, request),
    cancel: conversationId => ipcRenderer.invoke(IPC.assistantCancel, conversationId),
    onDelta: listen(IPC.assistantDelta),
    onDone: listen(IPC.assistantDone),
    onError: listen(IPC.assistantError),
    onActivity: listen(IPC.assistantEvent),
    detect: () => ipcRenderer.invoke(IPC.assistantDetect),
  },
  app: {
    setBadge: count => {
      void ipcRenderer.invoke(IPC.appSetBadge, count);
    },
    notify: request => {
      void ipcRenderer.invoke(IPC.notifyShow, request);
    },
    onNotifyOpen: listen(IPC.notifyOpen),
    onMenuSettings: listener => listen<void>(IPC.menuSettings)(() => listener()),
    openUrl: url => ipcRenderer.invoke(IPC.openUrl, url),
    onOpenLink: listen(IPC.appOpenLink),
    takeOpenLink: () => ipcRenderer.invoke(IPC.appTakeOpenLink),
  },
  diagnostics: {
    add: delta => {
      void ipcRenderer.invoke(IPC.diagnosticsAdd, delta);
    },
    get: () => ipcRenderer.invoke(IPC.diagnosticsGet),
    onChanged: listen(IPC.diagnosticsChanged),
  },
  demo: {
    bots: profile => ipcRenderer.invoke(IPC.demoBots, profile),
  },
  agent: {
    status: () => ipcRenderer.invoke(IPC.agentStatus),
    claim: request => ipcRenderer.invoke(IPC.agentClaim, request),
    update: change => ipcRenderer.invoke(IPC.agentUpdate, change),
    setContacts: accounts => {
      void ipcRenderer.invoke(IPC.agentSetContacts, accounts);
    },
    kill: () => ipcRenderer.invoke(IPC.agentKill),
    onChanged: listen(IPC.agentChanged),
    onProgress: listen(IPC.agentProgress),
  },
  bulletin: {
    store: (uploadId, chunks) => ipcRenderer.invoke(IPC.bulletinStore, uploadId, chunks),
    onProgress: listen(IPC.bulletinProgress),
    fetch: (genesis, hash, mirror, only, gatewayFirst) => ipcRenderer.invoke(IPC.bulletinFetch, genesis, hash, mirror, only, gatewayFirst),
    allowance: () => ipcRenderer.invoke(IPC.bulletinAllowance),
  },
  files: {
    open: (bytes, name, mime) => ipcRenderer.invoke(IPC.fileOpen, bytes, name, mime),
    save: (bytes, name, mime) => ipcRenderer.invoke(IPC.fileSave, bytes, name, mime),
  },
  storage: {
    atRestKey: () => ipcRenderer.invoke(IPC.storageAtRestKey),
  },
};

contextBridge.exposeInMainWorld('desktop', api);
