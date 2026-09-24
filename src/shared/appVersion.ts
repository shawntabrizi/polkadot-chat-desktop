/**
 * The app's version, commit and build date, injected at build time by
 * electron-vite `define` (electron.vite.config.ts) and by vitest.config.ts in
 * tests. The commit is "dev" when the build had no git.
 */

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_DATE__: string;

export type BuildInfo = { version: string; commit: string; buildDate: string };

export const BUILD: BuildInfo = { version: __APP_VERSION__, commit: __APP_COMMIT__, buildDate: __BUILD_DATE__ };

/**
 * The window title (the Window menu and Mission Control list it): the page's
 * title ("Polkadot Chat", or "(3) Polkadot Chat" with unread), the version,
 * and the profile when several exist (`profile` is null with one).
 */
export const windowTitle = (pageTitle: string, profile: string | null, build: BuildInfo = BUILD): string =>
  `${pageTitle} ${build.version}${profile ? ` — ${profile}` : ''}`;

/** The one line Settings copies for a bug report. */
export const bugReportLine = ({ osVersion, profileCount }: { osVersion: string; profileCount: number }, build: BuildInfo = BUILD): string =>
  `Polkadot Chat ${build.version} (${build.commit}), macOS ${osVersion}, profile count ${profileCount}`;
