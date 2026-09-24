/**
 * How a spec 0007 `tx` button looks (owner requirement for M11 step 3): it
 * must read as "this signs something", apart from command, callback and url
 * buttons. A Wallet icon, the label, the amount as a caption ("1 PAS"), the
 * tooltip below, and disabled with "Expired" once `expiresAt` passed. The
 * press only opens the signing strip. A label that already says the amount
 * ("Pay 0.5 PAS", M12g) gets no caption: one number per button (M12g review).
 */

import { decodeTxIntent } from '../../shared/txIntent';

export const TX_BUTTON_TOOLTIP = 'Signs a transaction with your account';
export const TX_EXPIRED_TOOLTIP = 'Expired';

export type TxButtonView = {
  /** "1 PAS", from `display.amount` and `display.asset`; null without an amount or when the label already shows it. */
  caption: string | null;
  expired: boolean;
  tooltip: string;
};

/** Null when the intent bytes do not decode (the keyboard never stores those as `tx`). */
export const txButtonView = (intentBytes: Uint8Array, now: number, label: string = ''): TxButtonView | null => {
  const intent = decodeTxIntent(intentBytes);
  if (!intent) return null;
  const { amount, asset } = intent.display;
  const expired = Number(intent.expiresAt) <= now;
  const caption = amount ? `${amount}${asset ? ` ${asset}` : ''}` : null;
  return {
    caption: caption !== null && label.includes(caption) ? null : caption,
    expired,
    tooltip: expired ? TX_EXPIRED_TOOLTIP : TX_BUTTON_TOOLTIP,
  };
};
