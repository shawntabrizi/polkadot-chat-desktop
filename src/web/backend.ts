/**
 * M22a: the identity backend from the web build. The backend sends no
 * Access-Control-Allow-Origin for foreign origins (checked 2026-09-28), so a
 * browser cannot call it from our origin. Each call goes to the same-origin
 * path `/idb/<profile>/…` instead: the Vite dev server proxies it
 * (vite.web.config.ts); a deployment needs the same reverse proxy (docs/web.md).
 * M22c: the prefix is a build setting (`VITE_IDB_PROXY`), so a proxy on
 * another origin needs no code change; `off` builds without one.
 */

import { NETWORK_PROFILES, type NetworkProfileId } from '../shared/network';

/** The same-origin path prefix of a profile's backend. */
export const IDB_PREFIX = '/idb';

const profileOfOrigin = (origin: string): NetworkProfileId | null => {
  for (const profile of Object.values(NETWORK_PROFILES)) {
    if (new URL(profile.identityBackend).origin === origin) return profile.id;
  }
  return null;
};

/**
 * The proxied URL for a backend URL, or null for any other host (never sent).
 * `prefix` is a path on the page's origin (`/idb`) or a proxy's absolute URL.
 */
export const proxiedBackendUrl = (url: string, base: string, prefix: string = IDB_PREFIX): string | null => {
  const target = new URL(url);
  const profile = profileOfOrigin(target.origin);
  if (!profile) return null;
  return new URL(`${prefix}/${profile}${target.pathname}${target.search}`, base).href;
};

/** A `fetch` for register.ts, service.ts and the username search: backend URLs go through the proxy. */
export const createBackendFetch =
  (base: () => string = () => location.href, fetchFn: typeof fetch = (input, init) => fetch(input, init), prefix: string = IDB_PREFIX): typeof fetch =>
  (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const proxied = proxiedBackendUrl(url, base(), prefix);
    if (!proxied) return Promise.reject(new Error(`Not an identity backend URL: ${new URL(url).host}`));
    return fetchFn(proxied, init);
  };
