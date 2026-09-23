import { describe, expect, it } from 'vitest';

import { isMac, isPrimaryModifier } from './keyboard';

describe('isPrimaryModifier', () => {
  // ⌘ on a Mac, Ctrl elsewhere: Ctrl+K on a Mac is a text-editing key, not ours.
  it('uses metaKey on macOS and ctrlKey elsewhere', () => {
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false }, false)).toBe(false);
  });

  it('reads the platform from the user agent', () => {
    expect(isMac('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/44.4.1')).toBe(true);
    expect(isMac('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });
});
