/**
 * M12e step 12. Why: the owner saw Settings › Diagnostics go back to zero
 * after a window reload or a theme switch, which made the number useless for
 * a long session. The totals live in main and only grow by what the renderer
 * reports; a malformed report must not change them.
 */

import { describe, expect, it } from 'vitest';

import { createDiagnostics, parseDelta } from './diagnostics';

describe('main-process diagnostics totals', () => {
  it('adds the reports of two page loads (a reload starts a new renderer meter at zero)', () => {
    const diagnostics = createDiagnostics();
    diagnostics.add({ submissions: 3, acknowledgements: 2, messages: 3 });
    // The reloaded page reports only what it counted itself.
    diagnostics.add({ submissions: 1, acknowledgements: 0, messages: 1 });
    expect(diagnostics.snapshot()).toEqual({ submissions: 4, acknowledgements: 2, messages: 4 });
  });

  it('refuses a report that is not three non-negative whole counts', () => {
    const diagnostics = createDiagnostics();
    for (const bad of [null, 'x', { submissions: -1, acknowledgements: 0, messages: 0 }, { submissions: 1.5, acknowledgements: 0, messages: 0 }, { submissions: 1 }]) {
      expect(diagnostics.add(bad)).toBeNull();
    }
    expect(parseDelta({ submissions: 1, acknowledgements: 0, messages: 0 })).toEqual({ submissions: 1, acknowledgements: 0, messages: 0 });
    expect(diagnostics.snapshot()).toEqual({ submissions: 0, acknowledgements: 0, messages: 0 });
  });
});
