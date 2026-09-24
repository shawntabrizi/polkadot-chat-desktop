/**
 * An expired `tx` button (owner question 2026-09-24: "what does it mean
 * 'expired' with the top up 1 PAS button?"). Why it matters: an old offer
 * must never open the signing strip, and the person must see what happened
 * and have a way on, not a grey button that only says "Expired".
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ChatButton } from '../domain/chat/content';
import { TooltipProvider } from '@/components/ui/tooltip';
import { encodeTxIntent } from '../../shared/txIntent';

import { ButtonKeyboard, type KeyboardActions } from './ButtonKeyboard';

const topUp = (expiresAt: number): ChatButton[][] => [
  [
    {
      label: 'Top up 1 PAS',
      action: {
        kind: 'tx',
        intent: encodeTxIntent({
          version: 1,
          chainId: '0x01',
          calls: [{ kind: 1, to: new Uint8Array(20), data: new Uint8Array([1]), value: 1n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
          display: { title: 'Top up', description: '', amount: '1', asset: 'PAS' },
          dryRunRequired: true,
          expiresAt: BigInt(expiresAt),
        }),
      },
    },
  ],
];

const render = (rows: ChatButton[][], keyboard: KeyboardActions | null) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ButtonKeyboard, { rows, keyboard, onAskUrl: () => undefined, confirming: null })));

const actions = (): KeyboardActions => ({ press: vi.fn(), active: null, askAgain: vi.fn() });

const txButton = (html: string): string => html.match(/<button[^>]*data-action="tx"[^>]*>/)?.[0] ?? '';

describe('ButtonKeyboard, an expired tx button', () => {
  it('is a disabled chip "<label> · expired", with "Ask for a new one" beside it', () => {
    const html = render(topUp(Date.now() - 60_000), actions());
    // Disabled: no press reaches the room, so the strip never opens.
    expect(txButton(html)).toContain(' disabled=""');
    expect(html).toContain('Top up 1 PAS · expired');
    expect(html).toContain('data-testid="keyboard-expired"');
    expect(html).toContain('data-testid="tx-ask-again"');
    expect(html).toContain('Ask for a new one');
  });

  it('offers no ask action where the room cannot send (a streaming preview)', () => {
    const html = render(topUp(Date.now() - 60_000), null);
    expect(html).toContain('Top up 1 PAS · expired');
    expect(html).not.toContain('tx-ask-again');
  });

  // The contrast: before its expiry the same button is live and says nothing of expiry.
  it('is a live tx button before its expiry', () => {
    const html = render(topUp(Date.now() + 60_000), actions());
    expect(txButton(html)).not.toContain(' disabled=""');
    expect(html).not.toContain('expired');
    expect(html).not.toContain('Ask for a new one');
  });

  // Spec 0007 "Non-expiring intents": expiresAt 0 is live forever, not expired since 1970.
  it('stays live with expiresAt 0', () => {
    const html = render(topUp(0), actions());
    expect(txButton(html)).not.toContain(' disabled=""');
    expect(html).not.toContain('expired');
  });
});
