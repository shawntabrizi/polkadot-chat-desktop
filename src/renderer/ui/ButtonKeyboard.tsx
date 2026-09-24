// Spec 0006 keyboard under a message, and the confirm strip of a `url`
// button. Buttons follow .refs/polkadot-design-system SKILL.md §10 (secondary
// variant, rounded-medium inside a bubble, never a pill); the strip is inline
// under the bubble, not a modal, and names the host (§11).

import { ExternalLink, LoaderCircle, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ChatButton, TxStatus } from '../domain/chat/content';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { openableUrl } from '../../shared/openUrl';

import { TxStatusIcon } from './Transactions';
import { txButtonView } from './txButton';

/** Where a press goes; absent, every button shows disabled. */
export type KeyboardActions = {
  press: (row: number, index: number) => void;
  /** The button pressed last: highlighted; `busy` shows a spinner (a callback waiting for the bot). */
  active: { row: number; index: number; busy: boolean } | null;
  /** Spec 0007: the state of the transaction a `tx` button of this keyboard started. */
  tx?: { row: number; index: number; status: TxStatus } | null;
  /** M12g: a button that is done ("Paid", "Declined"): this label, disabled. */
  done?: { row: number; index: number; label: string } | null;
  /** M12g: client chrome after the last button (a request's Decline); not a spec 0006 button. */
  extra?: ReactNode;
};

export type ButtonPosition = { row: number; index: number };

type Props = {
  rows: readonly ChatButton[][];
  keyboard: KeyboardActions | null;
  /** A `url` button asks first: the bubble opens the confirm strip. */
  onAskUrl: (position: ButtonPosition, url: string) => void;
  /** The url button whose strip is open. */
  confirming: ButtonPosition | null;
};

export const DISABLED_ACTION_TEXT = 'This client cannot run this action yet';

const same = (a: ButtonPosition | null, row: number, index: number): boolean => a !== null && a.row === row && a.index === index;

export const ButtonKeyboard = ({ rows, keyboard, onAskUrl, confirming }: Props) => (
  <div className="flex flex-col gap-1.5 pt-1" data-testid="keyboard">
    {rows.map((row, r) => (
      <div key={r} className="flex flex-wrap gap-1.5">
        {row.map((button, i) => {
          const { action } = button;
          // Spec 0007 (owner requirement): a tx button says it signs, shows the amount, and expires.
          const txView = action.kind === 'tx' ? txButtonView(action.intent, Date.now()) : null;
          const runnable = action.kind !== 'unsupported' && txView?.expired !== true;
          const active = same(keyboard?.active ?? null, r, i) || same(confirming, r, i);
          const busy = keyboard?.active?.busy === true && same(keyboard.active, r, i);
          const txStatus = keyboard?.tx && same(keyboard.tx, r, i) ? keyboard.tx.status : null;
          const done = keyboard?.done && same(keyboard.done, r, i) ? keyboard.done.label : null;
          const control = (
            <Button
              type="button"
              // A tx button stays secondary: while its strip is open, Sign is the one primary control.
              variant={active && action.kind !== 'tx' ? 'default' : 'secondary'}
              size="sm"
              className="h-auto min-h-8 max-w-full min-w-0 grow cursor-pointer rounded-medium py-1.5 text-label-m disabled:cursor-not-allowed"
              disabled={!runnable || !keyboard || done !== null}
              aria-pressed={active}
              aria-busy={busy}
              data-testid="keyboard-button"
              data-action={action.kind}
              onClick={() => {
                if (!keyboard) return;
                if (action.kind === 'url') onAskUrl({ row: r, index: i }, action.url);
                else if (action.kind !== 'unsupported') keyboard.press(r, i);
              }}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-label="Waiting for the answer" /> : null}
              {action.kind === 'tx' && !busy ? <Wallet className="size-4" aria-hidden /> : null}
              <span className="truncate">{done ?? button.label}</span>
              {txView?.caption ? (
                <span className="shrink-0 text-body-s text-fg-secondary" data-testid="tx-caption">
                  {txView.caption}
                </span>
              ) : null}
              {action.kind === 'url' ? <ExternalLink className="size-3.5" aria-hidden /> : null}
              {txStatus && !busy ? <TxStatusIcon status={txStatus} /> : null}
            </Button>
          );
          // Done: the state is the label; no tooltip, no press.
          if (done !== null) return <div key={i} className="flex max-w-full min-w-0 grow" data-testid="keyboard-done">{control}</div>;
          if (runnable && !txView) return <div key={i} className="flex max-w-full min-w-0 grow">{control}</div>;
          if (runnable) {
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div className="flex max-w-full min-w-0 grow">{control}</div>
                </TooltipTrigger>
                <TooltipContent>{txView?.tooltip}</TooltipContent>
              </Tooltip>
            );
          }
          // A disabled button takes no pointer events: the wrapper holds the tooltip.
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="flex max-w-full min-w-0 grow cursor-not-allowed" data-testid="keyboard-disabled">
                  {control}
                </span>
              </TooltipTrigger>
              <TooltipContent>{txView?.tooltip ?? DISABLED_ACTION_TEXT}</TooltipContent>
            </Tooltip>
          );
        })}
        {r === rows.length - 1 ? (keyboard?.extra ?? null) : null}
      </div>
    ))}
  </div>
);

/** "Open <host>?" with Open / Cancel, under the bubble. Never opens by itself. */
export const UrlConfirmStrip = ({ url, onOpen, onCancel }: { url: string; onOpen: () => void; onCancel: () => void }) => {
  const target = openableUrl(url);
  if (!target) return null;
  return (
    <div className="flex max-w-full items-center gap-2 rounded-nested bg-surface-container py-1.5 ps-3 pe-1.5 shadow-1" role="group" aria-label="Open link" data-testid="url-confirm">
      <p className="min-w-0 truncate text-body-s text-fg-secondary" title={target.href}>
        Open <span className="text-label-m text-fg-primary">{target.display}</span> in your browser?
      </p>
      <Button type="button" variant="ghost" size="sm" className="cursor-pointer rounded-medium font-normal" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" size="sm" className="cursor-pointer rounded-medium" onClick={onOpen} data-testid="url-open">
        Open
      </Button>
    </div>
  );
};
