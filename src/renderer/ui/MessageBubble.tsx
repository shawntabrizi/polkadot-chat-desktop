// Geometry from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageBubble.tsx,
// ReactionPills.tsx and QuickReactionRow.tsx (2026-09-23), rebuilt on the design
// system tokens and shadcn DropdownMenu; no tr-ui.

import { Check, CheckCheck, CircleAlert, Clock, Copy, MoreHorizontal, Pencil, Reply, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { MessageRow, Reaction, RequestRow } from '../app/database';
import { liveFrameText, previewOf } from '../domain/chat/content';
import { renderMarkdown } from '../domain/markdown/markdown';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';

import { type ButtonPosition, ButtonKeyboard, type KeyboardActions, UrlConfirmStrip } from './ButtonKeyboard';
import { formatClock } from './format';
import { useTypingReveal } from './reveal';

/** The eight quick reactions every Polkadot app offers (mobile-ux.md). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

/**
 * Text for a system row. `accepted:<requestId>` rows say who approved whom,
 * which the request's direction tells: our outgoing request was approved by
 * the peer; an incoming one was approved by us.
 */
export const systemText = (row: MessageRow, peerName: string, requests: readonly RequestRow[]): string => {
  switch (row.content.type) {
    case 'contactAdded': {
      const requestId = row.messageId.startsWith('accepted:') ? row.messageId.slice('accepted:'.length) : null;
      const request = requests.find(entry => entry.requestId === requestId);
      return request?.direction === 'incoming' ? 'You approved the request' : `${peerName} approved your request`;
    }
    case 'leftChat':
      return `${peerName} left the chat`;
    case 'callDeclined':
      return 'Call declined';
    case 'buttonPressed':
      return `${peerName} pressed ${row.content.label}`;
    default:
      return previewOf(row.content);
  }
};

/** One line for a quote or a chat-list preview. */
export const messagePreview = (row: MessageRow): string =>
  row.content.type === 'unsupported' ? 'Unsupported message content. Please update the app.' : previewOf(row.content);

export const SystemRow = ({ text }: { text: string }) => (
  <div className="flex justify-center py-2" data-testid="message-system">
    <span className="rounded-full bg-surface-nested px-3 py-1 text-label-s text-fg-secondary">{text}</span>
  </div>
);

export const DateSeparator = ({ text }: { text: string }) => (
  <div className="flex justify-center pt-4 pb-2">
    <span className="text-label-s text-fg-tertiary">{text}</span>
  </div>
);

const StatusIcon = ({ status }: { status: MessageRow['status'] }) => {
  switch (status) {
    case 'sending':
      return <Clock className="size-3.5 text-fg-tertiary-inverted" aria-label="Sending" />;
    case 'sent':
      return <Check className="size-3.5 text-fg-tertiary-inverted" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="size-3.5 text-fg-tertiary-inverted" aria-label="Delivered" />;
    case 'failed':
      return <CircleAlert className="size-3.5 text-fg-error" aria-label="Not sent" />;
    default:
      return null;
  }
};

type ReactionCount = { emoji: string; count: number; mine: boolean };

const countReactions = (reactions: readonly Reaction[]): ReactionCount[] => {
  const counts = new Map<string, ReactionCount>();
  for (const reaction of reactions) {
    const entry = counts.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    entry.count += 1;
    entry.mine ||= reaction.by === 'me';
    counts.set(reaction.emoji, entry);
  }
  return [...counts.values()];
};

export type BubbleActions = {
  react?: (emoji: string) => void;
  reply?: () => void;
  edit?: () => void;
  /** A failed own message: send it again with the same id. */
  retry?: () => void;
  /** "Delete for everyone" (a contact room) or "Delete" (the Assistant, local only). */
  remove?: { label: string; run: () => void };
  /** Spec 0006: presses on this message's buttons. Absent: the buttons show disabled. */
  keyboard?: KeyboardActions;
};

type Props = {
  row: MessageRow;
  /** The message a reply quotes, already resolved. */
  quote: { sender: string; text: string } | null;
  /** Place in a run of consecutive messages from one side. */
  first: boolean;
  last: boolean;
  /** An assistant reply that has no text yet. */
  thinking?: boolean;
  /** A `pca` bot's live progress frame (`isLiveFrame`): a thinking row, no time, no ticks. */
  live?: boolean;
  /** Delete was pressed and its Undo time runs. */
  deleting?: boolean;
  /** Typing reveal of an answer that just arrived (Settings → Chat). */
  reveal?: boolean;
  /** Null for a read-only bubble (a request's welcome message). */
  actions: BubbleActions | null;
  /** A quiet line under the bubble: what a running assistant reply is doing. */
  note?: string | null;
};

const textOf = (row: MessageRow): string | null =>
  row.content.type === 'text' || row.content.type === 'reply' || row.content.type === 'buttons'
    ? row.content.text
    : row.content.type === 'richText'
      ? row.content.text
      : null;

export const MessageBubble = ({ row, quote, first, last, thinking = false, live = false, deleting = false, reveal = false, actions, note = null }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<(ButtonPosition & { url: string }) | null>(null);
  const own = row.direction === 'outgoing';
  const text = textOf(row);
  const deleted = row.content.type === 'deleted';
  const painted = useTypingReveal({ text: text ?? '', live, streaming: row.status === 'streaming' }, reveal && !own);
  // Reactions on a deleted message are not shown (RFC-0003).
  const reactions = deleted || live ? [] : countReactions(row.reactions);
  const quiet = cn('text-body-m italic', own ? 'text-fg-tertiary-inverted' : 'text-fg-tertiary');

  // Tighter corners on the sender's side inside a run; a 4px tail on the last.
  const corners = own
    ? cn('rounded-container', !first && 'rounded-se-small', last ? 'rounded-ee-xs' : 'rounded-ee-small')
    : cn('rounded-container', !first && 'rounded-ss-small', last ? 'rounded-es-xs' : 'rounded-es-small');

  const body = (() => {
    if (thinking) return <span className="animate-pulse text-body-m text-fg-tertiary">Thinking…</span>;
    if (live && text !== null) {
      return (
        <p className="animate-pulse text-body-m whitespace-pre-wrap text-fg-tertiary" data-testid="live-frame">
          {liveFrameText(text)}
        </p>
      );
    }
    if (deleted) {
      return (
        <p className={quiet} data-testid="message-deleted">
          Message deleted
        </p>
      );
    }
    if (deleting) return <p className={quiet}>Deleting…</p>;
    if ((row.content.type === 'text' || row.content.type === 'buttons') && !own) {
      // Incoming text (contacts, bots and the Assistant write markdown) renders as
      // markdown, sanitized by renderMarkdown; own messages stay plain.
      return <div className="md text-body-m" data-testid="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(painted) }} />;
    }
    if (row.content.type === 'richText') {
      return (
        <>
          {row.content.text ? <p className="text-body-m whitespace-pre-wrap">{row.content.text}</p> : null}
          {row.content.attachments.length > 0 ? (
            <p className={cn('text-body-s', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')}>
              This message can only be viewed in the mobile app
            </p>
          ) : null}
        </>
      );
    }
    if (text !== null) return <p className="text-body-m whitespace-pre-wrap">{text}</p>;
    return <p className="text-body-m">{messagePreview(row)}</p>;
  })();

  // A oneShot keyboard is gone after its first press (spec 0006).
  const keyboardRows =
    row.content.type === 'buttons' && !(row.content.oneShot && row.content.pressed) && row.content.rows.some(r => r.length > 0)
      ? row.content.rows
      : null;

  const toolbar = actions ? (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-full bg-surface-container p-1 shadow-2 transition-opacity',
        'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100',
        menuOpen && 'opacity-100',
      )}
    >
      {actions.react
        ? QUICK_REACTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full text-body-m transition-colors hover:bg-selection-container-hover"
              onClick={() => actions.react?.(emoji)}
            >
              {emoji}
            </button>
          ))
        : null}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-7 rounded-full font-normal" aria-label="More actions">
            <MoreHorizontal className="size-4 text-fg-secondary" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={own ? 'end' : 'start'}>
          {actions.reply ? (
            <DropdownMenuItem onSelect={actions.reply}>
              <Reply /> Reply
            </DropdownMenuItem>
          ) : null}
          {text ? (
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(text)}>
              <Copy /> Copy text
            </DropdownMenuItem>
          ) : null}
          {actions.edit ? (
            <DropdownMenuItem onSelect={actions.edit}>
              <Pencil /> Edit
            </DropdownMenuItem>
          ) : null}
          {actions.remove ? (
            <DropdownMenuItem onSelect={actions.remove.run} data-testid="delete-message">
              <Trash2 /> {actions.remove.label}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  return (
    <div
      className={cn('group/message flex items-center gap-2', own ? 'justify-end' : 'justify-start', first ? 'mt-2' : 'mt-0.5')}
      data-testid={`message-${row.direction}`}
    >
      {own ? toolbar : null}
      <div className={cn('flex max-w-[min(520px,80%)] min-w-0 flex-col gap-1', own ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'flex max-w-full min-w-0 flex-col gap-1 px-3 py-2',
            corners,
            own ? 'bg-surface-container-inverted text-fg-primary-inverted' : 'bg-surface-nested text-fg-primary',
          )}
          data-testid="bubble"
          onContextMenu={
            actions
              ? event => {
                  event.preventDefault();
                  setMenuOpen(true);
                }
              : undefined
          }
        >
          {quote ? (
            <div
              className={cn(
                'rounded-small border-s-2 px-2 py-1',
                own ? 'border-stroke-primary-inverted bg-surface-nested-inverted' : 'border-stroke-tertiary bg-surface-container',
              )}
            >
              <p className="truncate text-label-s">{quote.sender}</p>
              <p className={cn('line-clamp-2 text-body-s', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')}>{quote.text}</p>
            </div>
          ) : null}
          <div className="min-w-0 break-words">{body}</div>
          {keyboardRows && !deleting ? (
            <ButtonKeyboard
              rows={keyboardRows}
              keyboard={actions?.keyboard ?? null}
              onAskUrl={(position, url) => setConfirm({ ...position, url })}
              confirming={confirm}
            />
          ) : null}
          {live ? null : (
            <div className={cn('flex items-center justify-end gap-1 text-caption', own ? 'text-fg-secondary-inverted' : 'text-fg-tertiary')}>
              {row.editedAt && !deleted ? <span>(edited)</span> : null}
              <span>{formatClock(row.timestamp)}</span>
              {own && !deleted ? <StatusIcon status={row.status} /> : null}
            </div>
          )}
        </div>
        {confirm && keyboardRows && actions?.keyboard ? (
          <UrlConfirmStrip
            url={confirm.url}
            onCancel={() => setConfirm(null)}
            onOpen={() => {
              actions.keyboard?.press(confirm.row, confirm.index);
              setConfirm(null);
            }}
          />
        ) : null}
        {own && row.status === 'failed' ? (
          <p className="text-caption text-fg-error" data-testid="not-sent">
            Not sent
            {actions?.retry ? (
              <>
                {' · '}
                <button type="button" className="cursor-pointer underline-offset-2 hover:underline" onClick={actions.retry}>
                  Retry
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {note ? (
          <p className="text-caption text-fg-tertiary" data-testid="assistant-activity">
            {note}
          </p>
        ) : null}
        {reactions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {reactions.map(reaction => (
              <button
                key={reaction.emoji}
                type="button"
                disabled={!actions?.react}
                aria-pressed={reaction.mine}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-label-s text-fg-primary transition-colors',
                  reaction.mine ? 'bg-action-secondary' : 'bg-surface-container',
                  actions?.react ? 'cursor-pointer hover:bg-selection-container-hover' : 'cursor-default',
                )}
                onClick={() => actions?.react?.(reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                {reaction.count > 1 ? <span className="text-fg-secondary">{reaction.count}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {own ? null : toolbar}
    </div>
  );
};
