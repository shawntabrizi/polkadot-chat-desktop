// Spec 0006 keyboard under a message, and the confirm strip of a `url`
// button. Buttons follow .refs/polkadot-design-system SKILL.md §10 (secondary
// variant, rounded-medium inside a bubble, never a pill); the strip is inline
// under the bubble, not a modal, and names the host (§11).

import { ExternalLink, LoaderCircle } from 'lucide-react';

import type { ChatButton } from '../domain/chat/content';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { openableUrl } from '../../shared/openUrl';

/** Where a press goes; absent, every button shows disabled. */
export type KeyboardActions = {
  press: (row: number, index: number) => void;
  /** The button pressed last: highlighted; `busy` shows a spinner (a callback waiting for the bot). */
  active: { row: number; index: number; busy: boolean } | null;
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
          const runnable = action.kind !== 'unsupported';
          const active = same(keyboard?.active ?? null, r, i) || same(confirming, r, i);
          const busy = keyboard?.active?.busy === true && same(keyboard.active, r, i);
          const control = (
            <Button
              type="button"
              variant={active ? 'default' : 'secondary'}
              size="sm"
              className="h-auto min-h-8 max-w-full min-w-0 grow cursor-pointer rounded-medium py-1.5 text-label-m disabled:cursor-not-allowed"
              disabled={!runnable || !keyboard}
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
              <span className="truncate">{button.label}</span>
              {action.kind === 'url' ? <ExternalLink className="size-3.5" aria-hidden /> : null}
            </Button>
          );
          if (runnable) return <div key={i} className="flex max-w-full min-w-0 grow">{control}</div>;
          // A disabled button takes no pointer events: the wrapper holds the tooltip.
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="flex max-w-full min-w-0 grow cursor-not-allowed" data-testid="keyboard-disabled">
                  {control}
                </span>
              </TooltipTrigger>
              <TooltipContent>{DISABLED_ACTION_TEXT}</TooltipContent>
            </Tooltip>
          );
        })}
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
