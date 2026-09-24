// M19 scripts/release.sh. A release must be exactly the committed code under
// the version the app reports, so the script refuses a dirty tree and a tag
// that does not name package.json's version before it builds anything. It
// never publishes: it prints the gh command for the coordinator. Runs the
// real script in a throwaway git repo with a stand-in `npm` on PATH.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../release.sh');
let repo = '';
let bin = '';

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pcd-release-spec-'));
  bin = join(repo, '.bin');
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(bin);
  cpSync(script, join(repo, 'scripts/release.sh'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.2.0' }));
  writeFileSync(join(repo, 'CHANGELOG.md'), '# Changelog\n\n## 0.2.0-preview\n\n- One feature.\n\n## 0.1.0\n\n- Old.\n');
  // The stand-in npm records each run; `package` leaves the dmg the real build makes.
  writeFileSync(
    join(bin, 'npm'),
    `#!/bin/sh\necho "npm $*" >> "${join(repo, 'dist-npm.log')}"\nif [ "$2" = package ]; then mkdir -p dist && echo dmg > "dist/Polkadot Chat-0.2.0-arm64.dmg"; fi\n`,
  );
  chmodSync(join(bin, 'npm'), 0o755);
  writeFileSync(join(repo, '.gitignore'), 'dist/\n.bin/\ndist-npm.log\n');
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const release = tag => {
  const run = spawnSync('bash', ['scripts/release.sh', tag], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  return { code: run.status, out: `${run.stdout}${run.stderr}`, built: existsSync(join(repo, 'dist-npm.log')) };
};

describe('scripts/release.sh', () => {
  it('refuses a dirty tree before building anything', () => {
    writeFileSync(join(repo, 'CHANGELOG.md'), 'changed\n');
    const run = release('v0.2.0-preview');
    expect(run.code).toBe(1);
    expect(run.out).toContain('RELEASE_FAIL the working tree is not clean');
    expect(run.built).toBe(false);
  });

  it('refuses a tag that does not name the package version', () => {
    for (const tag of ['v0.3.0-preview', '0.2.0', 'v0.2.01', 'v0.2']) {
      const run = release(tag);
      expect(run.code, tag).toBe(1);
      expect(run.out, tag).toContain('does not match package.json version 0.2.0');
    }
    expect(existsSync(join(repo, 'dist-npm.log'))).toBe(false);
  });

  it('checks, packages and smokes, then prints the gh command without running it', () => {
    const run = release('v0.2.0-preview');
    expect(run.code, run.out).toBe(0);
    expect(readFileSync(join(repo, 'dist-npm.log'), 'utf8').trim().split('\n')).toEqual(['npm run check', 'npm run package', 'npm run smoke:packaged']);
    expect(run.out).toContain("gh release create v0.2.0-preview --prerelease --title Polkadot\\ Chat\\ v0.2.0-preview --notes-file dist/release-notes-v0.2.0-preview.md dist/Polkadot\\ Chat-0.2.0-arm64.dmg");
    // The notes are the tag's changelog section only.
    expect(readFileSync(join(repo, 'dist/release-notes-v0.2.0-preview.md'), 'utf8').trim()).toBe('- One feature.');
  });
});
