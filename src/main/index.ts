import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { registerIpc } from './ipc';
import { setMetadataCacheDir } from './metadataCache';
import { loadWindowBounds, rememberWindowBounds } from './windowState';

const SMOKE_TIMEOUT_MS = 30_000;

// package.json's productName ("Polkadot Chat") names the packaged app, and so
// its profile and its keychain entry. Electron would also give it to a dev run;
// a dev run keeps the old name so the two stay apart and the dev identity stays
// where it is. Must run before `ready` (the keychain entry takes the name then).
const DEV_APP_NAME = 'polkadot-chat-desktop';
if (!app.isPackaged) {
  app.setName(DEV_APP_NAME);
  app.setPath('userData', join(app.getPath('appData'), DEV_APP_NAME));
}

// Tests run the app against a throwaway profile (identity, IndexedDB, window
// state) so they never touch the owner's. Must be set before `ready`.
const userDataOverride = process.env.PCD_USER_DATA_DIR;
if (userDataOverride) app.setPath('userData', userDataOverride);

function createWindow(smoke: boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...loadWindowBounds(),
    show: !smoke,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (smoke) watchSmoke(win);
  else rememberWindowBounds(win);

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}

// The smoke run proves the packaged renderer loads; it exits with a code a
// script can check instead of leaving a window open.
function watchSmoke(win: BrowserWindow): void {
  const timer = setTimeout(() => {
    console.log('SMOKE_TIMEOUT');
    app.exit(2);
  }, SMOKE_TIMEOUT_MS);

  win.webContents.once('did-finish-load', () => {
    clearTimeout(timer);
    console.log('SMOKE_OK');
    app.exit(0);
  });
  win.webContents.once('did-fail-load', (_event, _code, errorDescription) => {
    clearTimeout(timer);
    console.log(`SMOKE_FAIL ${errorDescription}`);
    app.exit(1);
  });
}

void app.whenReady().then(() => {
  setMetadataCacheDir(join(app.getPath('userData'), 'metadata'));
  registerIpc();
  createWindow(process.argv.includes('--smoke'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
