// Layout from .refs/polkadot-desktop/src/features/chat/ui/partials/MessageInput.tsx
// (2026-09-23): a growing field, a round send button, a reply/edit card above.

import { SendHorizontal, Square, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';

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
};

export const Composer = ({ draft, onDraft, onSend, context, sendDisabled = false, onStop, placeholder = 'Write a message…', sendLabel = 'Send' }: Props) => {
  const field = useRef<HTMLTextAreaElement>(null);

  // Reply and edit put the cursor in the field.
  useEffect(() => {
    if (context) field.current?.focus();
  }, [context]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim() && !sendDisabled) onSend();
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
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-full"
          aria-label={sendLabel}
          disabled={!draft.trim() || sendDisabled}
          onClick={onSend}
        >
          <SendHorizontal className="size-5" />
        </Button>
      </div>
    </div>
  );
};
