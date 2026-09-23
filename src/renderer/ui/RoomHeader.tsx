import type { ReactNode } from 'react';

type Props = {
  avatar: ReactNode;
  name: string;
  /** A quiet line under the name; nothing when there is nothing to say. */
  status?: ReactNode;
  /** Right-aligned actions. */
  children?: ReactNode;
};

export const RoomHeader = ({ avatar, name, status, children }: Props) => (
  <header className="flex h-16 shrink-0 items-center gap-3 px-4">
    {avatar}
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-heading-m text-fg-primary" data-testid="room-title">
        {name}
      </h2>
      {status ? <p className="truncate text-body-s text-fg-secondary">{status}</p> : null}
    </div>
    {children}
  </header>
);
