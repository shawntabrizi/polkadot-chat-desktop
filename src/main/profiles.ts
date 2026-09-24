/**
 * M18 profiles: several identities on one Mac. A profile is a self-contained
 * data directory `<root>/profiles/<name>/` (the encrypted mnemonic, the
 * Chromium profile with the IndexedDB database, settings, the published
 * agent's state). `<root>/profiles.json` lists the profiles, their display
 * data and the one to open at launch. `<root>` is Electron's userData folder
 * (or `PCD_USER_DATA_DIR`); main points userData at the chosen profile's
 * directory before `ready`, so every `app.getPath('userData')` in the app is
 * per profile without further change (Element Desktop's `--profile` works the
 * same way: one userData folder per profile).
 *
 * Plain Node (no Electron import), so the layout and the launch rules run
 * in a spec against temp folders.
 */

import { type Dirent, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type NetworkProfileId, isNetworkProfileId } from '../shared/network';
import type { ProfileRow } from '../shared/desktop-api';

export type ProfileEntry = {
  /** The directory name under `profiles/`; never changes. */
  name: string;
  /** A rename sets this (display only). */
  label: string | null;
  /** From the profile's identity file, for the picker; null before sign-up. */
  username: string | null;
  network: NetworkProfileId | null;
  accountHex: string | null;
  createdAt: number;
};

export type ProfilesFile = {
  version: 1;
  profiles: ProfileEntry[];
  /** The profile a launch without `--profile` opens when several exist; null shows the picker. */
  defaultProfile: string | null;
};

export const PROFILES_FILE = 'profiles.json';
export const PROFILES_DIR = 'profiles';
/** The picker's own Chromium folder: it holds no identity and no chats. */
export const PICKER_DIR = '.picker';
const LOCK_DIR = '.profiles.lock';
const TRASH = '.trash-';
export const DEFAULT_PROFILE = 'default';
/** Written by a running profile's process; removed when it quits. */
const RUNNING_FILE = 'running.json';

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const isProfileName = (value: unknown): value is string => typeof value === 'string' && NAME.test(value);
export const MAX_LABEL = 40;

export const profileDir = (root: string, name: string): string => join(root, PROFILES_DIR, name);

// ── profiles.json ────────────────────────────────────────────────────────

const parseEntry = (value: unknown): ProfileEntry | null => {
  const raw = value as Partial<ProfileEntry> | null;
  if (!raw || !isProfileName(raw.name)) return null;
  return {
    name: raw.name,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, MAX_LABEL) : null,
    username: typeof raw.username === 'string' ? raw.username : null,
    network: isNetworkProfileId(raw.network) ? raw.network : null,
    accountHex: typeof raw.accountHex === 'string' ? raw.accountHex : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  };
};

export const readProfiles = (root: string): ProfilesFile | null => {
  const path = join(root, PROFILES_FILE);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProfilesFile> | null;
  if (raw?.version !== 1 || !Array.isArray(raw.profiles)) throw new Error('profiles.json is not a version 1 profiles file');
  const profiles = raw.profiles.map(parseEntry).filter((entry): entry is ProfileEntry => entry !== null);
  return {
    version: 1,
    profiles,
    defaultProfile: profiles.some(entry => entry.name === raw.defaultProfile) ? (raw.defaultProfile as string) : null,
  };
};

/** Write then rename: a half-written list must never replace the only record of the profiles. */
export const writeProfiles = (root: string, file: ProfilesFile): void => {
  const path = join(root, PROFILES_FILE);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
};

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/**
 * profiles.json is shared by every running profile's process (display data,
 * rename, remove). A directory made with mkdir is the lock: mkdir either
 * makes it or fails, atomically. A lock older than 30 s is from a process
 * that died holding it.
 */
export const withProfilesLock = <T>(root: string, fn: () => T): T => {
  mkdirSync(root, { recursive: true });
  const lock = join(root, LOCK_DIR);
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        /* removed by its owner meanwhile */
      }
      if (Date.now() > until) throw new Error('profiles.json is locked by another process', { cause: error });
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
};

