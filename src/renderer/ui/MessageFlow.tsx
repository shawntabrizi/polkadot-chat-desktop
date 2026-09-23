// Date grouping and run grouping from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageFlow.tsx
// (2026-09-23); the context menu is the bubble's DropdownMenu.

import { MessagesSquare } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

import type { MessageRow, RequestRow } from '../app/database';

import { type BubbleActions, DateSeparator, MessageBubble, SystemRow, messagePreview, systemText } from './MessageBubble';
import { formatDay } from './format';

type Props = {
  rows: readonly MessageRow[];
  peerName: string;
  /** Requests with this peer, to word the "approved" system rows. */
  requests: readonly RequestRow[];
  /** An assistant room: an empty incoming reply shows "Thinking…". */
  assistant: boolean;
  actionsFor: (row: MessageRow) => BubbleActions | null;
  /** Shown when there are no rows. */
  empty?: ReactNode;
};

type DayGroup = { day: string; rows: MessageRow[] };

const byDay = (rows: readonly MessageRow[]): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
    const day = formatDay(row.timestamp);
    const current = groups.at(-1);
    if (current?.day === day) current.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
};

export const MessageFlow = ({ rows, peerName, requests, assistant, actionsFor, empty }: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = new Map(rows.map(row => [row.messageId, row]));
  const last = rows.at(-1);
  // Follow the bottom as rows arrive and as a streamed reply grows.
  const followKey = `${rows.length}:${last ? messagePreview(last).length : 0}`;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [followKey]);

  return (
    <div className="min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-2" data-testid="messages">
        {rows.length === 0
          ? (empty ?? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <div className="mb-3 rounded-full bg-surface-nested p-4">
                  <MessagesSquare className="size-6 text-fg-tertiary" aria-hidden />
                </div>
                <p className="text-heading-m text-fg-primary">No messages yet</p>
                <p className="text-body-m text-fg-secondary">Send a message to begin the conversation</p>
              </div>
            ))
          : byDay(rows).map(group => (
              <section key={group.day} aria-label={group.day}>
                <DateSeparator text={group.day} />
                {group.rows.map((row, index) => {
                  if (row.direction === 'system') return <SystemRow key={row.messageId} text={systemText(row, peerName, requests)} />;
                  const previous = group.rows[index - 1];
                  const next = group.rows[index + 1];
                  const quoted = row.content.type === 'reply' ? byId.get(row.content.messageId) : undefined;
                  return (
                    <MessageBubble
                      key={row.messageId}
                      row={row}
                      quote={
                        row.content.type === 'reply'
                          ? quoted
                            ? { sender: quoted.direction === 'outgoing' ? 'You' : peerName, text: messagePreview(quoted) }
                            : { sender: peerName, text: 'Message not available' }
                          : null
                      }
                      first={previous?.direction !== row.direction}
                      last={next?.direction !== row.direction}
                      thinking={assistant && row.direction === 'incoming' && messagePreview(row) === ''}
                      actions={actionsFor(row)}
                    />
                  );
                })}
              </section>
            ))}
      </div>
    </div>
  );
};
