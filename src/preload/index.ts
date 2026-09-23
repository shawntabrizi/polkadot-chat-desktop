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
  },
  assistant: {
    getSettings: () => ipcRenderer.invoke(IPC.assistantGetSettings),
    setSettings: update => ipcRenderer.invoke(IPC.assistantSetSettings, update),
    send: request => ipcRenderer.invoke(IPC.assistantSend, request),
    cancel: conversationId => ipcRenderer.invoke(IPC.assistantCancel, conversationId),
    onDelta: listen(IPC.assistantDelta),
    onDone: listen(IPC.assistantDone),
    onError: listen(IPC.assistantError),
  },
};

contextBridge.exposeInMainWorld('desktop', api);
