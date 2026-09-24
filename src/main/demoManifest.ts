/**
 * M12i: the demo bots list. The built-in list (shared/demoBots.ts) unless
 * `PCD_DEMO_MANIFEST_URL` names a manifest: then main fetches it once per app
 * run (5 s limit), checks it with `parseDemoManifest`, and falls back to the
 * built-in list on any failure. The renderer never fetches it: the manifest
 * decides who the app sends chat requests to.
 */

import { BUILT_IN_DEMO_BOTS, DEMO_MANIFEST_LIMITS, type DemoManifest, parseDemoManifest } from '../shared/demoBots';

export const DEMO_MANIFEST_TIMEOUT_MS = 5_000;

/** https anywhere; plain http only on this computer (a local test file server). */
export const manifestUrl = (raw: string | undefined): URL | null => {
  if (!raw || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url;
  } catch {
    // not a URL
  }
  return null;
};

export const fetchDemoManifest = async (
  raw: string | undefined,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = DEMO_MANIFEST_TIMEOUT_MS,
): Promise<DemoManifest> => {
  const url = manifestUrl(raw);
  if (!url) {
    if (raw) console.warn('[demo] PCD_DEMO_MANIFEST_URL is not an https URL; using the built-in list');
    return BUILT_IN_DEMO_BOTS;
  }
  try {
    const response = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > DEMO_MANIFEST_LIMITS.maxBytes) throw new Error('the manifest is larger than 64 KB');
    const manifest = parseDemoManifest(JSON.parse(text));
    if (!manifest) throw new Error('the manifest does not have the demo bots shape');
    return manifest;
  } catch (error) {
    console.warn('[demo] manifest not used (%s); using the built-in list', error instanceof Error ? error.message : String(error));
    return BUILT_IN_DEMO_BOTS;
  }
};

/** One fetch per app run: the list does not change while the app runs. */
export const createDemoManifestSource = (raw: string | undefined = process.env.PCD_DEMO_MANIFEST_URL, fetchFn: typeof fetch = fetch) => {
  let loaded: Promise<DemoManifest> | null = null;
  return (): Promise<DemoManifest> => {
    loaded ??= fetchDemoManifest(raw, fetchFn);
    return loaded;
  };
};
