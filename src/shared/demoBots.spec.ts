/**
 * M12i manifest rules. Why: the manifest decides who a new person's app sends
 * chat requests to, so a broken or hostile file must not reach the list; the
 * built-in bots are the fallback. The built-in list must stay well formed too
 * (the same rules), or the onboarding step shows a name that cannot resolve.
 */

import { describe, expect, it } from 'vitest';

import { BUILT_IN_DEMO_BOTS, DEMO_MANIFEST_LIMITS, parseDemoManifest } from './demoBots';

const good = { username: 'pcdnew.12', tagline: 'New — a new bot', tag: 'game' };

describe('demo bots manifest', () => {
  it('holds the seven devnet bots with their numbers, and none on Paseo (the step is hidden there)', () => {
    expect(BUILT_IN_DEMO_BOTS.devnet.map(bot => bot.username)).toEqual([
      'pcdpirate.81',
      'pcdguide.70',
      'pcdmeter.01',
      'pcdflip.44',
      'pcdfaucet.77',
      'pcdpeer.47',
      'pcdcolor.05',
    ]);
    expect(BUILT_IN_DEMO_BOTS.paseo).toEqual([]);
    expect(parseDemoManifest(BUILT_IN_DEMO_BOTS)).toEqual(BUILT_IN_DEMO_BOTS);
  });

  it('takes a valid list per profile and keeps the built-in list of a profile the file leaves out', () => {
    const manifest = parseDemoManifest({ paseo: [{ ...good, extra: 'ignored' }], other: 'ignored' });
    expect(manifest?.paseo).toEqual([good]);
    expect(manifest?.devnet).toEqual(BUILT_IN_DEMO_BOTS.devnet);
  });

  it('refuses the whole file when one entry is broken, so it never mixes with the built-in list', () => {
    const broken = [
      null,
      [],
      { devnet: 'x' },
      { devnet: [{ ...good, username: 'Pcdnew.12' }] },
      { devnet: [{ ...good, username: 'pcdnew' }] },
      { devnet: [{ ...good, username: 'pcdnew.1' }] },
      { devnet: [{ ...good, tagline: '   ' }] },
      { devnet: [{ ...good, tagline: 'x'.repeat(DEMO_MANIFEST_LIMITS.maxTagline + 1) }] },
      { devnet: [{ ...good, tag: 'casino' }] },
      { devnet: [good, good] },
      { devnet: Array.from({ length: DEMO_MANIFEST_LIMITS.maxBots + 1 }, (_, i) => ({ ...good, username: `pcdnew.${String(i).padStart(2, '0')}` })) },
      { devnet: [good], paseo: [{ username: 'x' }] },
    ];
    for (const value of broken) expect(parseDemoManifest(value), JSON.stringify(value)).toBeNull();
  });

  it('trims a tagline', () => {
    expect(parseDemoManifest({ devnet: [{ ...good, tagline: '  spaced  ' }] })?.devnet[0]?.tagline).toBe('spaced');
  });
});
