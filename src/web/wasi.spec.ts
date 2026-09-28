import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runLitePerson } from '../main/identity/litePerson';
import { parseLitePersonOutput } from '../main/identity/register';

import { runWasiCommand } from './wasi';

// M22a: sign-up on the web depends on this shim giving the backend the same
// proof node:wasi gives on the desktop. The proof is deterministic, so the
// two runners must agree byte for byte.

const wasm = readFileSync(resolve(import.meta.dirname, '../../resources/summit-bandersnatch-cli.wasm'));
const entropy = `0x${'11'.repeat(32)}`;
const message = `0x${Buffer.from('pop:people-lite:register using').toString('hex')}${'22'.repeat(64)}`;

describe('browser WASI shim', () => {
  it('runs lite-person to the same output as node:wasi', async () => {
    const module = await WebAssembly.compile(wasm);
    const run = await runWasiCommand(module, ['bandersnatch', 'lite-person', entropy, message]);
    const web = parseLitePersonOutput(run.code, run.output.trim());
    expect(web.memberKey).toMatch(/^0x[0-9a-f]+$/);
    expect(web).toEqual(await runLitePerson(entropy, message));
  }, 60_000);

  it('reports a non-zero exit instead of a result', async () => {
    const module = await WebAssembly.compile(wasm);
    const run = await runWasiCommand(module, ['bandersnatch', 'no-such-command']);
    expect(run.code).not.toBe(0);
    expect(() => parseLitePersonOutput(run.code, run.output)).toThrow('identity proof helper failed');
  }, 60_000);
});
