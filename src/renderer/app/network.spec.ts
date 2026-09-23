import { describe, expect, it } from 'vitest';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, isNetworkProfileId, usernameSearchUrl } from './network';

describe('network profiles', () => {
  it('default is devnet, to match the bots in polkadot-chat-agents', () => {
    expect(DEFAULT_NETWORK_PROFILE).toBe('devnet');
  });

  it('every profile has at least one wss People endpoint and an https identity backend', () => {
    for (const profile of Object.values(NETWORK_PROFILES)) {
      expect(profile.peopleEndpoints.length).toBeGreaterThan(0);
      for (const endpoint of profile.peopleEndpoints) expect(endpoint).toMatch(/^wss:\/\//);
      expect(profile.identityBackend).toMatch(/^https:\/\//);
    }
  });

  it('builds the username search URL the identity backend expects', () => {
    expect(usernameSearchUrl(NETWORK_PROFILES.paseo, 'ali')).toBe(
      'https://identity-backend-next.parity-testnet.parity.io/api/v1/usernames/search?prefix=ali&limit=50',
    );
  });

  it('asks for a smaller page and the next one by cursor (the unified search shows 8 at a time)', () => {
    expect(usernameSearchUrl(NETWORK_PROFILES.paseo, 'ali', { limit: 8, cursor: 'abc=' })).toBe(
      'https://identity-backend-next.parity-testnet.parity.io/api/v1/usernames/search?prefix=ali&limit=8&cursor=abc%3D',
    );
  });

  it('rejects unknown profile ids read back from storage', () => {
    expect(isNetworkProfileId('devnet')).toBe(true);
    expect(isNetworkProfileId('mainnet')).toBe(false);
    expect(isNetworkProfileId(undefined)).toBe(false);
  });
});
