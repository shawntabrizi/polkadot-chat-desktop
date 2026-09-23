// Layout from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageInput.tsx
// (2026-09-23): a growing field, a round send button, a reply/edit card above.

import { SendHorizontal, Square, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';

import type { SendKey } from '../app/chatPrefs';
import { isPrimaryModifier } from '../app/keyboard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  /** "Reply to <name>" / "Editing message" card above the field. */
  context: { title: string; text: string; onClose: () => void } | null;
  /** Send is off (an assistant reply is still streaming). */
  sendDisabled?: boolean;
  /** Shown while an assistant reply streams. */
  onStop?: () => void;
  placeholder?: string;
  sendLabel?: string;
  /** Enter sends (Shift+Enter: newline), or ⌘/Ctrl+Enter sends (Enter: newline). */
  sendKey?: SendKey;
  /** Up arrow in an empty field: edit your last text message. */
  onEditLast?: () => void;
  /** Esc with no reply/edit card (the draft room closes). Else Esc goes on to the app's shortcut. */
  onEscape?: () => void;
  /** An empty field may be sent (a chat request's message is optional). */
  allowEmpty?: boolean;
  /** `pill`: the send button is the view's one main action, with its label as text. */
  sendButton?: 'icon' | 'pill';
};

/** Is another text field the one with focus (then the composer does not take it)? */
const otherFieldFocused = (field: HTMLTextAreaElement | null): boolean => {
  const active = document.activeElement;
  if (!active || active === document.body || active === field) return false;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable;
};

export const Composer = ({
  draft,
  onDraft,
  onSend,
  context,
  sendDisabled = false,
  onStop,
  placeholder = 'Write a message…',
  sendLabel = 'Send',
  sendKey = 'enter',
  onEditLast,
  onEscape,
  allowEmpty = false,
  sendButton = 'icon',
}: Props) => {
  const field = useRef<HTMLTextAreaElement>(null);

  // Reply and edit put the cursor in the field.
  useEffect(() => {
    if (context) field.current?.focus();
  }, [context]);

  // The field takes focus when the room opens and when the window comes
  // back, unless another text field has it (M6 step 3).
  useEffect(() => {
    field.current?.focus();
    const onWindowFocus = () => {
      if (!otherFieldFocused(field.current)) field.current?.focus();
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, []);

  const canSend = (allowEmpty || draft.trim() !== '') && !sendDisabled;
  const send = () => {
    if (!canSend) return;
    onSend();
    field.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME composition (Japanese, Chinese, …) uses Enter to pick a word.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && context) {
      event.preventDefault();
      event.stopPropagation();
      context.onClose();
      return;
    }
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    const modified = event.altKey || event.metaKey || event.ctrlKey || event.shiftKey;
    // Plain ↑ only: ⌘↑ / ⌥↑ move between chats (Shell).
    if (event.key === 'ArrowUp' && !modified && draft === '' && onEditLast) {
      event.preventDefault();
      onEditLast();
      return;
    }
    if (event.key !== 'Enter') return;
    const primary = isPrimaryModifier(event);
    const sends = sendKey === 'enter' ? !event.shiftKey : primary;
    if (sends) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-4">
      {context ? (
        <div className="flex items-start gap-2 rounded-nested bg-surface-nested py-2 ps-3 pe-2" data-testid="composer-context">
          <div className="min-w-0 flex-1 border-s-2 border-stroke-tertiary ps-2">
            <p className="truncate text-label-s text-fg-primary">{context.title}</p>
            <p className="line-clamp-2 text-body-s text-fg-secondary">{context.text}</p>
          </div>
          <Button variant="ghost" size="icon-xs" className="rounded-full font-normal" aria-label="Cancel" onClick={context.onClose}>
            <X className="size-4 text-fg-secondary" />
          </Button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          ref={field}
          value={draft}
          onChange={event => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          // field-sizing (stock) grows the field; the cap is six lines of text-body-m.
          className="max-h-40 min-h-10 resize-none rounded-nested py-2 text-body-m md:text-body-m"
        />
        {onStop ? (
          <Button variant="secondary" className="h-10 rounded-medium text-label-m" onClick={onStop}>
            <Square className="size-4" aria-hidden /> Stop
          </Button>
        ) : null}
        {sendButton === 'pill' ? (
          <Button type="button" className="h-auto w-fit shrink-0 rounded-full px-8 py-2.5 text-label-l" disabled={!canSend} onClick={send}>
            {sendLabel}
          </Button>
        ) : (
          <Button type="button" size="icon" className="size-10 shrink-0 rounded-full" aria-label={sendLabel} disabled={!canSend} onClick={send}>
            <SendHorizontal className="size-5" />
          </Button>
        )}
      </div>
    </div>
  );
};
