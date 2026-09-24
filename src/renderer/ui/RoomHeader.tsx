import type { ReactNode } from 'react';

import type { PeerTyping } from '../domain/chat/signals';

type Props = {
  avatar: ReactNode;
  name: string;
  /** A quiet line under the name; nothing when there is nothing to say. */
  status?: ReactNode;
  /** A spec 0008 bot badge after the name. */
  badge?: ReactNode;
  /** M12e: the username next to a nickname, in the tertiary tone. */
  nameNote?: string;
  /** M12e: shown in place of the title while the nickname is edited. */
  titleEditor?: ReactNode;
  /** Right-aligned actions. */
  children?: ReactNode;
};

/** The words for a peer's spec 0005 typing state (header and chat list). */
export const typingText = (typing: PeerTyping): string => (typing.kind === 'working' ? 'working…' : 'typing…');

/** "typing…" / "working…" with a three-dot pulse, in the caption style (M9 step 5). */
export const TypingLine = ({ typing }: { typing: PeerTyping }) => (
  <span className="inline-flex items-center gap-1.5 text-caption text-fg-tertiary" role="status" data-testid="typing-indicator" data-kind={typing.kind}>
    {typingText(typing)}
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="size-1 animate-pulse rounded-full bg-current" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
    </span>
  </span>
);

export const RoomHeader = ({ avatar, name, status, badge, nameNote, titleEditor, children }: Props) => (
  <header className="flex h-16 shrink-0 items-center gap-3 px-4">
    {avatar}
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        {titleEditor ?? (
          <>
            <h2 className="truncate text-heading-m text-fg-primary" data-testid="room-title">
              {name}
            </h2>
            {nameNote ? (
              <span className="truncate text-body-m text-fg-tertiary" data-testid="room-username">
                {nameNote}
              </span>
            ) : null}
          </>
        )}
        {badge}
      </div>
      {status ? <p className="truncate text-body-s text-fg-secondary">{status}</p> : null}
    </div>
    {children}
  </header>
);
