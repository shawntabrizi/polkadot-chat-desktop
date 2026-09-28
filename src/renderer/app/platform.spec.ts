import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopApi } from '../../shared/desktop-api';

import { isWeb } from './platform';

// M22a: the "not on web" states must show only in the web build; the
// desktop (platform 'desktop') and a run without window.desktop keep theirs.

afterEach(() => vi.unstubAllGlobals());

describe('isWeb', () => {
  it('is false outside a browser and inside the desktop app', () => {
    expect(isWeb()).toBe(false);
    vi.stubGlobal('window', { desktop: { platform: 'desktop' } as DesktopApi });
    expect(isWeb()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isWeb()).toBe(false);
  });

  it('is true in the web build', () => {
    vi.stubGlobal('window', { desktop: { platform: 'web' } as DesktopApi });
    expect(isWeb()).toBe(true);
  });
});
