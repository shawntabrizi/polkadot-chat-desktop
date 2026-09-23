import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';

import { type DesktopApi, IPC } from '../shared/desktop-api';

const api: DesktopApi = {
  version: process.versions.electron,
  identity: {
    get: () => ipcRenderer.invoke(IPC.identityGet),
    available: (username, profile) => ipcRenderer.invoke(IPC.identityAvailable, username, profile),
    create: request => ipcRenderer.invoke(IPC.identityCreate, request),
    secretsForRenderer: () => ipcRenderer.invoke(IPC.identitySecretsForRenderer),
    reset: () => ipcRenderer.invoke(IPC.identityReset),
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
};

contextBridge.exposeInMainWorld('desktop', api);
