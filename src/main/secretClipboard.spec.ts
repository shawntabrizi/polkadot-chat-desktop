/**
 * Why: a recovery phrase left on the clipboard can be pasted anywhere later.
 * It must go after 60 s. But overwriting something the person copied after
 * it would lose their data, so only the same text is cleared.
 */

import { describe, expect, it } from 'vitest';

import { SECRET_CLIPBOARD_MS, createSecretClipboard } from './secretClipboard';

const PHRASE = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

const fakes = () => {
  let text = '';
  let run: VoidFunction | null = null;
  let ms = 0;
  const clipboard = {
    writeText: async (t: string) => void (text = t),
    readText: async () => text,
    clear: () => void (text = ''),
  };
  const timers = {
    set: (fn: VoidFunction, wait: number) => {
      run = fn;
      ms = wait;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clear: () => void (run = null),
  };
  return { clipboard, timers, fire: async () => (run?.(), await new Promise(resolve => setTimeout(resolve, 0))), text: () => text, ms: () => ms, pending: () => run !== null };
};

describe('secret clipboard', () => {
  it('clears the phrase after 60 s when the clipboard still holds it, and says so', async () => {
    const f = fakes();
    let cleared = 0;
    const secret = createSecretClipboard(f.clipboard, () => (cleared += 1), f.timers);
    await secret.copy(PHRASE);
    expect(f.text()).toBe(PHRASE);
    expect(f.ms()).toBe(SECRET_CLIPBOARD_MS);
    await f.fire();
    expect(f.text()).toBe('');
    expect(cleared).toBe(1);
  });

  it('keeps what the person copied after the phrase, and shows no hint', async () => {
    const f = fakes();
    let cleared = 0;
    const secret = createSecretClipboard(f.clipboard, () => (cleared += 1), f.timers);
    await secret.copy(PHRASE);
    await f.clipboard.writeText('a shopping list');
    await f.fire();
    expect(f.text()).toBe('a shopping list');
    expect(cleared).toBe(0);
  });

  it('a second copy starts the time again (one timer)', async () => {
    const f = fakes();
    const secret = createSecretClipboard(f.clipboard, () => undefined, f.timers);
    await secret.copy(PHRASE);
    await secret.copy(PHRASE);
    expect(f.pending()).toBe(true);
    await f.fire();
    expect(f.text()).toBe('');
  });
});
