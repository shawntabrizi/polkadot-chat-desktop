/**
 * Why: macOS gives an invite link to one process of the app, not to a chosen
 * profile. With several profiles the wrong identity could join a group. The
 * app must ask first, and the chosen profile must get the link exactly once.
 */

import { describe, expect, it } from 'vitest';

import { inviteChoices, inviteRouteOf, openLinkFlag, withoutOpenLink } from './inviteRoute';
import type { ProfilesFile } from './profiles';

const LINK = 'polkadot-chat://g#AbC_12-x';

const file = (names: { name: string; username?: string; label?: string }[]): ProfilesFile => ({
  version: 1,
  defaultProfile: null,
  profiles: names.map(entry => ({ name: entry.name, label: entry.label ?? null, username: entry.username ?? null, network: null, accountHex: null, createdAt: 0 })),
});

describe('invite link profile question', () => {
  it('asks nothing with one profile or none', () => {
    expect(inviteChoices(null, 'default')).toBeNull();
    expect(inviteChoices(file([{ name: 'default', username: 'shawn.01' }]), 'default')).toBeNull();
  });

  it('lists every profile by username, rename or folder name, this window first', () => {
    const choices = inviteChoices(file([{ name: 'default', username: 'shawn.01' }, { name: 'work', label: 'Work' }, { name: 'profile-3' }]), 'work');
    expect(choices).toEqual([
      { name: 'work', label: 'Work (this window)' },
      { name: 'default', label: 'shawn.01' },
      { name: 'profile-3', label: 'profile-3' },
    ]);
  });

  it('the picker process (no profile) has no "this window" entry', () => {
    expect(inviteChoices(file([{ name: 'a' }, { name: 'b' }]), null)?.map(c => c.label)).toEqual(['a', 'b']);
  });

  it('routes the answer: this window, another profile, or Cancel (nothing happens)', () => {
    const choices = inviteChoices(file([{ name: 'a' }, { name: 'b' }]), 'a')!;
    expect(inviteRouteOf(choices, 0, 'a')).toEqual({ kind: 'here' });
    expect(inviteRouteOf(choices, 1, 'a')).toEqual({ kind: 'profile', name: 'b' });
    expect(inviteRouteOf(choices, 2, 'a')).toEqual({ kind: 'cancel' });
  });

  it('reads --open-link only when it holds a group invite link', () => {
    expect(openLinkFlag(['app', '--profile', 'b', '--open-link', LINK])).toBe(LINK);
    expect(openLinkFlag(['app', `--open-link=${LINK}`])).toBe(LINK);
    expect(openLinkFlag(['app', '--open-link', 'https://example.com'])).toBeNull();
    expect(openLinkFlag(['app', '--profile', 'b'])).toBeNull();
  });

  it('a relaunch drops the link, so it does not open twice', () => {
    expect(withoutOpenLink(['main.js', '--open-link', LINK, '--remote-debugging-port=9222', `--open-link=${LINK}`])).toEqual(['main.js', '--remote-debugging-port=9222']);
  });
});
