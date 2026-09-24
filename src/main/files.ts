/**
 * Spec 0012 (M15a): "Open" and "Save…" of a decrypted attachment. The file
 * leaves the renderer only through here: "Open" writes it to a fresh folder
 * under the OS temp directory and hands it to the default app (never a
 * webview); "Save…" asks where with the system dialog. The name comes from a
 * remote message, so it is cut to a plain file name first.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserWindow, app, dialog, shell } from 'electron';

import { safeFileName } from '../shared/fileName';

/** Spec 0012 size per attachment. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const checkBytes = (bytes: unknown): Uint8Array => {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('Invalid file.');
  return bytes;
};

/** Writes the file to a new temp folder and opens it with the system's default app. */
export async function openFile(bytes: unknown, name: unknown, mime: unknown): Promise<void> {
  const data = checkBytes(bytes);
  const dir = join(app.getPath('temp'), 'polkadot-chat-attachments', randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, safeFileName(name, mime));
  writeFileSync(path, data, { mode: 0o600 });
  const problem = await shell.openPath(path);
  if (problem) throw new Error(`The file could not be opened: ${problem}`);
}

/** Asks where to save it; resolves false when the person cancels. */
export async function saveFile(window: BrowserWindow | null, bytes: unknown, name: unknown, mime: unknown): Promise<boolean> {
  const data = checkBytes(bytes);
  const options = { defaultPath: join(app.getPath('downloads'), safeFileName(name, mime)) };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  writeFileSync(result.filePath, data);
  return true;
}
