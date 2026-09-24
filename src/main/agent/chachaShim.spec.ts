import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { chachaAead, installChachaShim } from './chachaShim';

const key = crypto.randomBytes(32);
const nonce = crypto.randomBytes(12);
const plain = Buffer.from('hello from the agent, twice the block size of chacha20 to cross a boundary: 0123456789abcdef');

describe('the chacha20-poly1305 shim for Electron\'s Node (M13)', () => {
  // bot-core and the phone apps use Node's/libsodium's bytes; the shim must
  // be byte-identical or no peer can read the agent (and it no one).
  it('seals exactly what Node\'s native cipher seals, and opens what it seals', () => {
    const native = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    const nativeOut = Buffer.concat([native.update(plain), native.final(), native.getAuthTag()]);
    const shim = chachaAead(key, nonce, false);
    const shimOut = Buffer.concat([shim.update(plain), shim.final(), shim.getAuthTag()]);
    expect(shimOut.equals(nativeOut)).toBe(true);

    const opener = chachaAead(key, nonce, true);
    opener.setAuthTag(nativeOut.subarray(nativeOut.length - 16));
    expect(Buffer.concat([opener.update(nativeOut.subarray(0, nativeOut.length - 16)), opener.final()]).equals(plain)).toBe(true);
  });

  it('refuses a message whose tag does not match', () => {
    const shim = chachaAead(key, nonce, false);
    const sealed = Buffer.concat([shim.update(plain), shim.final()]);
    const opener = chachaAead(key, nonce, true);
    opener.setAuthTag(Buffer.alloc(16));
    opener.update(sealed);
    expect(() => opener.final()).toThrow('unable to authenticate');
  });

  it('patches only a crypto without the cipher, and passes every other algorithm through', () => {
    expect(installChachaShim(crypto as never)).toBe(false);
    const calls: string[] = [];
    const fake = {
      createCipheriv: (algorithm: string) => {
        calls.push(algorithm);
        throw new Error('Unknown cipher');
      },
      createDecipheriv: (algorithm: string) => (calls.push(`d:${algorithm}`), 'native'),
    };
    expect(installChachaShim(fake as never)).toBe(true);
    const cipher = (fake.createCipheriv as unknown as (a: string, k: Buffer, n: Buffer) => { update: (d: Buffer) => Buffer })('chacha20-poly1305', key, nonce);
    expect(typeof cipher.update).toBe('function');
    expect((fake.createDecipheriv as unknown as (a: string) => string)('aes-256-gcm')).toBe('native');
    expect(calls).toEqual(['chacha20-poly1305', 'd:aes-256-gcm']);
  });
});
