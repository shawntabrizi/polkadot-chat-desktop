import { describe, expect, it } from 'vitest';

import { BUILD, bugReportLine, windowTitle } from './appVersion';

// vitest.config.ts injects these, as electron-vite does for a build: the title
// and the bug report must carry the injected build, not a copy of the version.
describe('app version', () => {
  it('reads the injected build values', () => {
    expect(BUILD).toEqual({ version: '9.9.9-test', commit: 'abc1234', buildDate: '2026-01-02' });
  });

  it('titles the window with the injected version, and the profile only when there are several', () => {
    expect(windowTitle('Polkadot Chat', null)).toBe('Polkadot Chat 9.9.9-test');
    expect(windowTitle('(3) Polkadot Chat', 'alice.dot')).toBe('(3) Polkadot Chat 9.9.9-test — alice.dot');
  });

  it('builds the bug report line from the injected version and commit', () => {
    expect(bugReportLine({ osVersion: '15.6', profileCount: 2 })).toBe('Polkadot Chat 9.9.9-test (abc1234), macOS 15.6, profile count 2');
  });
});
