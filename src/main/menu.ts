/**
 * The application menu (macOS convention: the app menu first) and the text
 * context menu with spelling suggestions. Edit uses the built-in roles, so
 * copy and paste work in every field.
 */

import { type BrowserWindow, Menu, type MenuItemConstructorOptions, app, shell } from 'electron';

import { IPC } from '../shared/desktop-api';

import { isHeadless } from './headless';

/** Help opens the project README (unverified: the repo has no remote yet; docs/questions.md). */
export const README_URL = 'https://github.com/shawntabrizi/polkadot-chat-desktop#readme';

export const buildMenuTemplate = ({
  appName,
  isDev,
  isMac,
  openSettings,
  openReadme,
}: {
  appName: string;
  isDev: boolean;
  isMac: boolean;
  openSettings: () => void;
  openReadme: () => void;
}): MenuItemConstructorOptions[] => {
  const preferences: MenuItemConstructorOptions = { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: openSettings };
  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              preferences,
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : [{ label: 'File', submenu: [preferences, { type: 'separator' }, { role: 'quit' }] } satisfies MenuItemConstructorOptions]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] satisfies MenuItemConstructorOptions[]) : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { role: 'help', submenu: [{ label: `${appName} README`, click: openReadme }] },
  ];
};

export const installAppMenu = (getWindow: () => BrowserWindow | null): void => {
  const template = buildMenuTemplate({
    appName: 'Polkadot Chat',
    isDev: !app.isPackaged,
    isMac: process.platform === 'darwin',
    openSettings: () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (!isHeadless()) win.show();
      win.webContents.send(IPC.menuSettings);
    },
    openReadme: () => void shell.openExternal(README_URL),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

/**
 * Right-click: spelling suggestions and "Add to Dictionary" on a misspelled
 * word, then Cut/Copy/Paste in a text field, or Copy on a selection.
 */
export const installContextMenu = (win: BrowserWindow): void => {
  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false });
      items.push({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste });
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
};
