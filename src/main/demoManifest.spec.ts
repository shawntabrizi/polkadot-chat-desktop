/**
 * M12i: the manifest fetch in main. Why: a manifest that is slow, missing,
 * too large or malformed must never leave a new person without the demo
 * list, and a plain-http URL on the network must not be able to choose who
 * the app sends requests to.
 */

import { describe, expect, it } from 'vitest';

import { BUILT_IN_DEMO_BOTS } from '../shared/demoBots';

import { createDemoManifestSource, fetchDemoManifest, manifestUrl } from './demoManifest';

const respond = (body: string, status = 200): typeof fetch => (async () => new Response(body, { status })) as typeof fetch;
const valid = JSON.stringify({ devnet: [{ username: 'pcdnew.12', tagline: 'New', tag: 'game' }] });

describe('demo manifest fetch', () => {
  it('uses a valid manifest from an https URL', async () => {
    const manifest = await fetchDemoManifest('https://example.org/demo.json', respond(valid));
    expect(manifest.devnet.map(bot => bot.username)).toEqual(['pcdnew.12']);
  });

  it('falls back to the built-in list on a bad status, bad JSON, a bad shape or a too large body', async () => {
    for (const fetchFn of [respond(valid, 500), respond('{nope'), respond('{"devnet":[{"username":"x"}]}'), respond(' '.repeat(70_000) + valid)]) {
      expect(await fetchDemoManifest('https://example.org/demo.json', fetchFn)).toBe(BUILT_IN_DEMO_BOTS);
    }
  });

  it('gives up after the time limit and uses the built-in list', async () => {
    const hang: typeof fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const started = Date.now();
    expect(await fetchDemoManifest('https://example.org/demo.json', hang, 50)).toBe(BUILT_IN_DEMO_BOTS);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('takes https, and plain http only on this computer', () => {
    expect(manifestUrl('https://example.org/a.json')?.href).toBe('https://example.org/a.json');
    expect(manifestUrl('http://127.0.0.1:8080/a.json')).not.toBeNull();
    expect(manifestUrl('http://example.org/a.json')).toBeNull();
    expect(manifestUrl('file:///etc/passwd')).toBeNull();
    expect(manifestUrl(undefined)).toBeNull();
  });

  it('fetches once per app run', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls += 1;
      return new Response(valid);
    }) as typeof fetch;
    const source = createDemoManifestSource('https://example.org/demo.json', counting);
    await source();
    await source();
    expect(calls).toBe(1);
  });
});
