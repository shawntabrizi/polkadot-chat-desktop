import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ Menu: {}, app: {}, shell: {} }));

const { buildMenuTemplate } = await import('./menu');

type Item = { label?: string; role?: string; accelerator?: string; click?: () => void; submenu?: Item[] };

const build = (isDev: boolean, isMac = true) => {
  const calls: string[] = [];
  const template = buildMenuTemplate({
    appName: 'Polkadot Chat',
    isDev,
    isMac,
    openSettings: () => calls.push('settings'),
    openReadme: () => calls.push('readme'),
  }) as Item[];
  const menu = (label: string) => template.find(item => item.label === label || item.role === label)?.submenu ?? [];
  return { template, menu, calls };
};

describe('application menu', () => {
  // macOS convention: the app menu first, with Preferences… on ⌘,.
  it('puts About, Preferences…, Hide and Quit in the app menu', () => {
    const { template, menu, calls } = build(false);
    expect(template[0]?.label).toBe('Polkadot Chat');
    const app = menu('Polkadot Chat');
    expect(app.map(item => item.role ?? item.label).filter(Boolean)).toEqual(['about', 'Preferences…', 'hide', 'hideOthers', 'unhide', 'quit']);
    const preferences = app.find(item => item.label === 'Preferences…');
    expect(preferences?.accelerator).toBe('CmdOrCtrl+,');
    preferences?.click?.();
    expect(calls).toEqual(['settings']);
  });

  // The roles are what make copy and paste work in every field.
  it('uses the edit roles', () => {
    expect(build(false).menu('Edit').map(item => item.role).filter(Boolean)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('offers Reload and Developer Tools only in development', () => {
    expect(build(true).menu('View').map(item => item.role).filter(Boolean)).toEqual(['reload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut']);
    expect(build(false).menu('View').map(item => item.role).filter(Boolean)).toEqual(['resetZoom', 'zoomIn', 'zoomOut']);
  });

  it('has Window and a Help link to the README', () => {
    const { menu, calls } = build(false);
    expect(menu('Window').map(item => item.role)).toEqual(['minimize', 'close']);
    menu('help')[0]?.click?.();
    expect(calls).toEqual(['readme']);
  });
});