/** Reads, changes and writes profiles.json under the lock. */
export const updateProfiles = (root: string, change: (file: ProfilesFile) => ProfilesFile): ProfilesFile =>
  withProfilesLock(root, () => {
    const current = readProfiles(root);
    if (!current) throw new Error('There is no profiles.json.');
    const next = change(current);
    writeProfiles(root, next);
    return next;
  });

// ── Layout ───────────────────────────────────────────────────────────────

export type LayoutResult = { kind: 'ready' } | { kind: 'created' } | { kind: 'recovered'; profiles: string[] };

const newEntry = (name: string, now: number): ProfileEntry => ({ name, label: null, username: null, network: null, accountHex: null, createdAt: now });

/**
 * Brings `<root>` to the profiles layout; safe to run on every start and
 * from two processes at once (it runs under the profiles lock).
 *
 * - profiles.json exists: the layout is in place.
 * - No profiles.json: a fresh install, one empty profile `default` (sign-up
 *   follows). Files in the root are not read or moved: M19 removed the
 *   one-time move of the pre-M18 layout (the owner's data is moved).
 * - No profiles.json but profile folders exist (the list was lost): list
 *   those folders again rather than start over, so no key is orphaned.
 */
export const ensureLayout = (root: string, now: number = Date.now()): LayoutResult =>
  withProfilesLock(root, () => {
    const profilesDir = join(root, PROFILES_DIR);
    if (readProfiles(root)) {
      sweepTrash(root);
      return { kind: 'ready' };
    }
    mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
    const found = readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry: Dirent) => entry.isDirectory() && isProfileName(entry.name))
      .map(entry => entry.name)
      .sort();
    if (found.length > 0) {
      writeProfiles(root, {
        version: 1,
        profiles: found.map(name => ({ ...newEntry(name, now), ...identityDisplay(profileDir(root, name)) })),
        defaultProfile: null,
      });
      return { kind: 'recovered', profiles: found };
    }
    mkdirSync(profileDir(root, DEFAULT_PROFILE), { mode: 0o700 });
    writeProfiles(root, { version: 1, profiles: [newEntry(DEFAULT_PROFILE, now)], defaultProfile: null });
    return { kind: 'created' };
  });

/**
 * The public fields of a profile's identity file (no decryption: the
 * mnemonic stays sealed; username, account and network are stored in the clear).
 */
export const identityDisplay = (dir: string): Pick<ProfileEntry, 'username' | 'network' | 'accountHex'> => {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8')) as { username?: unknown; profile?: unknown; accountHex?: unknown };
    return {
      username: typeof raw.username === 'string' ? raw.username : null,
      network: isNetworkProfileId(raw.profile) ? raw.profile : null,
      accountHex: typeof raw.accountHex === 'string' ? raw.accountHex : null,
    };
  } catch {
    return { username: null, network: null, accountHex: null };
  }
};

// ── Which profile a launch opens ─────────────────────────────────────────

export type LaunchChoice = { kind: 'profile'; name: string } | { kind: 'picker' } | { kind: 'error'; message: string };

/** `--profile <name>` or `--profile=<name>`. */
export const profileFlag = (argv: readonly string[]): string | null => {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--profile') return argv[i + 1] ?? '';
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length);
  }
  return null;
};

/**
 * The flag wins over `PCD_PROFILE` (the command line is the more explicit
 * of the two; the environment may be inherited from a parent process). With
 * neither: the only profile, else the default, else the picker. `--picker`
 * asks for the picker ("Open another profile"). An unknown valid name is
 * created, as Element's `--profile` does.
 */
