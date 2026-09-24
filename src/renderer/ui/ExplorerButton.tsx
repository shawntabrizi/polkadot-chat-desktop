// "View on <explorer>" (M12c step 10): client chrome, never a spec 0006 wire
// button. It opens the link in the browser through the main process's
// `open:url` (https only; never a webview). A chain the chosen explorer does
// not know shows the button disabled, with the reason as its tooltip, never
// a dead link.

import { ExternalLink } from 'lucide-react';

import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import { EXPLORER_LABELS, type ExplorerId, type ExplorerLink } from '../../shared/explorers';

import { useLiveQuery } from './useLiveQuery';

/** The explorer the user chose in Settings (Subscan until it loads). */
export const useExplorer = (): ExplorerId => (useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS).explorer;

type Props = {
  explorer: ExplorerId;
  link: ExplorerLink;
  className?: string;
  testId?: string;
};

export const ExplorerButton = ({ explorer, link, className, testId }: Props) => {
  const open = window.desktop?.app.openUrl;
  const reason = 'unavailable' in link ? link.unavailable : open ? null : 'Links open only inside Polkadot Chat Desktop.';
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 cursor-pointer rounded-medium px-2 text-label-s font-normal disabled:cursor-not-allowed', className)}
      disabled={reason !== null}
      data-testid={testId}
      onClick={() => {
        if ('url' in link && open) void open(link.url).catch((cause: unknown) => console.warn('[explorer] the link did not open', cause));
      }}
    >
      <ExternalLink className="size-3.5" aria-hidden />
      View on {EXPLORER_LABELS[explorer]}
    </Button>
  );
  if (reason === null) return button;
  // A disabled button gets no pointer events: the tooltip sits on a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
};
