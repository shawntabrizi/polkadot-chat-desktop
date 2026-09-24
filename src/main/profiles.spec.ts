/**
 * M18 profiles. The migration moves the only copy of a person's keys and
 * chats, so it must lose nothing, run safely on every start, and survive a
 * crash at any step. The launch rules decide which identity a window opens;
 * the running marks keep one identity from running in two processes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ProfilesFile,
  DEFAULT_PROFILE,
  ensureLayout,
  ensureProfile,
  identityOpenElsewhere,
  markRunning,
  nextProfileName,
  profileDir,
  profileRows,
  readProfiles,
  readRunning,
  removeProfile,
  renameProfile,
  resolveLaunch,
  setDefaultProfile,
  writeProfiles,
} from './profiles';

const temp = mkdtempSync(join(tmpdir(), 'pcd-profiles-spec-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let root = '';
let counter = 0;
beforeEach(() => {
  root = join(temp, `root-${++counter}`);
  mkdirSync(root);
});

const IDENTITY = { version: 1, username: 'alice.42', accountHex: `0x${'aa'.repeat(32)}`, profile: 'devnet', mnemonicEncrypted: 'c2VhbGVk' };

/** The old (pre-M18) layout: everything straight in userData, Chromium's folders included. */
const writeOldLayout = (): Record<string, string> => {
  const files: Record<string, string> = {
    'identity.json': JSON.stringify(IDENTITY),
    'storage-key.json': '{"version":1,"keyEncrypted":"eA=="}',
    'window.json': '{"width":900,"height":700}',
    'agent/settings.json': '{"version":1,"enabled":true}',
    'agent/bot-core/journal.jsonl': 'line\n'.repeat(1000),
    'IndexedDB/file__0.indexeddb.leveldb/000003.log': 'x'.repeat(70_000),
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  // Chromium's lock link of the old process: never copied.
  symlinkSync('host-12345', join(root, 'SingletonLock'));
  return files;
};

const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(at, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) out[`${prefix}${entry.name}`] = readFileSync(join(at, entry.name), 'utf8');
    }
  };
  walk(dir, '');
  return out;
};

const file = (profiles: string[], extra: Partial<ProfilesFile> = {}): ProfilesFile => ({
  version: 1,
  profiles: profiles.map((name, index) => ({ name, label: null, username: null, network: null, accountHex: null, createdAt: index })),
  defaultProfile: null,
  migration: null,
  ...extra,
});

