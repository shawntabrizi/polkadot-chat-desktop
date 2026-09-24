/**
 * M15b (review M15a item 4): "Open" writes a decrypted attachment to the OS
 * temp folder so the default app can read it. That plaintext must not outlive
 * the app, and a second running copy of the app must not lose the files it
 * has open when this one quits.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

const temp = mkdtempSync(join(tmpdir(), 'pcd-files-spec-'));
const opened: string[] = [];

vi.mock('electron', () => ({
  app: { getPath: () => temp },
  dialog: {},
  shell: {
    openPath: async (path: string) => {
      opened.push(path);
      return '';
    },
  },
}));

const { openFile, removeOpenedCopies } = await import('./files');

afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('"Open" temp copies', () => {
  it('are removed at quit, and only the ones this process wrote', async () => {
    await openFile(new Uint8Array([1, 2, 3]), 'notes.txt', 'text/plain');
    await openFile(new Uint8Array([4]), '../../escape.pdf', 'application/pdf');
    expect(opened).toHaveLength(2);
    for (const path of opened) expect(existsSync(path)).toBe(true);
    // The remote name is cut to a plain file name inside our folder.
    expect(opened[1]?.endsWith('escape.pdf')).toBe(true);
    expect(opened[1]?.startsWith(join(temp, 'polkadot-chat-attachments'))).toBe(true);

    // Another running copy of the app has its own folder next to ours.
    const other = join(temp, 'polkadot-chat-attachments', 'other-process');
    mkdirSync(other, { recursive: true });

    expect(removeOpenedCopies()).toBe(2);
    for (const path of opened) expect(existsSync(path)).toBe(false);
    expect(readdirSync(join(temp, 'polkadot-chat-attachments'))).toEqual(['other-process']);
    // A second quit hook call has nothing left to do.
    expect(removeOpenedCopies()).toBe(0);
  });
});
