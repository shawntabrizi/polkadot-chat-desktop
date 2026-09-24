// Geometry from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageBubble.tsx,
// ReactionPills.tsx and QuickReactionRow.tsx (2026-09-23), rebuilt on the design
// system tokens and shadcn DropdownMenu; no tr-ui.

import { Check, CheckCheck, CircleAlert, Clock, Copy, Forward, MoreHorizontal, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { type ReactNode, memo, useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { MessageRow, Reaction, RequestRow } from '../app/database';
import type { ReplyStream } from '../domain/assistant/replyStream';
import { keyboardOf, liveFrameText, previewOf } from '../domain/chat/content';
import { renderMarkdown } from '../domain/markdown/markdown';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import { AttachmentBody } from './Attachments';
import { type ButtonPosition, ButtonKeyboard, type KeyboardActions, UrlConfirmStrip } from './ButtonKeyboard';
import { ReferenceBody } from './Transactions';
import { type ForwardTarget, useChatActions } from './chatActionsContext';
import { formatClock } from './format';
import { useTypingReveal } from './reveal';
import { streamingView } from './streamingFence';

import { toButtonWire } from '../../shared/buttonsBlock';

/** Two chip-shaped placeholders where a streaming reply's buttons will be (no text, a shimmer). */
export const KeyboardPlaceholder = () => (
  <div className="flex gap-1.5 pt-1" data-testid="keyboard-placeholder" aria-label="Buttons are on their way">
    <span className="h-8 w-24 animate-pulse rounded-medium bg-surface-nested" data-testid="chip-placeholder" />
    <span className="h-8 w-20 animate-pulse rounded-medium bg-surface-nested" data-testid="chip-placeholder" />
  </div>
);

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

export const SystemRow = ({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) => (
  <div className="flex justify-center py-2" data-testid="message-system" data-tone={tone}>
    <span className={cn('rounded-full bg-surface-nested px-3 py-1 text-label-s', tone === 'error' ? 'text-fg-error' : 'text-fg-secondary')}>{text}</span>
  </div>
);

/**
 * A bot's spec 0008 greeting: system-style (centred, quiet, no bubble, no
 * actions), but it can run to 280 characters, so a block, not a pill.
 */
export const GreetingRow = ({ text }: { text: string }) => (
  <div className="flex justify-center py-2" data-testid="bot-greeting">
    <p className="max-w-md rounded-nested bg-surface-nested px-4 py-2 text-center text-body-s whitespace-pre-wrap text-fg-secondary">{text}</p>
  </div>
);

export const DateSeparator = ({ text }: { text: string }) => (
  <div className="flex justify-center pt-4 pb-2">
    <span className="text-label-s text-fg-tertiary">{text}</span>
  </div>
);

/**
 * Own-message ticks: Clock sending → Check sent → CheckCheck delivered →
 * CheckCheck in `text-fg-link` when the peer's spec 0005 `seen` arrived
 * (docs/decisions.md M9: link, not success, for contrast on both bubbles).
 */
const StatusIcon = ({ status, seenAt }: { status: MessageRow['status']; seenAt: number | undefined }) => {
  if (seenAt !== undefined && status !== 'failed') {
    const label = `Seen ${formatClock(seenAt)}`;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" data-testid="seen-tick" aria-label={label}>
            <CheckCheck className="size-3.5 text-fg-link" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
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
  /** Inline content under the bubble: the spec 0007 signing strip of a pressed `tx` button. */
  below?: ReactNode;
  /** M12g: the bubble's content in place of its text and keyboard (the requester's own request). */
  body?: ReactNode;
  /** M12g: a payment reference's line in place of the note ("Sent 1 PAS to bob.02 · in block #…"). */
  referenceText?: string | null;
  /** M12e: send a copy of the text to another chat (the Forward submenu lists the chats). */
  forward?: (target: ForwardTarget) => void;
  /** M16b, a private group: pin or unpin this message for every member (the group state). */
  pin?: { pinned: boolean; run: () => void };
};

/**
 * The chats a message can go to, read only while the Forward submenu is open,
 * so a change of the list does not re-render every bubble.
 */
const ForwardItems = ({ from, onPick }: { from: string; onPick: (target: ForwardTarget) => void }) => {
  const targets = useChatActions().targets.filter(target => target.peer !== from);
  if (targets.length === 0) return <p className="px-2 py-1.5 text-body-s text-fg-tertiary">No other chat yet</p>;
  return (
    <>
      {targets.map(target => (
        <DropdownMenuItem key={target.peer} onSelect={() => onPick(target)} data-testid="forward-target">
          <span className="max-w-56 truncate">{target.label ?? target.name}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
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
  /** A group room (spec 0009): who sent this incoming message; shown on the first bubble of a run. */
  sender?: string | null;
  /** The Assistant's in-memory reply text: a streaming reply paints from here, not from its row (M12d). */
  stream?: ReplyStream;
  /** Called after a streaming reply painted more text, so the room can follow the bottom. */
  onGrow?: () => void;
};

const noSubscription = () => () => undefined;

const textOf = (row: MessageRow): string | null =>
  row.content.type === 'text' || row.content.type === 'reply' || row.content.type === 'buttons'
    ? row.content.text
    : row.content.type === 'richText'
      ? row.content.text
      : row.content.type === 'attachment'
        ? row.content.caption
        : null;

const Bubble = ({ row, quote, first, last, thinking = false, live = false, deleting = false, reveal = false, actions, note = null, sender = null, stream, onGrow }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<(ButtonPosition & { url: string }) | null>(null);
  const own = row.direction === 'outgoing';
  const streaming = row.status === 'streaming';
  // A streaming Assistant reply: its text comes from memory, repainted once per frame.
  const streamId = stream && streaming && !own ? row.messageId : null;
  const subscribe = useCallback((listener: () => void) => (stream && streamId ? stream.subscribe(streamId, listener) : noSubscription()), [stream, streamId]);
  const snapshot = () => (stream && streamId ? stream.text(streamId) : undefined);
  const streamed = useSyncExternalStore(subscribe, snapshot, snapshot);
  const text = streamed ?? textOf(row);
  const deleted = row.content.type === 'deleted';
  const markdown = !own && (row.content.type === 'text' || row.content.type === 'buttons');
  // A reply still arriving: a client directive fence (```buttons) is never shown raw.
  const view = markdown && streaming ? streamingView(text ?? '') : null;
  const painted = useTypingReveal({ text: view ? view.text : (text ?? ''), live, streaming }, reveal && !own);
  // Incoming text (contacts, bots and the Assistant write markdown) renders as
  // markdown, sanitized by renderMarkdown; parsed again only when the painted text changes.
  const html = useMemo(() => (markdown ? renderMarkdown(painted) : ''), [markdown, painted]);
  useLayoutEffect(() => {
    if (streamId) onGrow?.();
  }, [streamId, painted, onGrow]);
  // Reactions on a deleted message are not shown (RFC-0003).
  const reactions = deleted || live ? [] : countReactions(row.reactions);
  const quiet = cn('text-body-m italic', own ? 'text-fg-tertiary-inverted' : 'text-fg-tertiary');

  // Tighter corners on the sender's side inside a run; a 4px tail on the last.
  const corners = own
    ? cn('rounded-container', !first && 'rounded-se-small', last ? 'rounded-ee-xs' : 'rounded-ee-small')
    : cn('rounded-container', !first && 'rounded-ss-small', last ? 'rounded-es-xs' : 'rounded-es-small');

  const body = (() => {
    if (thinking && !text) return <span className="animate-pulse text-body-m text-fg-tertiary">Thinking…</span>;
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
    if (actions?.body) return actions.body;
    if (row.content.type === 'attachment') return <AttachmentBody row={row} own={own} />;
    if (row.content.type === 'transactionReference') return <ReferenceBody reference={row.content.reference} own={own} line={actions?.referenceText ?? null} />;
    // One element from the first streamed word to the finished reply (M12d): completion must not re-create it.
    if (markdown) return <div className="md text-body-m" data-testid="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
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
    row.content.type === 'buttons' && !actions?.body && !(row.content.oneShot && row.content.pressed) && row.content.rows.some(r => r.length > 0)
      ? row.content.rows
      : null;
  // One place for the buttons: the placeholders and the keyboard of a
  // streaming reply, then the finished keyboard, in the same slot, so
  // completion updates the keyboard instead of mounting a new one.
  const streamedRows = view?.block ? keyboardOf(view.block.rows.map(r => r.map(toButtonWire))) : null;
  const keyboardSlot = deleting ? null : view?.placeholder ? (
    <KeyboardPlaceholder />
  ) : streamedRows ? (
    <ButtonKeyboard rows={streamedRows} keyboard={null} onAskUrl={() => undefined} confirming={null} />
  ) : keyboardRows ? (
    <ButtonKeyboard rows={keyboardRows} keyboard={actions?.keyboard ?? null} onAskUrl={(position, url) => setConfirm({ ...position, url })} confirming={confirm} />
  ) : null;

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
          {actions.forward ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="forward-message">
                <Forward /> Forward
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                <ForwardItems from={row.peerAccountId} onPick={target => actions.forward?.(target)} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {actions.pin ? (
            <DropdownMenuItem onSelect={actions.pin.run} data-testid="pin-message">
              {actions.pin.pinned ? <PinOff /> : <Pin />} {actions.pin.pinned ? 'Unpin' : 'Pin'}
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
          {sender && first && !own ? (
            <p className="truncate text-label-s text-fg-secondary" data-testid="sender-name">
              {sender}
            </p>
          ) : null}
          {row.forwardedFrom ? (
            <p className={cn('truncate text-label-s', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')} data-testid="forwarded-from">
              Forwarded from {row.forwardedFrom}
            </p>
          ) : null}
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
          {keyboardSlot}
          {live ? null : (
            <div className={cn('flex items-center justify-end gap-1 text-caption', own ? 'text-fg-secondary-inverted' : 'text-fg-tertiary')}>
              {row.editedAt && !deleted ? <span>(edited)</span> : null}
              <span>{formatClock(row.timestamp)}</span>
              {own && !deleted ? <StatusIcon status={row.status} seenAt={row.seenAt} /> : null}
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
        {actions?.below ?? null}
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

/** The quote is built fresh by the room on every render; equal text is the same quote. */
const sameProps = (a: Props, b: Props): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Props)[]);
  for (const key of keys) {
    if (key === 'quote') {
      if (a.quote?.sender !== b.quote?.sender || a.quote?.text !== b.quote?.text) return false;
    } else if (!Object.is(a[key], b[key])) return false;
  }
  return true;
};

/**
 * Memoized (M12d step 2): a room re-renders on every change of any row, and
 * a bubble re-renders only when its own props change (MessageFlow keeps rows
 * and actions stable).
 */
export const MessageBubble = memo(Bubble, sameProps);
