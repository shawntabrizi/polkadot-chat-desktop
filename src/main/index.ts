import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

import { removeOpenedCopies } from './files';
import { isHeadless } from './headless';
import { runAgentSelftest } from './agent/service';
import { registerIpc, shutdownAgent } from './ipc';
import { installAppMenu, installContextMenu } from './menu';
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

// Automation runs (screenshots, GUI checks) with PCD_HEADLESS=1: see headless.ts.
const headless = isHeadless();

function createWindow(smoke: boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...loadWindowBounds(),
    // Never shown when headless; the page still paints, so CDP and
    // capturePage() screenshots work on the hidden window.
    show: !smoke && !headless,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // A hidden window is a background page to Chromium: its timers would be
      // throttled and `document.visibilityState` would say hidden.
      ...(headless ? { backgroundThrottling: false } : {}),
    },
  });
  installContextMenu(win);

  // Message text (assistant replies included) renders links with
  // target=_blank. They open in the system browser, never in a new app window
  // (which would get this window's preload).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
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

let mainWindow: BrowserWindow | null = null;
const getWindow = (): BrowserWindow | null => mainWindow;

// M13: --agent-selftest proves the published agent's utility process can load
// bot-core (smoke-packaged.sh runs it against the packaged app), then exits.
const agentSelftest = process.argv.includes('--agent-selftest');

void app.whenReady().then(async () => {
  if (agentSelftest) {
    app.dock?.hide();
    app.exit(await runAgentSelftest());
    return;
  }
  setMetadataCacheDir(join(app.getPath('userData'), 'metadata'));
  // Before the window exists, so macOS never gives the app a dock icon or the front.
  if (headless) app.dock?.hide();
  registerIpc(getWindow);
  installAppMenu(getWindow);
  mainWindow = createWindow(process.argv.includes('--smoke'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

// macOS: clicking the dock icon with no window open opens one again (never
// when headless: there is no dock icon, and no window is to be shown).
app.on('activate', () => {
  if (!headless && mainWindow === null && app.isReady()) {
    mainWindow = createWindow(false);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }
});

// M13: the published agent's process ends with the app.
app.on('before-quit', () => shutdownAgent());
// M15b: the plaintext copies "Open" wrote to the temp folder go with the app.
app.on('will-quit', () => {
  removeOpenedCopies();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
