import { join, resolve } from 'node:path';

/**
 * Absolute path of a file shipped in `resources/`.
 *
 * A packaged app gets the folder under `process.resourcesPath` (M3 copies it
 * there with electron-builder `extraResources`). Every other run reads the repo
 * folder: this module sits two levels below the repo root both as source
 * (`src/main/resources.ts`, run by tsx) and when bundled (`out/main/index.js`).
 *
 * `electron` is not imported so the Node registration script can use this file;
 * a packaged app is Electron without `process.defaultApp` (what `app.isPackaged`
 * also reads).
 */
export const resourcePath = (name: string): string => {
  const packaged = Boolean(process.versions.electron) && !process.defaultApp;
  const base = packaged ? process.resourcesPath : resolve(import.meta.dirname, '../../resources');
  return join(base, name);
};
