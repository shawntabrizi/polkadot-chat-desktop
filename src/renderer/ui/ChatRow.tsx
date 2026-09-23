// Recipe from .refs/polkadot-desktop/src/features/chat/ui/partials/ChatItem.tsx (2026-09-23):
// avatar, name over preview, time and unread count on the right. No separator
// line: the rows sit on the pane's container surface and the hover marks them.
// A room row also has a "More" menu (mute) that shows on hover and focus.

import { Bell, BellOff, MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';

type Props = {
  avatar: ReactNode;
  name: string;
  time: string | null;
  /** A search hit's preview carries the bold match, so it is a node. */
  preview: ReactNode;
  /** `tertiary` for a status such as "Typing…", not a message. */
  previewTone?: 'secondary' | 'tertiary';
  unread: number;
  selected: boolean;
  /** The row the search's ↑/↓ points at (M7b step 2). */
  highlighted?: boolean;
  onClick: () => void;
  testId?: string;
  /** A room row: muted state and its toggle. Absent for search results and requests. */
  mute?: { muted: boolean; toggle: () => void };
  /** A spec 0008 bot badge after the name. */
  badge?: ReactNode;
};

export const ChatRow = ({ avatar, name, time, preview, previewTone = 'secondary', unread, selected, highlighted = false, onClick, testId, mute, badge }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        'group/row relative flex w-full items-center rounded-nested transition-colors',
        selected ? 'bg-selection-container-active' : highlighted ? 'bg-selection-container-hover' : 'hover:bg-selection-container-hover',
      )}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      <button
        type="button"
        data-testid={testId}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2 text-left"
      >
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="truncate text-label-l text-fg-primary">{name}</span>
              {badge}
              {mute?.muted ? <BellOff className="size-3.5 shrink-0 text-fg-tertiary" aria-label="Muted" data-testid="muted-icon" /> : null}
            </span>
            {time ? <span className={cn('shrink-0 text-caption text-fg-tertiary', mute && 'group-hover/row:invisible', menuOpen && 'invisible')}>{time}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-body-m', previewTone === 'tertiary' ? 'text-fg-tertiary' : 'text-fg-secondary')}>{preview}</span>
            {unread > 0 ? (
              <Badge
                className={cn('h-5 min-w-5 shrink-0 rounded-full px-1.5 text-label-s', mute?.muted && 'bg-action-tertiary text-fg-secondary')}
                aria-label={`${unread} unread`}
              >
                {unread}
              </Badge>
            ) : null}
          </span>
        </span>
      </button>
      {mute ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`More for ${name}`}
              className={cn(
                'absolute end-2 top-2 rounded-full font-normal opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100',
                menuOpen && 'opacity-100',
              )}
            >
              <MoreHorizontal className="size-4 text-fg-secondary" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={mute.toggle}>
              {mute.muted ? <Bell /> : <BellOff />} {mute.muted ? 'Unmute' : 'Mute'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};
