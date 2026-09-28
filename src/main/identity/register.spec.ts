import { describe, expect, it } from 'vitest';

import { jwtExpiresSoon, parseLitePersonOutput, requestIdentityChallenge } from './register';

// M22a replaced Buffer with atob/btoa here so the web build can reuse this
// module. These pin the decoding the backend session depends on, against
// Buffer as the reference the desktop used before.

const jwt = (payload: object): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

const challengeFetch = (challenge: string): typeof fetch =>
  (async () => new Response(JSON.stringify({ challenge }), { status: 200 })) as unknown as typeof fetch;

describe('register helpers without Buffer', () => {
  it('reads a JWT expiry: soon within a minute, not soon after it', () => {
    const now = 1_800_000_000_000;
    expect(jwtExpiresSoon(jwt({ exp: now / 1000 + 30 }), now)).toBe(true);
    expect(jwtExpiresSoon(jwt({ exp: now / 1000 + 3600 }), now)).toBe(false);
  });

  it('decodes base64url payloads with - and _ and no padding, as Buffer did', () => {
    // A payload whose base64url form holds '-' or '_' and needs padding.
    const payload = { exp: 4_000_000_000, sub: '>>>???' };
    const token = jwt(payload);
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(jwtExpiresSoon(token, 0)).toBe(false);
    expect(jwtExpiresSoon(jwt({ exp: 1, sub: '>>>???' }), 10_000)).toBe(true);
  });

  it('treats an unreadable token as not expiring (the caller then tries it)', () => {
    expect(jwtExpiresSoon('not-a-jwt')).toBe(false);
    expect(jwtExpiresSoon('a.%%%.c')).toBe(false);
  });

  it('decodes the auth challenge to the same bytes as Buffer', async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 250) % 256);
    const encoded = Buffer.from(bytes).toString('base64');
    expect(await requestIdentityChallenge({ backendUrl: 'https://backend.test', fetchImpl: challengeFetch(encoded) })).toEqual(bytes);
  });

  it('refuses a challenge that is not canonical base64', async () => {
    await expect(requestIdentityChallenge({ backendUrl: 'https://backend.test', fetchImpl: challengeFetch('abcde') })).rejects.toThrow('invalid authentication challenge');
    await expect(requestIdentityChallenge({ backendUrl: 'https://backend.test', fetchImpl: challengeFetch('') })).rejects.toThrow('invalid authentication challenge');
  });

  it('reads the proof helper output, and fails loud on a bad exit or shape', () => {
    expect(parseLitePersonOutput(0, '{"memberKey":"0x01","proofOfOwnership":"0x02"}')).toEqual({ memberKey: '0x01', proofOfOwnership: '0x02' });
    expect(() => parseLitePersonOutput(1, 'boom')).toThrow('exit 1');
    expect(() => parseLitePersonOutput(0, '{"memberKey":"0x01"}')).toThrow('unexpected result');
  });
});
