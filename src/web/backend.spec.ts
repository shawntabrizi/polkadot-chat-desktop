import { describe, expect, it, vi } from 'vitest';

import { NETWORK_PROFILES } from '../shared/network';

import { createBackendFetch, proxiedBackendUrl } from './backend';

// M22a: the identity backend has no CORS headers, so every call must leave
// on the page's own origin under /idb/<profile>, and nothing may go to any
// other host through this path.

const base = 'http://localhost:5173/';

describe('identity backend through /idb', () => {
  it('maps each profile backend to its own prefix, path and query kept', () => {
    expect(proxiedBackendUrl(`${NETWORK_PROFILES.devnet.identityBackend}/api/v1/usernames/available?version=v1`, base)).toBe(
      'http://localhost:5173/idb/devnet/api/v1/usernames/available?version=v1',
    );
    expect(proxiedBackendUrl(`${NETWORK_PROFILES.paseo.identityBackend}/api/v1/attester`, base)).toBe('http://localhost:5173/idb/paseo/api/v1/attester');
  });

  it('refuses any other host', async () => {
    expect(proxiedBackendUrl('https://example.org/api/v1/attester', base)).toBeNull();
    const fetchFn = vi.fn();
    await expect(createBackendFetch(() => base, fetchFn)('https://example.org/x')).rejects.toThrow('Not an identity backend URL');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes method, headers and body through unchanged', async () => {
    const fetchFn = vi.fn(async () => new Response('{}'));
    const init = { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' };
    await createBackendFetch(() => base, fetchFn as unknown as typeof fetch)(new URL('/api/v1/usernames', NETWORK_PROFILES.devnet.identityBackend), init);
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:5173/idb/devnet/api/v1/usernames', init);
  });
});
