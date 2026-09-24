/**
 * M18 profiles. The layout step runs on every start and must never read keys
 * from outside a profile folder. The launch rules decide which identity a
 * window opens; the running marks keep one identity from running in two
 * processes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const file = (profiles: string[], extra: Partial<ProfilesFile> = {}): ProfilesFile => ({
  version: 1,
  profiles: profiles.map((name, index) => ({ name, label: null, username: null, network: null, accountHex: null, createdAt: index })),
  defaultProfile: null,
  ...extra,
});

describe('the layout at start (M19: no migration)', () => {
  it('treats a data folder without profiles.json as a fresh install and never takes keys from the root', () => {
    // A pre-M18 identity file straight in the root: M19 removed the move, so it
    // must not become the default profile's keys (nor be deleted: it is not ours to touch).
    writeFileSync(join(root, 'identity.json'), JSON.stringify(IDENTITY));
    expect(ensureLayout(root, 1000).kind).toBe('created');
    expect(readProfiles(root)).toEqual({
      version: 1,
      defaultProfile: null,
      profiles: [{ name: 'default', label: null, username: null, network: null, accountHex: null, createdAt: 1000 }],
    });
    expect(readdirSync(profileDir(root, DEFAULT_PROFILE))).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, 'identity.json'), 'utf8'))).toEqual(IDENTITY);
  });

  it('is idempotent: a second start changes nothing', () => {
    ensureLayout(root, 1000);
    const before = readFileSync(join(root, 'profiles.json'), 'utf8');
    expect(ensureLayout(root, 2000)).toEqual({ kind: 'ready' });
    expect(readFileSync(join(root, 'profiles.json'), 'utf8')).toBe(before);
    expect(readdirSync(join(root, 'profiles'))).toEqual(['default']);
  });

  it('opens a profiles.json the M18 migration wrote (the owner\'s data) and keeps its profiles', () => {
    mkdirSync(profileDir(root, DEFAULT_PROFILE), { recursive: true });
    writeFileSync(join(profileDir(root, DEFAULT_PROFILE), 'identity.json'), JSON.stringify(IDENTITY));
    const migrated = { version: 1, profiles: [{ name: 'default', label: null, username: 'alice.42', network: 'devnet', accountHex: IDENTITY.accountHex, createdAt: 5 }], defaultProfile: null, migration: { at: 5, entries: ['identity.json'], cleaned: true } };
    writeFileSync(join(root, 'profiles.json'), JSON.stringify(migrated));
    expect(ensureLayout(root).kind).toBe('ready');
    expect(readProfiles(root)?.profiles).toEqual(migrated.profiles);
    expect(JSON.parse(readFileSync(join(profileDir(root, DEFAULT_PROFILE), 'identity.json'), 'utf8'))).toEqual(IDENTITY);
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
