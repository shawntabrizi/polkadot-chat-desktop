import { contextBridge } from 'electron';

import type { DesktopApi } from '../shared/desktop-api';

const api: DesktopApi = { version: process.versions.electron };

contextBridge.exposeInMainWorld('desktop', api);