describe('migration of the old single profile', () => {
  it('moves every file byte for byte to profiles/default and records it', () => {
    const files = writeOldLayout();
    const result = ensureLayout(root, 1000);
    expect(result).toEqual({ kind: 'migrated', entries: expect.arrayContaining(['identity.json', 'IndexedDB', 'agent', 'SingletonLock']) });
    expect(tree(profileDir(root, DEFAULT_PROFILE))).toEqual(files);
    expect(existsSync(join(profileDir(root, DEFAULT_PROFILE), 'SingletonLock'))).toBe(false);
    // Nothing of the old profile is left in the root, so no later start can read stale keys from there.
    expect(readdirSync(root).sort()).toEqual(['profiles', 'profiles.json']);
    const saved = readProfiles(root);
    expect(saved?.migration).toMatchObject({ at: 1000, cleaned: true });
    // The picker can show who the profile is without decrypting anything.
    expect(saved?.profiles).toEqual([{ name: 'default', label: null, username: 'alice.42', network: 'devnet', accountHex: IDENTITY.accountHex, createdAt: 1000 }]);
  });

  it('is idempotent: a second run changes nothing', () => {
    const files = writeOldLayout();
    ensureLayout(root, 1000);
    const before = readFileSync(join(root, 'profiles.json'), 'utf8');
    expect(ensureLayout(root, 2000)).toEqual({ kind: 'ready' });
    expect(readFileSync(join(root, 'profiles.json'), 'utf8')).toBe(before);
    expect(tree(profileDir(root, DEFAULT_PROFILE))).toEqual(files);
    expect(readdirSync(join(root, 'profiles'))).toEqual(['default']);
  });

  it('does not move a file that shows up in the root after the migration', () => {
    writeOldLayout();
    ensureLayout(root);
    // An old test helper writing identity.json into the root must not replace the profile's keys.
    writeFileSync(join(root, 'identity.json'), '{"other":true}');
    ensureLayout(root);
    expect(JSON.parse(readFileSync(join(profileDir(root, DEFAULT_PROFILE), 'identity.json'), 'utf8'))).toEqual(IDENTITY);
  });

  it('starts over from the root after a crash before the commit', () => {
    const files = writeOldLayout();
    // A crash left a half copy and a renamed copy, but no profiles.json: the root is still the truth.
    mkdirSync(join(root, 'profiles', '.migrating'), { recursive: true });
    writeFileSync(join(root, 'profiles', '.migrating', 'identity.json'), 'half');
    mkdirSync(profileDir(root, DEFAULT_PROFILE));
    writeFileSync(join(profileDir(root, DEFAULT_PROFILE), 'identity.json'), 'stale');
    expect(ensureLayout(root).kind).toBe('migrated');
    expect(tree(profileDir(root, DEFAULT_PROFILE))).toEqual(files);
    expect(existsSync(join(root, 'profiles', '.migrating'))).toBe(false);
  });

  it('finishes the removal of the old files after a crash past the commit', () => {
    const files = writeOldLayout();
    ensureLayout(root, 1000);
    // As if the process died right after writing profiles.json: the old files are still there.
    writeFileSync(join(root, 'identity.json'), files['identity.json'] ?? '');
    const saved = readProfiles(root);
    if (!saved?.migration) throw new Error('no migration record');
    writeProfiles(root, { ...saved, migration: { ...saved.migration, cleaned: false } });
    expect(ensureLayout(root).kind).toBe('ready');
    expect(existsSync(join(root, 'identity.json'))).toBe(false);
    expect(readProfiles(root)?.migration?.cleaned).toBe(true);
    expect(tree(profileDir(root, DEFAULT_PROFILE))).toEqual(files);
  });

  it('gives an empty root one empty default profile (sign-up follows)', () => {
    expect(ensureLayout(root).kind).toBe('created');
    expect(readProfiles(root)?.profiles.map(entry => entry.name)).toEqual(['default']);
    expect(readdirSync(profileDir(root, DEFAULT_PROFILE))).toEqual([]);
  });

  it('lists the profile folders again when profiles.json was lost, instead of starting over', () => {
    mkdirSync(profileDir(root, 'work'), { recursive: true });
    writeFileSync(join(profileDir(root, 'work'), 'identity.json'), JSON.stringify(IDENTITY));
    expect(ensureLayout(root)).toEqual({ kind: 'recovered', profiles: ['work'] });
    expect(readProfiles(root)?.profiles[0]).toMatchObject({ name: 'work', username: 'alice.42' });
  });
});

describe('which profile a launch opens', () => {
  const two = file(['default', 'work']);

  it('the flag wins over PCD_PROFILE, which wins over the default', () => {
    const withDefault = { ...two, defaultProfile: 'default' };
    expect(resolveLaunch(['app', '--profile', 'work'], { PCD_PROFILE: 'default' }, withDefault)).toEqual({ kind: 'profile', name: 'work' });
    expect(resolveLaunch(['app', '--profile=work'], {}, withDefault)).toEqual({ kind: 'profile', name: 'work' });
    expect(resolveLaunch(['app'], { PCD_PROFILE: 'work' }, withDefault)).toEqual({ kind: 'profile', name: 'work' });
    expect(resolveLaunch(['app'], {}, withDefault)).toEqual({ kind: 'profile', name: 'default' });
  });

  it('opens the only profile without asking (headless tests keep one implicit profile)', () => {
    expect(resolveLaunch(['app'], {}, file(['default']))).toEqual({ kind: 'profile', name: 'default' });
  });

  it('shows the picker with several profiles and no default, or when asked', () => {
    expect(resolveLaunch(['app'], {}, two)).toEqual({ kind: 'picker' });
    expect(resolveLaunch(['app', '--picker'], {}, { ...two, defaultProfile: 'work' })).toEqual({ kind: 'picker' });
  });

  it('refuses a name that could leave the profiles folder', () => {
    for (const bad of ['../x', '', 'Work', '-x', 'a/b', '.picker']) {
      expect(resolveLaunch(['app', '--profile', bad], {}, two).kind).toBe('error');
    }
  });

  it('creates a new profile for an unknown name, once', () => {
    ensureLayout(root);
    ensureProfile(root, 'work');
    ensureProfile(root, 'work');
    expect(readProfiles(root)?.profiles.map(entry => entry.name)).toEqual(['default', 'work']);
    expect(nextProfileName(readProfiles(root) as ProfilesFile)).toBe('profile-2');
  });
});

