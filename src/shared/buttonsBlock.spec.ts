// Ported from .refs/polkadot-chat-agents/bot-core/test/buttons-block.test.mjs
// (2026-09-23): the same cases, so the two parsers stay in step.

import { describe, expect, it } from 'vitest';

import { buttonsFallbackText, parseButtonsBlock, toButtonWire, validateButtons } from './buttonsBlock';
import { openableUrl } from './openUrl';

const block = (json: unknown) => `Pick one\n\n\`\`\`buttons\n${typeof json === 'string' ? json : JSON.stringify(json)}\n\`\`\`\n`;
const rowsOf = (n: number, width = 1) =>
  Array.from({ length: n }, (_, r) => Array.from({ length: width }, (_, i) => ({ label: `B${r}${i}`, action: { command: `c${r}${i}` } })));

describe('parseButtonsBlock (shared with pca)', () => {
  it('a valid trailing block becomes rows; the text keeps what came before it', () => {
    const parsed = parseButtonsBlock(
      block({
        rows: [
          [{ label: 'Echo', action: { command: 'echo hi' } }, { label: 'Colour', action: { callback: 'base64:AQI=' } }],
          [{ label: 'Docs', action: { url: 'https://polkadot.com' } }, { label: 'More', action: { callback: 'page-2' } }],
        ],
        oneShot: true,
      }),
    );
    expect(parsed?.text).toBe('Pick one');
    expect(parsed?.oneShot).toBe(true);
    expect(parsed?.rows[0]?.[0]).toEqual({ label: 'Echo', action: { command: 'echo hi' } });
    // base64: prefix gives raw bytes; a plain callback is UTF-8.
    expect(parsed?.rows[0]?.[1]?.action).toEqual({ callback: Uint8Array.of(1, 2) });
    expect(parsed?.rows[1]?.[0]?.action).toEqual({ url: 'https://polkadot.com' });
    expect(parsed?.rows[1]?.[1]?.action).toEqual({ callback: new TextEncoder().encode('page-2') });
    expect(parseButtonsBlock(block({ rows: rowsOf(1) }))?.oneShot).toBe(false);
  });

  // An invalid block must stay visible as text: dropping it would silently
  // lose the brain's choices, and a half-parsed one would show wrong ones.
  it('an invalid or misplaced block is left as text (null)', () => {
    expect(parseButtonsBlock('plain answer')).toBeNull();
    expect(parseButtonsBlock(block('{not json'))).toBeNull();
    expect(parseButtonsBlock(block({ rows: [] }))).toBeNull();
    expect(parseButtonsBlock(block({ rows: [[{ label: 'x', action: { tx: '00' } }]] }))).toBeNull();
    expect(parseButtonsBlock(block({ rows: [[{ label: 'x', action: { url: 'http://insecure.example' } }]] }))).toBeNull();
    expect(parseButtonsBlock(block({ rows: [[{ label: 'x', action: { command: 'a', url: 'https://a.b' } }]] }))).toBeNull();
    expect(parseButtonsBlock(block({ rows: rowsOf(1), oneShot: 'yes' }))).toBeNull();
    expect(parseButtonsBlock(`${block({ rows: rowsOf(1) })}and then more text`)).toBeNull();
    expect(parseButtonsBlock('text ```buttons\n{"rows":[[{"label":"a","action":{"command":"b"}}]]}\n```')).toBeNull();
  });

  it('limits: 8 rows x 4 buttons, 40-character labels, 256-byte callbacks', () => {
    expect(parseButtonsBlock(block({ rows: rowsOf(8, 4) }))).not.toBeNull();
    expect(parseButtonsBlock(block({ rows: rowsOf(9) }))).toBeNull();
    expect(parseButtonsBlock(block({ rows: rowsOf(1, 5) }))).toBeNull();
    const label = (text: string) => ({ rows: [[{ label: text, action: { command: 'x' } }]] });
    expect(validateButtons(label('é'.repeat(40)))).not.toBeNull();
    expect(validateButtons(label('x'.repeat(41)))).toBeNull();
    expect(validateButtons(label('   '))).toBeNull();
    const callback = (text: string) => ({ rows: [[{ label: 'x', action: { callback: text } }]] });
    expect(validateButtons(callback('x'.repeat(256)))).not.toBeNull();
    expect(validateButtons(callback('x'.repeat(257)))).toBeNull();
    expect(validateButtons(callback('base64:not base64!'))).toBeNull();
  });

  it('the fallback is the text, then the labels as a numbered list in row order', () => {
    const parsed = parseButtonsBlock(
      block({ rows: [[{ label: 'Echo', action: { command: 'e' } }, { label: 'Colour', action: { callback: 'c' } }], [{ label: 'Docs', action: { url: 'https://polkadot.com' } }]] }),
    );
    expect(buttonsFallbackText(parsed?.text ?? '', parsed?.rows ?? [])).toBe('Pick one\n\n1. Echo\n2. Colour\n3. Docs');
    expect(buttonsFallbackText('', parsed?.rows ?? [])).toBe('1. Echo\n2. Colour\n3. Docs');
  });

  it('maps a block button to the codec shape the desktop encodes', () => {
    expect(toButtonWire({ label: 'a', action: { command: 'x' } })).toEqual({ label: 'a', action: { tag: 'command', value: 'x' } });
    expect(toButtonWire({ label: 'b', action: { callback: Uint8Array.of(1) } })).toEqual({ label: 'b', action: { tag: 'callback', value: Uint8Array.of(1) } });
    expect(toButtonWire({ label: 'c', action: { url: 'https://a.b' } })).toEqual({ label: 'c', action: { tag: 'url', value: 'https://a.b' } });
  });
});

describe('openableUrl (spec 0006: https and polkadotapp only, host shown)', () => {
  it('opens https and polkadotapp links and names the host the user will see', () => {
    expect(openableUrl('https://docs.polkadot.com/path?q=1')).toEqual({ href: 'https://docs.polkadot.com/path?q=1', display: 'docs.polkadot.com' });
    expect(openableUrl('polkadotapp://chat/room')?.display).toBe('polkadotapp://chat');
  });

  // The host shown must be the host opened: a user@ prefix must not pass for the host.
  it('shows the real host of a link that hides it behind user info', () => {
    expect(openableUrl('https://polkadot.com@evil.example/x')?.display).toBe('evil.example');
  });

  it('refuses every other scheme and junk', () => {
    for (const value of ['http://example.com', 'javascript:alert(1)', 'file:///etc/hosts', 'data:text/html,x', 'not a url', `https://a.b/${'x'.repeat(3000)}`]) {
      expect(openableUrl(value)).toBeNull();
    }
  });
});
