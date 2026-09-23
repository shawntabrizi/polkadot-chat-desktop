// Date grouping and run grouping from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageFlow.tsx
// (2026-09-23); the context menu is the bubble's DropdownMenu.

import { ArrowDown, MessagesSquare } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MessageRow, RequestRow } from '../app/database';
import { isLiveFrame } from '../domain/chat/content';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

import { type BubbleActions, DateSeparator, GreetingRow, MessageBubble, SystemRow, messagePreview, systemText } from './MessageBubble';
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
  /** "New messages" goes above this row (the first unread when the room opened). */
  firstUnreadId?: string | null;
  /** Unread messages of the room: shown on the jump-to-bottom button. */
  unread?: number;
  /** The last message is in view and the window has focus: the room is read. */
  onSeen?: () => void;
  /** A line under one bubble (the running assistant reply's tool). */
  noteFor?: (row: MessageRow) => string | null;
  /** Messages whose Delete waits out its Undo time: they show "Deleting…". */
  deleting?: ReadonlySet<string>;
  /** Typing reveal of answers that arrive while the room is open (Settings → Chat). */
  reveal?: boolean;
  /** A message search hit to scroll to and highlight; `request` changes on every pick. */
  jumpTo?: { messageId: string; request: number } | null;
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

/** Mobile's separator string (docs/reference/mobile-ux.md). */
const NewMessagesSeparator = () => (
  <div className="flex items-center gap-3 pt-4 pb-2" data-testid="new-messages">
    <span className="h-px flex-1 bg-stroke-tertiary" aria-hidden />
    <span className="text-label-s text-fg-secondary">New messages</span>
    <span className="h-px flex-1 bg-stroke-tertiary" aria-hidden />
  </div>
);

/** How close to the bottom still counts as "at the bottom" (new rows are followed). */
const FOLLOW_SLACK_PX = 80;

/** How long a message search hit stays highlighted (M7b step 1c). */
const JUMP_HIGHLIGHT_MS = 1500;

export const MessageFlow = ({
  rows,
  peerName,
  requests,
  assistant,
  actionsFor,
  empty,
  firstUnreadId = null,
  unread = 0,
  onSeen,
  noteFor,
  deleting,
  reveal = false,
  jumpTo = null,
}: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const endVisible = useRef(false);
  const placed = useRef(false);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const handledJump = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const byId = new Map(rows.map(row => [row.messageId, row]));
  const last = rows.at(-1);
  // Follow the bottom as rows arrive and as a streamed reply grows.
  const followKey = `${rows.length}:${last ? messagePreview(last).length : 0}`;
  const hasRows = rows.length > 0;

  // The room is read only when the last message is on screen AND the window
  // has focus (M6 step 5): a message that arrived while the user looked
  // elsewhere stays unread.
  const onSeenRef = useRef(onSeen);
  useEffect(() => {
    onSeenRef.current = onSeen;
  });
  const checkSeen = () => {
    if (endVisible.current && document.hasFocus()) onSeenRef.current?.();
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || rows.length === 0) return;
    if (!placed.current) {
      // First paint: start at "New messages" when there is unread, else at the bottom.
      placed.current = true;
      if (separatorRef.current) separatorRef.current.scrollIntoView({ block: 'start' });
      else element.scrollTop = element.scrollHeight;
      return;
    }
    if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [followKey, rows.length]);

  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end) return;
    const observer = new IntersectionObserver(
      entries => {
        endVisible.current = entries.some(entry => entry.isIntersecting);
        checkSeen();
      },
      { root },
    );
    observer.observe(end);
    window.addEventListener('focus', checkSeen);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', checkSeen);
    };
    // checkSeen reads refs only.
  }, [hasRows]);

  // A row that arrives while the end is already on screen is seen at once.
  useEffect(checkSeen, [followKey]);

  // A search hit: runs after the first placement (layout effect), so it wins
  // over "start at the bottom". Waits until the row is rendered.
  const jumpId = jumpTo?.messageId ?? null;
  const jumpRequest = jumpTo?.request ?? null;
  useEffect(() => {
    if (jumpId === null || jumpRequest === handledJump.current) return;
    const target = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(jumpId)}"]`);
    if (!target) return;
    handledJump.current = jumpRequest;
    target.scrollIntoView({ block: 'center' });
    clearTimeout(flashTimer.current);
    // Off the effect's render pass, as the unread anchor in Room.tsx.
    void Promise.resolve().then(() => setFlashId(jumpId));
    flashTimer.current = setTimeout(() => setFlashId(null), JUMP_HIGHLIGHT_MS);
  }, [jumpId, jumpRequest, rows.length]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    nearBottom.current = distance <= FOLLOW_SLACK_PX;
    // The button shows once the reader is more than one screen up.
    setFarFromBottom(distance > element.clientHeight);
  };

  const jumpToBottom = () => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 pb-2" data-testid="messages">
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
                  const separator =
                    row.messageId === firstUnreadId ? (
                      <div ref={separatorRef}>
                        <NewMessagesSeparator />
                      </div>
                    ) : null;
                  if (row.direction === 'system') {
                    return (
                      <div key={row.messageId}>
                        {separator}
                        {row.content.type === 'botGreeting' ? <GreetingRow text={row.content.text} /> : <SystemRow text={systemText(row, peerName, requests)} />}
                      </div>
                    );
                  }
                  const previous = group.rows[index - 1];
                  const next = group.rows[index + 1];
                  const quoted = row.content.type === 'reply' ? byId.get(row.content.messageId) : undefined;
                  return (
                    <div key={row.messageId}>
                      {separator}
                      {/* The search-hit band. No vertical padding: it would stop the bubble's
                          top margin from collapsing and move every row. */}
                      <div
                        data-message-id={row.messageId}
                        className={cn('-mx-2 rounded-nested px-2 transition-colors duration-300', flashId === row.messageId && 'bg-selection-container-active')}
                      >
                        <MessageBubble
                          row={row}
                          quote={
                            row.content.type === 'reply'
                              ? quoted
                                ? { sender: quoted.direction === 'outgoing' ? 'You' : peerName, text: messagePreview(quoted) }
                                : { sender: peerName, text: 'Message not available' }
                              : null
                          }
                          first={separator !== null || previous?.direction !== row.direction}
                          last={next?.direction !== row.direction || next?.messageId === firstUnreadId}
                          thinking={assistant && row.direction === 'incoming' && messagePreview(row) === ''}
                          live={!assistant && row.direction === 'incoming' && isLiveFrame(row.content)}
                          deleting={deleting?.has(row.messageId) ?? false}
                          reveal={reveal}
                          actions={actionsFor(row)}
                          note={noteFor?.(row) ?? null}
                        />
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
        <div ref={endRef} className="h-px" aria-hidden />
      </div>
      {farFromBottom ? (
        <button
          type="button"
          onClick={jumpToBottom}
          aria-label={unread > 0 ? `Jump to the latest message, ${unread} unread` : 'Jump to the latest message'}
          data-testid="jump-to-bottom"
          className="absolute end-4 bottom-4 flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface-container text-fg-primary shadow-1 transition-colors hover:bg-selection-container-hover"
        >
          <ArrowDown className="size-5" aria-hidden />
          {unread > 0 ? (
            <Badge className="absolute -top-1.5 -end-1.5 h-5 min-w-5 rounded-full px-1.5 text-label-s">{unread}</Badge>
          ) : null}
        </button>
      ) : null}
    </div>
  );
};
