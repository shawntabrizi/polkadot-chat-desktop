// Ported from .refs/polkadot-chat-agents/bot-core/test/buttons-block.test.mjs
// (2026-09-23): the same cases, so the two parsers stay in step.

import { describe, expect, it } from 'vitest';

import { buttonsFallbackText, extractButtonsBlock, parseButtonsBlock, toButtonWire, validateButtons } from './buttonsBlock';
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

// Spec 0006 host leniency (2026-09-24), ported from pca bot-core/test/buttons-block.test.mjs
// at a0e0497: small models get the fence tag, the shape or the place wrong. The
// person must see buttons, or at worst clean text, never raw JSON. Ordinary
// code must never be eaten. The two hosts must agree, so the cases are pca's.
const fence = (tag: string, json: unknown) => `\`\`\`${tag}\n${typeof json === 'string' ? json : JSON.stringify(json)}\n\`\`\``;
const one = [{ label: 'Yes', action: { command: 'yes' } }];

describe('extractButtonsBlock (lenient, shared with pca)', () => {
  it("the owner's reply (bare fence, flat array, tip after) gives text and one Got it row", () => {
    const reply = 'I\'m Claude Haiku 4.5, the model behind this bot.\n\n```\n[{"label":"Got it","action":{"command":"ok"}}]\n```\n\n(Tip: send /help to see my commands.)';
    // The strict parser refused this reply: the owner saw raw JSON (the bug).
    expect(parseButtonsBlock(reply)).toBeNull();
    const parsed = extractButtonsBlock(reply);
    expect(parsed?.text).toBe("I'm Claude Haiku 4.5, the model behind this bot.\n\n(Tip: send /help to see my commands.)");
    expect(parsed?.rows).toEqual([[{ label: 'Got it', action: { command: 'ok' } }]]);
    expect(parsed?.invalid).toEqual([]);
    expect(parsed?.text.includes('label')).toBe(false);
  });

  it('buttons, json or untagged fence; rows object or flat array', () => {
    for (const tag of ['buttons', 'json', '']) {
      for (const spec of [{ rows: [one] }, one]) {
        const parsed = extractButtonsBlock(`Pick\n${fence(tag, spec)}`);
        expect(parsed?.text, `tag "${tag}"`).toBe('Pick');
        expect(parsed?.rows, `tag "${tag}"`).toEqual([[{ label: 'Yes', action: { command: 'yes' } }]]);
      }
    }
    expect(extractButtonsBlock(fence('json', { rows: [one], oneShot: true }))?.oneShot).toBe(true);
    const flat = extractButtonsBlock(fence('', [...one, { label: 'No', action: { command: 'no' } }]));
    // A flat array is ONE row.
    expect(flat?.rows).toHaveLength(1);
    expect(flat?.rows?.[0]).toHaveLength(2);
  });

  it('the block anywhere; text before and after joined with a blank line', () => {
    expect(extractButtonsBlock(`  Before.\n${fence('buttons', { rows: [one] })}\nAfter.  `)?.text).toBe('Before.\n\nAfter.');
    expect(extractButtonsBlock(`${fence('buttons', { rows: [one] })}\nOnly after.`)?.text).toBe('Only after.');
    expect(extractButtonsBlock(fence('buttons', { rows: [one] }))?.text).toBe('');
  });

  it('with several button fences the last valid one wins, all are stripped', () => {
    const first = [{ label: 'First', action: { command: '1' } }];
    const last = [{ label: 'Last', action: { command: '2' } }];
    const broken = [{ label: 'Broken', action: { url: 'http://insecure.example' } }];
    const parsed = extractButtonsBlock(`A\n${fence('', first)}\nB\n${fence('json', last)}\nC\n${fence('', broken)}`);
    // The last fence that validates, not the last fence.
    expect(parsed?.rows?.[0]?.[0]?.label).toBe('Last');
    expect(parsed?.text).toBe('A\n\nB\n\nC');
    expect(parsed?.invalid).toHaveLength(1);
  });

  it('ordinary code fences stay text, untouched', () => {
    const code = 'Here:\n```js\nconst a = [{ label: 1 }];\n```\nand\n```\nnpm test\n```\nand\n```json\n{"name":"x","list":[1,2]}\n```\nand\n```\n[1, 2, 3]\n```';
    expect(extractButtonsBlock(code)).toBeNull();
    const mixed = extractButtonsBlock(`\`\`\`python\nprint([{"label": "x"}])\n\`\`\`\n${fence('', one)}`);
    // The code fence survives byte for byte next to a real block.
    expect(mixed?.text).toBe('```python\nprint([{"label": "x"}])\n```');
    expect(mixed?.rows?.[0]?.[0]?.label).toBe('Yes');
  });

  it('a buttons-like fence that breaks the content rules is stripped, with a reason', () => {
    const check = (json: unknown, reason: RegExp) => {
      const parsed = extractButtonsBlock(`Text\n${fence('', json)}\nMore`);
      expect(parsed?.rows).toBeNull();
      // The JSON never reaches the person.
      expect(parsed?.text).toBe('Text\n\nMore');
      expect(parsed?.invalid[0]).toMatch(reason);
    };
    check(Array.from({ length: 5 }, (_, i) => ({ label: `B${i}`, action: { command: 'x' } })), /row 1 has 5 buttons/);
    check({ rows: Array.from({ length: 9 }, () => one) }, /9 rows/);
    check([{ label: 'x'.repeat(41), action: { command: 'x' } }], /row 1 button 1/);
    check([{ label: 'Go', action: { url: 'http://insecure.example' } }], /row 1 button 1/);
    check({ rows: [one], oneShot: 'yes' }, /oneShot/);
    // A ```buttons fence is meant as buttons even when its JSON breaks.
    const notJson = extractButtonsBlock(`Text\n${fence('buttons', '{not json')}`);
    expect([notJson?.text, notJson?.rows, notJson?.invalid]).toEqual(['Text', null, ['not JSON']]);
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