export const resolveLaunch = (argv: readonly string[], env: NodeJS.ProcessEnv, file: ProfilesFile): LaunchChoice => {
  const flag = profileFlag(argv);
  const envName = env.PCD_PROFILE ? env.PCD_PROFILE : null;
  const asked = flag ?? envName;
  if (asked !== null) {
    if (!isProfileName(asked)) return { kind: 'error', message: `"${asked}" is not a profile name (1 to 32 of a-z, 0-9 and -, not starting with -).` };
    return { kind: 'profile', name: asked };
  }
  if (argv.includes('--picker')) return { kind: 'picker' };
  const [only] = file.profiles;
  if (file.profiles.length === 1 && only) return { kind: 'profile', name: only.name };
  if (file.profiles.length === 0) return { kind: 'profile', name: DEFAULT_PROFILE };
  if (file.defaultProfile) return { kind: 'profile', name: file.defaultProfile };
  return { kind: 'picker' };
};

/** Adds `name` (a folder and an entry) when it is new. */
export const ensureProfile = (root: string, name: string, now: number = Date.now()): void => {
  if (!isProfileName(name)) throw new Error('Not a profile name.');
  updateProfiles(root, file => {
    mkdirSync(profileDir(root, name), { recursive: true, mode: 0o700 });
    return file.profiles.some(entry => entry.name === name) ? file : { ...file, profiles: [...file.profiles, newEntry(name, now)] };
  });
};

/** `profile-2`, `profile-3`, … : the first name no profile has. */
export const nextProfileName = (file: ProfilesFile): string => {
  const taken = new Set(file.profiles.map(entry => entry.name));
  for (let n = 2; ; n++) if (!taken.has(`profile-${n}`)) return `profile-${n}`;
};

/**
 * M19 "Add profile from a recovery phrase": a new profile folder whose
 * identity file `write` puts in place (sealed; see identity/store.ts). One
 * identity lives in one profile, so a phrase some profile already holds is
 * refused with that profile's name. A failed write leaves no folder behind.
 */
export const addRestoredProfile = (root: string, accountHex: string, write: (dir: string) => void, now: number = Date.now()): string =>
  withProfilesLock(root, () => {
    const file = readProfiles(root);
    if (!file) throw new Error('There is no profiles.json.');
    const holder = file.profiles.find(entry => (entry.accountHex ?? identityDisplay(profileDir(root, entry.name)).accountHex)?.toLowerCase() === accountHex.toLowerCase());
    if (holder) throw new Error(`This identity is already in the profile ${holder.label ?? holder.username ?? holder.name}.`);
    // A folder with no entry may hold keys of its own; never write into it.
    const taken = [...file.profiles];
    let name = nextProfileName(file);
    while (existsSync(profileDir(root, name))) {
      taken.push(newEntry(name, now));
      name = nextProfileName({ ...file, profiles: taken });
    }
    const dir = profileDir(root, name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      write(dir);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    writeProfiles(root, { ...file, profiles: [...file.profiles, { ...newEntry(name, now), ...identityDisplay(dir) }] });
    return name;
  });

// ── Running marks ────────────────────────────────────────────────────────

export type RunningMark = { pid: number; accountHex: string | null; startedAt: number };
export type IsAlive = (pid: number) => boolean;

/** A pid that answers signal 0 is a live process (EPERM: alive, not ours to signal). */
export const pidAlive: IsAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const readRunning = (root: string, name: string, isAlive: IsAlive = pidAlive): RunningMark | null => {
  try {
    const raw = JSON.parse(readFileSync(join(profileDir(root, name), RUNNING_FILE), 'utf8')) as Partial<RunningMark>;
    if (typeof raw.pid !== 'number' || !isAlive(raw.pid)) return null;
    return { pid: raw.pid, accountHex: typeof raw.accountHex === 'string' ? raw.accountHex : null, startedAt: Number(raw.startedAt) || 0 };
  } catch {
    return null;
  }
};

export const markRunning = (root: string, name: string, mark: RunningMark): void => {
  const path = join(profileDir(root, name), RUNNING_FILE);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(mark)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
};

/** Removes the mark only if it is this process's (a later process may have taken the profile). */
export const clearRunning = (root: string, name: string, pid: number): void => {
  const path = join(profileDir(root, name), RUNNING_FILE);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunningMark>;
    if (raw.pid === pid) rmSync(path, { force: true });
  } catch {
    /* no mark */
  }
};