describe('running marks and the same identity', () => {
  const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

  it('a mark of a dead process is not running', () => {
    ensureLayout(root);
    markRunning(root, 'default', { pid: 111, accountHex: null, startedAt: 1 });
    expect(readRunning(root, 'default', alive([111]))).not.toBeNull();
    expect(readRunning(root, 'default', alive([]))).toBeNull();
  });

  it('finds the other running profile that holds the same account', () => {
    ensureLayout(root);
    ensureProfile(root, 'copy');
    const account = `0x${'bb'.repeat(32)}`;
    markRunning(root, 'default', { pid: 111, accountHex: account, startedAt: 1 });
    const saved = readProfiles(root) as ProfilesFile;
    expect(identityOpenElsewhere(root, saved, 'copy', account.toUpperCase().replace('0X', '0x'), alive([111]))).toBe('default');
    // The same check for the profile itself, or once the other process ended, finds nothing.
    expect(identityOpenElsewhere(root, saved, 'default', account, alive([111]))).toBeNull();
    expect(identityOpenElsewhere(root, saved, 'copy', account, alive([]))).toBeNull();
  });

  it('marks running profiles in the picker, this window first', () => {
    const saved = { ...file(['default', 'work', 'test']), defaultProfile: 'work' };
    const rows = profileRows(saved, name => name === 'test', 'work');
    expect(rows.map(row => [row.name, row.running, row.current, row.isDefault])).toEqual([
      ['work', true, true, true],
      ['default', false, false, false],
      ['test', true, false, false],
    ]);
    // Before sign-up a profile has no username: the row says it is new.
    expect(rows[2]?.label).toBe('New profile (test)');
  });
});

describe('settings changes', () => {
  it('rename is display only; the folder keeps its name', () => {
    ensureLayout(root);
    renameProfile(root, 'default', '  Work   me ');
    expect(readProfiles(root)?.profiles[0]).toMatchObject({ name: 'default', label: 'Work me' });
    expect(existsSync(profileDir(root, 'default'))).toBe(true);
  });

  it('remove refuses a running profile and the last one, and deletes the folder otherwise', () => {
    ensureLayout(root);
    ensureProfile(root, 'work');
    writeFileSync(join(profileDir(root, 'work'), 'identity.json'), '{}');
    setDefaultProfile(root, 'work');
    markRunning(root, 'work', { pid: 222, accountHex: null, startedAt: 1 });
    expect(() => removeProfile(root, 'work', pid => pid === 222)).toThrow(/open in a window/);
    removeProfile(root, 'work', () => false);
    expect(existsSync(profileDir(root, 'work'))).toBe(false);
    expect(readdirSync(join(root, 'profiles'))).toEqual(['default']);
    // The default went with it: the next launch must not look for a missing profile.
    expect(readProfiles(root)).toMatchObject({ defaultProfile: null, profiles: [{ name: 'default' }] });
    expect(() => removeProfile(root, 'default', () => false)).toThrow(/last profile/);
  });
});

describe('the agent state per profile', () => {
  it("puts bot-core's state inside the profile's own folder", async () => {
    let userData = '';
    vi.doMock('electron', () => ({ app: { getPath: () => userData }, utilityProcess: {}, safeStorage: {} }));
    const { agentStateDir } = await import('./agent/service');
    ensureLayout(root);
    ensureProfile(root, 'work');
    userData = profileDir(root, 'default');
    const a = agentStateDir();
    userData = profileDir(root, 'work');
    const b = agentStateDir();
    // Two agents sharing one journal would acknowledge each other's statements.
    expect(a.startsWith(profileDir(root, 'default'))).toBe(true);
    expect(b.startsWith(profileDir(root, 'work'))).toBe(true);
    expect(a).not.toBe(b);
    vi.doUnmock('electron');
  });
});
