// Exposed by src/preload as `window.desktop`. Optional on Window because the
// renderer also runs without Electron (vitest, a plain browser).
export type DesktopApi = { version: string };

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
