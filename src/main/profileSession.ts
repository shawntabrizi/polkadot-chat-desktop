/**
 * M18: this process's profile. One process per open profile: the process
 * points Electron's userData at its profile's directory before `ready`, takes
 * the single-instance lock of that directory (Electron keys the lock on
 * userData, so the lock is per profile), and marks the profile running. The
 * picker is a process of its own with an empty Chromium folder (`.picker`).
 * "Open" in this window restarts the app into the profile (Chromium's profile
 * folder cannot change after `ready`); "Open in new window" starts another
 * process with `--profile <name>`.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { type BrowserWindow, app, ipcMain } from 'electron';

import { IPC, type ProfilesState } from '../shared/desktop-api';

import {
  type LaunchChoice,
  PICKER_DIR,
  clearRunning,
  ensureLayout,
  ensureProfile,
  identityDisplay,
  identityOpenElsewhere,
  isProfileName,
  markRunning,
  nextProfileName,
  pidAlive,
  profileDir,
  profileRows,
  readProfiles,
  readRunning,
  refreshDisplay,
  removeProfile,
  renameProfile,
  resolveLaunch,
  setDefaultProfile,
} from './profiles';

type Session = { root: string; current: string | null };
let session: Session | null = null;

export type ProfileStart = { kind: 'profile'; name: string } | { kind: 'picker' } | { kind: 'exit'; code: number };

/**
 * Runs before `ready`: the layout (with the one-time migration), the choice
 * of profile, userData, the lock and the running mark. `exit` means this
 * process must end now (a bad name, or the profile or its identity is open
 * in another process, which was asked to come to the front).
 */
