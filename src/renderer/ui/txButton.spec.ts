import { afterEach, describe, expect, it, vi } from 'vitest';

import { type TxIntent, decodeTxIntent, encodeTxIntent, intentProblem } from '../../shared/txIntent';

import { formatTime } from './format';
import { TX_BUTTON_TOOLTIP, askAgainText, expiredTooltip, intentExpired, txButtonView, watchExpiry } from './txButton';

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
    expect(txButtonView(intent(), 1_000)).toEqual({ caption: '1 PAS', expired: false, expiresAt: 2_000, tooltip: TX_BUTTON_TOOLTIP });
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

  // An old offer must not be signed by accident: disabled, and the tooltip
  // says when it ended and what to do (owner, 2026-09-24: a bare "Expired" was unclear).
  it('is expired at and after expiresAt, and the tooltip says when and what to do', () => {
    expect(txButtonView(intent(), 1_999)?.expired).toBe(false);
    expect(txButtonView(intent(), 2_000)).toEqual({ caption: '1 PAS', expired: true, expiresAt: 2_000, tooltip: expiredTooltip(2_000) });
    expect(expiredTooltip(2_000)).toBe(`This offer expired on ${formatTime(2_000)}. Ask the bot for a new one.`);
  });

  // Spec 0007 "Non-expiring intents": 0 never expires, so the strip opens after any time.
  it('never expires with expiresAt 0: no expired state, the normal tooltip, and the strip may open', () => {
    const forever = intent({ expiresAt: 0n });
    const later = 4_000_000_000_000;
    expect(txButtonView(forever, later)).toEqual({ caption: '1 PAS', expired: false, expiresAt: 0, tooltip: TX_BUTTON_TOOLTIP });
    const decoded = decodeTxIntent(forever);
    expect(decoded && intentExpired(decoded, later)).toBe(false);
    expect(decoded && intentProblem(decoded, { chainIds: ['0x01'], now: later })).toBeNull();
    // The contrast: a finite expiry in the past is refused by the same check.
    const old = decodeTxIntent(intent());
    expect(old && intentProblem(old, { chainIds: ['0x01'], now: later })).toBe('This action has expired. Ask for a new one.');
  });

  it('is null for bytes that are not an intent', () => {
    expect(txButtonView(new Uint8Array([1, 2, 3]), 0)).toBeNull();
  });
});

const METER_COMMANDS = [
  { name: 'balance', description: 'Your balance' },
  { name: 'topup', description: 'Add 1 PAS' },
];
const topUp = { title: 'Top up', description: 'Adds 1 PAS to your balance with Meter', amount: '1', asset: 'PAS' };

describe('askAgainText (an expired offer asks for a new one)', () => {
  // The bot answers its own command with a fresh button; plain words need a brain to read them.
  it("sends the bot's command whose name the offer's label or title starts with", () => {
    expect(askAgainText('Top up 1 PAS', topUp, METER_COMMANDS)).toBe('/topup');
    // Not /balance: the offer's opening words decide.
    expect(askAgainText('Top up your balance', topUp, METER_COMMANDS)).toBe('/topup');
    const stake = { title: 'Stake', description: '', amount: '0.5', asset: 'PAS' };
    expect(askAgainText('Stake 0.5 PAS on heads', stake, [{ name: 'flip', description: 'Flip a coin' }, { name: 'stake', description: 'Stake on a flip' }])).toBe('/stake');
  });

  it("sends the command whose description says what the offer says, when no name matches", () => {
    expect(askAgainText('Top up 1 PAS', topUp, [{ name: 'fund', description: 'Top up your balance' }])).toBe('/fund');
    // A word inside another word is no match ("up" is not "update").
    expect(askAgainText('Top up 1 PAS', topUp, [{ name: 'news', description: 'Top update of the day' }])).toBe("Please send a new 'Top up 1 PAS' button");
  });

  // A person, or a bot with no matching command, still learns what to resend.
  it('falls back to plain text naming the button when no command matches', () => {
    expect(askAgainText('Top up 1 PAS', topUp, [{ name: 'help', description: 'What I can do' }])).toBe("Please send a new 'Top up 1 PAS' button");
    expect(askAgainText('Pay 0.5 PAS', null, [])).toBe("Please send a new 'Pay 0.5 PAS' button");
  });
});

describe('watchExpiry (a button in view flips without a reload)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The room stays open past the offer's end: the button must turn expired then, not at the next reload.
  it('fires when the earliest expiry ahead passes, and the view is then expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const flipped = vi.fn();
    watchExpiry([5_000, 2_000, 500], Date.now(), flipped);
    vi.advanceTimersByTime(999);
    expect(flipped).not.toHaveBeenCalled();
    expect(txButtonView(intent(), Date.now())?.expired).toBe(false);
    vi.advanceTimersByTime(1);
    expect(flipped).toHaveBeenCalledOnce();
    expect(txButtonView(intent(), Date.now())?.expired).toBe(true);
  });

  it('fires at once for an expiry that passed after the buttons were drawn, and not at all with none ahead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    const late = vi.fn();
    watchExpiry([2_000], 1_000, late);
    vi.advanceTimersByTime(0);
    expect(late).toHaveBeenCalledOnce();
    const none = vi.fn();
    // 0 never expires: no timer for it.
    watchExpiry([2_000, 0], 3_000, none);
    vi.advanceTimersByTime(10_000_000);
    expect(none).not.toHaveBeenCalled();
  });

  it('cancels', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const flipped = vi.fn();
    watchExpiry([100], 0, flipped)();
    vi.advanceTimersByTime(200);
    expect(flipped).not.toHaveBeenCalled();
  });
});
