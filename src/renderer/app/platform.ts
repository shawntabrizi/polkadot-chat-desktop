/**
 * The one place the renderer's domain and app code touch browser globals, so
 * the same modules also run under Node (the e2e script, vitest). Each helper
 * has a Node fallback; in the browser it returns what the global returns.
 *
 * Node also needs an IndexedDB for Dexie: the Node runner installs
 * `fake-indexeddb/auto` before it imports `app/database.ts`.
 */

/** `navigator.userAgent` in the browser; `unknown` where there is no navigator. */
export const userAgent = (): string =>
  typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string' ? 'unknown' : navigator.userAgent;
