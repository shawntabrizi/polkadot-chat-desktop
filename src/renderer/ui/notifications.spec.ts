import { describe, expect, it } from 'vitest';

import { shouldNotify } from './notifications';

const base = {
  row: { direction: 'incoming' as const, peerAccountId: '0xaa' as const, timestamp: 1_000 },
  selectedPeer: null,
  windowFocused: false,
  muted: false,
  enabled: true,
  now: 2_000,
};

describe('shouldNotify', () => {
  it('notifies for a new incoming message while the window is in the background', () => {
    expect(shouldNotify(base)).toBe(true);
  });

  // The user is looking at that room: a banner would be noise.
  it('stays quiet for the open room of the focused window, but not for other rooms', () => {
    expect(shouldNotify({ ...base, windowFocused: true, selectedPeer: '0xaa' })).toBe(false);
    expect(shouldNotify({ ...base, windowFocused: true, selectedPeer: '0xbb' })).toBe(true);
    expect(shouldNotify({ ...base, windowFocused: false, selectedPeer: '0xaa' })).toBe(true);
  });

  it('never notifies for own messages, system rows, the Assistant or the Faucet, a muted room, or with notifications off', () => {
    expect(shouldNotify({ ...base, row: { ...base.row, direction: 'outgoing' } })).toBe(false);
    expect(shouldNotify({ ...base, row: { ...base.row, direction: 'system' } })).toBe(false);
    expect(shouldNotify({ ...base, row: { ...base.row, peerAccountId: 'local:assistant' } })).toBe(false);
    // The Faucet's keyboard is a local incoming row, written on every start.
    expect(shouldNotify({ ...base, row: { ...base.row, peerAccountId: 'local:faucet' } })).toBe(false);
    expect(shouldNotify({ ...base, muted: true })).toBe(false);
    expect(shouldNotify({ ...base, enabled: false })).toBe(false);
  });

  // History that arrives late (a first sync) must not ring for every old message.
  it('skips messages older than a day', () => {
    expect(shouldNotify({ ...base, now: base.row.timestamp + 25 * 60 * 60 * 1000 })).toBe(false);
  });
});