/**
 * The same identity must never run twice (two processes with one key would
 * race each other's statements and sessions). Returns the other running
 * profile that holds `accountHex`, if any.
 */
export const identityOpenElsewhere = (root: string, file: ProfilesFile, self: string, accountHex: string, isAlive: IsAlive = pidAlive): string | null => {
  for (const entry of file.profiles) {
    if (entry.name === self) continue;
    const mark = readRunning(root, entry.name, isAlive);
    const account = mark?.accountHex ?? null;
    if (mark && account && account.toLowerCase() === accountHex.toLowerCase()) return entry.name;
  }
  return null;
};

/** The picker's and Settings' rows: a running mark per profile, the current one first. */
export const profileRows = (file: ProfilesFile, running: (name: string) => boolean, current: string | null): ProfileRow[] =>
  [...file.profiles]
    .sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : a.createdAt - b.createdAt))
    .map(entry => ({
      name: entry.name,
      label: entry.label ?? entry.username ?? (entry.name === DEFAULT_PROFILE ? 'Default profile' : `New profile (${entry.name})`),
      username: entry.username,
      network: entry.network,
      running: entry.name === current || running(entry.name),
      current: entry.name === current,
      isDefault: file.defaultProfile === entry.name,
    }));

// ── Changes ──────────────────────────────────────────────────────────────

export const renameProfile = (root: string, name: string, label: string): ProfilesFile =>
  updateProfiles(root, file => {
    if (!file.profiles.some(entry => entry.name === name)) throw new Error('There is no such profile.');
    const clean = label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
    return { ...file, profiles: file.profiles.map(entry => (entry.name === name ? { ...entry, label: clean || null } : entry)) };
  });

export const setDefaultProfile = (root: string, name: string | null): ProfilesFile =>
  updateProfiles(root, file => {
    if (name !== null && !file.profiles.some(entry => entry.name === name)) throw new Error('There is no such profile.');
    return { ...file, defaultProfile: name };
  });

/** Stores the display data of `name` from its identity file (after sign-up, a reset, or at start). */
export const refreshDisplay = (root: string, name: string): ProfilesFile =>
  updateProfiles(root, file => {
    const display = identityDisplay(profileDir(root, name));
    const entry = file.profiles.find(item => item.name === name);
    if (!entry || (entry.username === display.username && entry.network === display.network && entry.accountHex === display.accountHex)) return file;
    return { ...file, profiles: file.profiles.map(item => (item.name === name ? { ...item, ...display } : item)) };
  });

/**
 * Deletes a profile's directory (its keys and chats). A running profile is
 * refused: its process has the files open. The folder is first renamed
 * aside (atomic), the entry removed, then the folder deleted; a crash in
 * between leaves a `.trash-*` folder that the next start deletes.
 */
export const removeProfile = (root: string, name: string, isAlive: IsAlive = pidAlive): ProfilesFile =>
  updateProfiles(root, file => {
    if (!file.profiles.some(entry => entry.name === name)) throw new Error('There is no such profile.');
    if (readRunning(root, name, isAlive)) throw new Error('This profile is open in a window. Close it first.');
    if (file.profiles.length === 1) throw new Error('The last profile cannot be removed.');
    const dir = profileDir(root, name);
    const trash = join(root, PROFILES_DIR, `${TRASH}${name}-${Date.now()}`);
    if (existsSync(dir)) renameSync(dir, trash);
    const next = { ...file, profiles: file.profiles.filter(entry => entry.name !== name), defaultProfile: file.defaultProfile === name ? null : file.defaultProfile };
    writeProfiles(root, next);
    rmSync(trash, { recursive: true, force: true });
    return next;
  });

const sweepTrash = (root: string): void => {
  const dir = join(root, PROFILES_DIR);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) if (entry.startsWith(TRASH)) rmSync(join(dir, entry), { recursive: true, force: true });
};
