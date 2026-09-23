import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const SMOKE_TIMEOUT_MS = 30_000;

function createWindow(smoke: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !smoke,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (smoke) watchSmoke(win);

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
  createWindow(process.argv.includes('--smoke'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
