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
    onTxStatus: listen(IPC.chainTxStatus),
    contractRead: (chainId, address, calldata) => ipcRenderer.invoke(IPC.chainContractRead, chainId, address, calldata),
    balance: () => ipcRenderer.invoke(IPC.chainBalance),
    onBestBlock: listen(IPC.chainBestBlock),
    faucetDrip: chainId => ipcRenderer.invoke(IPC.faucetDrip, chainId),
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
  },
};

contextBridge.exposeInMainWorld('desktop', api);
