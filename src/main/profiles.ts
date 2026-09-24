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
 * Plain Node (no Electron import), so the migration and the launch rules run
 * in a spec against temp folders.
 */

import { createHash } from 'node:crypto';
import {
  type Dirent,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  /** Set once the old single-profile layout moved to `profiles/default/`. */
  migration: { at: number; entries: string[]; cleaned: boolean } | null;
};

export const PROFILES_FILE = 'profiles.json';
export const PROFILES_DIR = 'profiles';
/** The picker's own Chromium folder: it holds no identity and no chats. */
export const PICKER_DIR = '.picker';
const LOCK_DIR = '.profiles.lock';
const STAGING = '.migrating';
const TRASH = '.trash-';
export const DEFAULT_PROFILE = 'default';
/** Written by a running profile's process; removed when it quits. */
const RUNNING_FILE = 'running.json';

/** Root entries that are the profiles layout itself, never old profile data. */
const RESERVED = new Set([PROFILES_DIR, PROFILES_FILE, PICKER_DIR, LOCK_DIR, '.DS_Store']);
/** Chromium's single-instance lock links: meaningful only to the process that made them, never copied. */
const CHROMIUM_LOCKS = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);

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
  const migration = raw.migration && Array.isArray(raw.migration.entries) ? { at: Number(raw.migration.at) || 0, entries: raw.migration.entries.filter(isRootEntry), cleaned: raw.migration.cleaned === true } : null;
  return {
    version: 1,
    profiles,
    defaultProfile: profiles.some(entry => entry.name === raw.defaultProfile) ? (raw.defaultProfile as string) : null,
    migration,
  };
};

const isRootEntry = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('/') && value !== '..' && value !== '.' && !RESERVED.has(value);

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

// ── Migration ────────────────────────────────────────────────────────────

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Throws unless `copy` holds every file, link and folder of `source` with the same bytes. */
export const verifyCopy = (source: string, copy: string): void => {
  const walk = (a: string, b: string): void => {
    const info = lstatSync(a);
    const other = lstatSync(b);
    if (info.isSymbolicLink()) {
      if (!other.isSymbolicLink() || readlinkSync(a) !== readlinkSync(b)) throw new Error(`copy differs at ${b}`);
      return;
    }
    if (info.isDirectory()) {
      if (!other.isDirectory()) throw new Error(`copy differs at ${b}`);
      for (const entry of readdirSync(a)) walk(join(a, entry), join(b, entry));
      return;
    }
    if (!other.isFile() || other.size !== info.size || sha256(a) !== sha256(b)) throw new Error(`copy differs at ${b}`);
  };
  walk(source, copy);
};

export type LayoutResult =
  | { kind: 'ready' }
  | { kind: 'created' }
  | { kind: 'migrated'; entries: string[] }
  | { kind: 'recovered'; profiles: string[] };

const newEntry = (name: string, now: number): ProfileEntry => ({ name, label: null, username: null, network: null, accountHex: null, createdAt: now });

const removeRootEntries = (root: string, entries: readonly string[]): void => {
  for (const entry of entries) rmSync(join(root, entry), { recursive: true, force: true });
};

/**
 * Brings `<root>` to the profiles layout; safe to run on every start and
 * from two processes at once (it runs under the profiles lock).
 *
 * - profiles.json exists: the layout is in place. A migration whose old files
 *   were not all removed yet (a crash after the commit) finishes the removal.
 * - Old layout (anything in the root that is not the layout itself): copy it
 *   all to `profiles/.migrating`, verify every byte, rename the copy to
 *   `profiles/default` (atomic), then write profiles.json (the commit point,
 *   with the list of moved entries), then remove the originals. A crash before
 *   the commit leaves the root as it was, and the next start begins again.
 * - An empty root: one empty profile `default` (sign-up follows).
 */
export const ensureLayout = (root: string, now: number = Date.now()): LayoutResult =>
  withProfilesLock(root, () => {
    const profilesDir = join(root, PROFILES_DIR);
    const existing = readProfiles(root);
    if (existing) {
      if (existing.migration && !existing.migration.cleaned) {
        removeRootEntries(root, existing.migration.entries);
        writeProfiles(root, { ...existing, migration: { ...existing.migration, cleaned: true } });
      }
      sweepTrash(root);
      return { kind: 'ready' };
    }

    mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
    // No profiles.json: the root is the truth, so a copy left by an interrupted migration goes.
    const staging = join(profilesDir, STAGING);
    rmSync(staging, { recursive: true, force: true });
    const legacy = readdirSync(root).filter(entry => !RESERVED.has(entry));

    if (legacy.length > 0) {
      rmSync(profileDir(root, DEFAULT_PROFILE), { recursive: true, force: true });
      mkdirSync(staging, { mode: 0o700 });
      const copied: string[] = [];
      for (const entry of legacy) {
        if (CHROMIUM_LOCKS.has(entry)) continue;
        cpSync(join(root, entry), join(staging, entry), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, errorOnExist: true, force: false });
        copied.push(entry);
      }
      for (const entry of copied) verifyCopy(join(root, entry), join(staging, entry));
      renameSync(staging, profileDir(root, DEFAULT_PROFILE));
      writeProfiles(root, {
        version: 1,
        profiles: [{ ...newEntry(DEFAULT_PROFILE, now), ...identityDisplay(profileDir(root, DEFAULT_PROFILE)) }],
        defaultProfile: null,
        migration: { at: now, entries: legacy, cleaned: false },
      });
      removeRootEntries(root, legacy);
      const written = readProfiles(root);
      if (written?.migration) writeProfiles(root, { ...written, migration: { ...written.migration, cleaned: true } });
      return { kind: 'migrated', entries: legacy };
    }

    // profiles.json was lost but profile folders exist: list them again rather than start over.
    const found = readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry: Dirent) => entry.isDirectory() && isProfileName(entry.name))
      .map(entry => entry.name)
      .sort();
    if (found.length > 0) {
      writeProfiles(root, {
        version: 1,
        profiles: found.map(name => ({ ...newEntry(name, now), ...identityDisplay(profileDir(root, name)) })),
        defaultProfile: null,
        migration: null,
      });
      return { kind: 'recovered', profiles: found };
    }
    mkdirSync(profileDir(root, DEFAULT_PROFILE), { mode: 0o700 });
    writeProfiles(root, { version: 1, profiles: [newEntry(DEFAULT_PROFILE, now)], defaultProfile: null, migration: null });
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
