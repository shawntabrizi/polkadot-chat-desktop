/**
 * M18: a picker row must tell two profiles apart at a glance (who, which
 * network) and say when a profile is already open, since opening it again
 * only brings that window to the front.
 */

import { describe, expect, it } from 'vitest';

import type { ProfileRow } from '../../shared/desktop-api';

import { profileCaption } from './profileCaption';

const row = (change: Partial<ProfileRow>): ProfileRow => ({
  name: 'default',
  label: 'alice.42',
  username: 'alice.42',
  network: 'devnet',
  running: false,
  current: false,
  isDefault: false,
  ...change,
});

describe('profileCaption', () => {
  it('names the network, and the username only when a rename hides it', () => {
    expect(profileCaption(row({}))).toBe('Devnet');
    expect(profileCaption(row({ label: 'Work', network: 'paseo' }))).toBe('alice.42 · Paseo');
  });

  it('says where the profile is open', () => {
    expect(profileCaption(row({ running: true, current: true }))).toBe('Devnet · This window');
    expect(profileCaption(row({ running: true }))).toBe('Devnet · Open in another window');
  });

  it('marks a profile that has no identity yet', () => {
    expect(profileCaption(row({ username: null, network: null, label: 'New profile (profile-2)' }))).toBe('Not signed up yet');
  });
});