export const startProfile = (): ProfileStart => {
  const root = app.getPath('userData');
  let choice: LaunchChoice;
  try {
    const layout = ensureLayout(root);
    if (layout.kind === 'migrated') console.log(`PROFILE_MIGRATED ${layout.entries.length} entries to profiles/default`);
    const file = readProfiles(root);
    if (!file) throw new Error('profiles.json is missing after the layout step.');
    choice = resolveLaunch(process.argv, process.env, file);
    if (choice.kind === 'profile') ensureProfile(root, choice.name);
  } catch (error) {
    choice = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (choice.kind === 'error') {
    console.error(`PROFILE_FAIL ${choice.message}`);
    return { kind: 'exit', code: 2 };
  }
  const name = choice.kind === 'profile' ? choice.name : null;
  app.setPath('userData', name ? profileDir(root, name) : join(root, PICKER_DIR));
  session = { root, current: name };

  // The second process of one profile hands over to the first (its `second-instance`
  // brings the window to the front) and ends: the same profile never runs twice.
  if (!app.requestSingleInstanceLock({ profile: name ?? PICKER_DIR })) {
    console.log(`PROFILE_ALREADY_OPEN ${name ?? 'picker'}`);
    return { kind: 'exit', code: 0 };
  }
  if (!name) return { kind: 'picker' };

  const file = readProfiles(root);
  const accountHex = identityDisplay(profileDir(root, name)).accountHex;
  const elsewhere = file && accountHex ? identityOpenElsewhere(root, file, name, accountHex) : null;
  if (elsewhere) {
    console.log(`IDENTITY_ALREADY_OPEN in profile ${elsewhere}`);
    openInNewWindow(elsewhere);
    return { kind: 'exit', code: 0 };
  }
  markRunning(root, name, { pid: process.pid, accountHex, startedAt: Date.now() });
  // `app.exit` (smoke, relaunch) skips will-quit; the process's own exit still runs.
  app.on('will-quit', () => clearRunning(root, name, process.pid));
  process.on('exit', () => clearRunning(root, name, process.pid));
  try {
    refreshDisplay(root, name);
  } catch (error) {
    console.warn('[profiles] could not refresh the display data', error);
  }
  return { kind: 'profile', name };
};

/**
 * After sign-up or a reset: the picker's username and network, and the
 * running mark's account (the same-identity check reads it).
 */
export const profileIdentityChanged = (): void => {
  if (!session?.current) return;
  const { root, current } = session;
  try {
    refreshDisplay(root, current);
    markRunning(root, current, { pid: process.pid, accountHex: identityDisplay(profileDir(root, current)).accountHex, startedAt: Date.now() });
  } catch (error) {
    console.warn('[profiles] could not refresh the display data', error);
  }
};

/** The name a notification names when several profiles exist; null with one. */
export const notifyProfileName = (): string | null => {
  if (!session?.current) return null;
  try {
    const file = readProfiles(session.root);
    if (!file || file.profiles.length < 2) return null;
    const entry = file.profiles.find(item => item.name === session?.current);
    return entry?.username ?? entry?.label ?? entry?.name ?? null;
  } catch {
    return null;
  }
};

const state = (): ProfilesState => {
  if (!session) throw new Error('No profile session.');
  const { root, current } = session;
  const file = readProfiles(root);
  if (!file) throw new Error('There is no profiles.json.');
  return { current, profiles: profileRows(file, name => readRunning(root, name, pidAlive) !== null, current), defaultProfile: file.defaultProfile };
};

/** The command line of a new process: the app path in a dev run, then our flags. */
const baseArgs = (): string[] => (app.isPackaged || !process.argv[1] ? [] : [process.argv[1]]);

const openInNewWindow = (name: string): void => {
  const env = { ...process.env };
  delete env.PCD_PROFILE;
  spawn(process.execPath, [...baseArgs(), '--profile', name], { cwd: process.cwd(), env, detached: true, stdio: 'ignore' }).unref();
};

/** This window becomes `name`: the app restarts with `--profile` (the debugging port and other flags stay). */
const relaunchInto = (name: string): void => {
  const argv = process.argv.slice(1);
  const kept = argv.filter((arg, index) => arg !== '--picker' && arg !== '--profile' && !arg.startsWith('--profile=') && argv[index - 1] !== '--profile');
  app.relaunch({ args: [...kept, '--profile', name] });
  app.exit(0);
};

const known = (value: unknown): string => {
  if (!session || !isProfileName(value)) throw new Error('Not a profile name.');
  const file = readProfiles(session.root);
  if (!file?.profiles.some(entry => entry.name === value)) throw new Error('There is no such profile.');
  return value;
};

export const registerProfilesIpc = (getWindow: () => BrowserWindow | null): void => {
  // A second launch of this profile (or of the picker) brings this window to the front.
  app.on('second-instance', () => {
    const win = getWindow();
    if (!win || win.isDestroyed() || process.env.PCD_HEADLESS === '1') return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  ipcMain.handle(IPC.profilesState, (): ProfilesState => state());
  ipcMain.handle(IPC.profilesOpen, (_event, value: unknown): void => {
    const name = known(value);
    if (name === session?.current) return;
    // Open elsewhere already: bring that window to the front, keep this one.
    if (session && readRunning(session.root, name)) return openInNewWindow(name);
    relaunchInto(name);
  });
  ipcMain.handle(IPC.profilesOpenInNewWindow, (_event, value: unknown): void => {
    const name = known(value);
    if (name === session?.current) {
      getWindow()?.focus();
      return;
    }
    openInNewWindow(name);
  });
  ipcMain.handle(IPC.profilesAdd, (): void => {
    if (!session) throw new Error('No profile session.');
    const file = readProfiles(session.root);
    if (!file) throw new Error('There is no profiles.json.');
    const name = nextProfileName(file);
    ensureProfile(session.root, name);
    relaunchInto(name);
  });
  ipcMain.handle(IPC.profilesRename, (_event, value: unknown, label: unknown): ProfilesState => {
    if (typeof label !== 'string') throw new Error('The name must be text.');
    renameProfile(session?.root ?? '', known(value), label);
    return state();
  });
  ipcMain.handle(IPC.profilesRemove, (_event, value: unknown): ProfilesState => {
    const name = known(value);
    if (name === session?.current) throw new Error('This profile is open in this window.');
    removeProfile(session?.root ?? '', name);
    return state();
  });
  ipcMain.handle(IPC.profilesSetDefault, (_event, value: unknown): ProfilesState => {
    setDefaultProfile(session?.root ?? '', value === null ? null : known(value));
    return state();
  });
  ipcMain.handle(IPC.profilesOpenPicker, (): void => {
    const env = { ...process.env };
    delete env.PCD_PROFILE;
    spawn(process.execPath, [...baseArgs(), '--picker'], { cwd: process.cwd(), env, detached: true, stdio: 'ignore' }).unref();
  });
};
