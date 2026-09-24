import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'node:path';

import { BUILD, windowTitle } from '../shared/appVersion';

import { removeOpenedCopies } from './files';
import { isHeadless } from './headless';
import { installInviteLinks, openInviteLink, setInviteLinkWindow } from './inviteLinks';
import { runAgentSelftest } from './agent/service';
import { registerIpc, shutdownAgent } from './ipc';
import { installAppMenu, installContextMenu } from './menu';
import { setMetadataCacheDir } from './metadataCache';
import { loadWindowBounds, rememberWindowBounds } from './windowState';
import { notifyProfileName, registerProfilesIpc, startProfile } from './profileSession';
import { bundleMoved, reopenWindow } from './reopen';

const SMOKE_TIMEOUT_MS = 30_000;
const REOPEN_TEST_TIMEOUT_MS = 60_000;

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

// M18: userData (or PCD_USER_DATA_DIR) is the root of the profiles; this
// process takes one profile (--profile, PCD_PROFILE, the only one, the
// default) or the picker, and points userData at it. Before `ready`, and
// before anything reads userData. The first start after M18 moves the old
// single profile to profiles/default.
const profileStart = startProfile();
if (profileStart.kind === 'exit') process.exit(profileStart.code);

// Automation runs (screenshots, GUI checks) with PCD_HEADLESS=1: see headless.ts.
const headless = isHeadless();

// Group invite links (`polkadot-chat://g#…`, 0011 ruling 9) open the join view. Before `ready`.
installInviteLinks({ headless });

// Test only (scripts/smoke-reopen.sh): close the window and reopen it through
// `activate`, with the window never shown. `--test-reopen-moved` waits for the
// script to move the bundle before the reopen.
const testReopen = process.argv.includes('--test-reopen');
const testReopenMoved = process.argv.includes('--test-reopen-moved');

function createWindow(smoke: boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...loadWindowBounds(),
    // Never shown when headless; the page still paints, so CDP and
    // capturePage() screenshots work on the hidden window.
    show: !smoke && !headless && !testReopen,
    paintWhenInitiallyHidden: true,
    title: windowTitle('Polkadot Chat', notifyProfileName()),
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
  // The page titles itself ("(3) Polkadot Chat" with unread); the window adds
  // the version and, with several profiles, the profile, so the Window menu and
  // Mission Control tell two windows and two builds apart.
  win.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle(windowTitle(title, notifyProfileName()));
  });

  // Message text (assistant replies included) renders links with
  // target=_blank. They open in the system browser, never in a new app window
  // (which would get this window's preload).
  win.webContents.setWindowOpenHandler(({ url }) => {
    // A group invite link in a message opens here (the join view), never outside.
    if (openInviteLink(url)) return { action: 'deny' };
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

function openMainWindow(smoke: boolean): BrowserWindow {
  const win = createWindow(smoke);
  mainWindow = win;
  // Only this window's own close clears the slot: a late `closed` of an older
  // window must not drop the current one (the next activate would add a second).
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

// The bundle was moved or deleted while the app ran (reopen.ts): a new window
// would abort the process, so say why and quit. Once, however many clicks.
let movedNotice = false;
function quitBecauseMoved(): void {
  if (movedNotice) return;
  movedNotice = true;
  console.log('REOPEN_MOVED the app bundle is gone from its start path; quitting');
  if (testReopen) {
    app.quit();
    return;
  }
  void dialog
    .showMessageBox({
      type: 'warning',
      message: 'Polkadot Chat was moved while it was open.',
      detail: 'It cannot open a window from its old place. Open Polkadot Chat again from its new place.',
      buttons: ['Quit'],
    })
    .then(() => app.quit());
}

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
  // macOS About panel: "Version 0.2.1 (abc1234, built 2026-09-24)".
  app.setAboutPanelOptions({ applicationName: 'Polkadot Chat', applicationVersion: BUILD.version, version: `${BUILD.commit}, built ${BUILD.buildDate}` });
  // Before the window exists, so macOS never gives the app a dock icon or the front.
  if (headless) app.dock?.hide();
  registerIpc(getWindow);
  registerProfilesIpc(getWindow);
  setInviteLinkWindow(getWindow);
  installAppMenu(getWindow);
  openMainWindow(process.argv.includes('--smoke'));
  if (testReopen) void runReopenTest();
});

// macOS: clicking the dock icon with no window open opens one again (never
// when headless: there is no dock icon, and no window is to be shown).
app.on('activate', () => {
  if (headless || !app.isReady()) return;
  reopenWindow({ current: getWindow, create: () => openMainWindow(false), moved: () => bundleMoved(), onMoved: quitBecauseMoved });
});

// Attached right after the window is made, before its page can finish.
const pageLoaded = (win: BrowserWindow): Promise<void> => new Promise(resolve => win.webContents.once('did-finish-load', () => resolve()));

// Two rounds of close + activate; each round sends activate twice, so the
// second must re-use the window the first made.
async function runReopenTest(): Promise<void> {
  const timer = setTimeout(() => {
    console.log('REOPEN_TIMEOUT');
    app.exit(2);
  }, REOPEN_TEST_TIMEOUT_MS);
  if (!mainWindow) {
    console.log('REOPEN_FAIL no window');
    app.exit(1);
    return;
  }
  await pageLoaded(mainWindow);
  for (let round = 1; round <= 2; round += 1) {
    const before = mainWindow as BrowserWindow;
    const closed = new Promise<void>(resolve => before.once('closed', () => resolve()));
    before.close();
    await closed;
    if (testReopenMoved) {
      console.log('REOPEN_WAITING for the bundle to move');
      while (!bundleMoved()) await new Promise(resolve => setTimeout(resolve, 200));
      // With the bundle gone this must quit cleanly (REOPEN_MOVED), not abort.
      app.emit('activate');
      return;
    }
    app.emit('activate');
    app.emit('activate');
    const count = BrowserWindow.getAllWindows().length;
    const after = mainWindow as BrowserWindow | null;
    if (!after || after === before || count !== 1) {
      console.log(`REOPEN_FAIL round ${round}: ${count} windows`);
      app.exit(1);
      return;
    }
    await pageLoaded(after);
    console.log(`REOPEN_ROUND ${round} window ${after.id} loaded ${after.webContents.getURL().split('/').slice(-2).join('/')}`);
  }
  clearTimeout(timer);
  console.log('REOPEN_OK');
  app.exit(0);
}

// M13: the published agent's process ends with the app.
app.on('before-quit', () => shutdownAgent());
// M15b: the plaintext copies "Open" wrote to the temp folder go with the app.
app.on('will-quit', () => {
  removeOpenedCopies();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
