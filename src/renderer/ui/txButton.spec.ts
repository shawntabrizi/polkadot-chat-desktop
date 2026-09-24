import { describe, expect, it } from 'vitest';

import { type TxIntent, encodeTxIntent } from '../../shared/txIntent';

import { TX_BUTTON_TOOLTIP, TX_EXPIRED_TOOLTIP, txButtonView } from './txButton';

const intent = (overrides: Partial<TxIntent> = {}): Uint8Array =>
  encodeTxIntent({
    version: 1,
    chainId: '0x01',
    calls: [{ kind: 1, to: new Uint8Array(20), data: new Uint8Array([1]), value: 1n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
    display: { title: 'Top up', description: '', amount: '1', asset: 'PAS' },
    dryRunRequired: true,
    expiresAt: 2_000n,
    ...overrides,
  });

describe('txButtonView (owner requirement, M11 step 3)', () => {
  // A person must see, before pressing, that this button spends money and how much.
  it('shows the amount and asset as the caption and says it signs with your account', () => {
    expect(txButtonView(intent(), 1_000)).toEqual({ caption: '1 PAS', expired: false, tooltip: TX_BUTTON_TOOLTIP });
    expect(TX_BUTTON_TOOLTIP).toBe('Signs a transaction with your account');
  });

  it('has no caption when the intent names no amount', () => {
    expect(txButtonView(intent({ display: { title: 'Vote', description: '', amount: undefined, asset: undefined } }), 1_000)?.caption).toBeNull();
    expect(txButtonView(intent({ display: { title: 'Pay', description: '', amount: '5', asset: undefined } }), 1_000)?.caption).toBe('5');
  });

  // M12g review: "Pay 0.5 PAS" beside a "0.5 PAS" caption shows one number
  // twice. The amount must still be on the button: in the label, or else in
  // the caption.
  it('drops the caption when the label already shows the amount, and keeps it otherwise', () => {
    const pay = intent({ display: { title: 'Pay', description: '', amount: '0.5', asset: 'PAS' } });
    expect(txButtonView(pay, 1_000, 'Pay 0.5 PAS')?.caption).toBeNull();
    expect(txButtonView(pay, 1_000, 'Pay')?.caption).toBe('0.5 PAS');
    expect(txButtonView(pay, 1_000, 'Pay 0.5')?.caption).toBe('0.5 PAS');
  });

  // An old offer must not be signed by accident: disabled, and the tooltip says why.
  it('is expired at and after expiresAt', () => {
    expect(txButtonView(intent(), 2_000)).toEqual({ caption: '1 PAS', expired: true, tooltip: TX_EXPIRED_TOOLTIP });
    expect(TX_EXPIRED_TOOLTIP).toBe('Expired');
  });

  it('is null for bytes that are not an intent', () => {
    expect(txButtonView(new Uint8Array([1, 2, 3]), 0)).toBeNull();
  });
});
