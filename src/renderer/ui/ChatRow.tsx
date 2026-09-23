// Recipe from .refs/polkadot-desktop/src/features/chat/ui/partials/ChatItem.tsx (2026-09-23):
// avatar, name over preview, time and unread count on the right. No separator
// line: the rows sit on the pane's container surface and the hover marks them.

import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

type Props = {
  avatar: ReactNode;
  name: string;
  time: string | null;
  preview: string;
  unread: number;
  selected: boolean;
  onClick: () => void;
  testId?: string;
};

export const ChatRow = ({ avatar, name, time, preview, unread, selected, onClick, testId }: Props) => (
  <button
    type="button"
    data-testid={testId}
    aria-current={selected ? 'true' : undefined}
    onClick={onClick}
    className={cn(
      'flex w-full cursor-pointer items-center gap-3 rounded-nested px-2 py-2 text-left transition-colors',
      selected ? 'bg-selection-container-active' : 'hover:bg-selection-container-hover',
    )}
  >
    {avatar}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-label-l text-fg-primary">{name}</span>
        {time ? <span className="shrink-0 text-caption text-fg-tertiary">{time}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-body-m text-fg-secondary">{preview}</span>
        {unread > 0 ? (
          <Badge className="h-5 min-w-5 shrink-0 rounded-full px-1.5 text-label-s" aria-label={`${unread} unread`}>
            {unread}
          </Badge>
        ) : null}
      </span>
    </span>
  </button>
);
