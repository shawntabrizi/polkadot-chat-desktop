import { MessagesSquare, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import type { HexString } from '../app/bytes';
import { type ContactRow, type MessageRow, type PeerId, type RequestRow, type RoomRow, db } from '../app/database';
import { ASSISTANT_PEER, ASSISTANT_USERNAME } from '../domain/assistant/assistant';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { ChatRow } from './ChatRow';
import { messagePreview, systemText } from './MessageBubble';
import { formatListTime } from './format';
import { useLiveQuery } from './useLiveQuery';

export type ChatSelection = { kind: 'room'; peer: PeerId } | { kind: 'outgoing'; peer: HexString } | { kind: 'other' };

type Props = {
  /** Filters rows by username; empty shows all. */
  query: string;
  selected: ChatSelection;
  onOpenRoom: (peer: PeerId) => void;
  onOpenOutgoing: (peer: HexString) => void;
};

type ListData = {
  contacts: ContactRow[];
  rooms: Map<PeerId, RoomRow>;
  lastMessages: Map<PeerId, MessageRow>;
  requests: RequestRow[];
};

const loadList = async (): Promise<ListData> => {
  const [contacts, rooms, requests] = await Promise.all([db.contacts.toArray(), db.rooms.toArray(), db.requests.toArray()]);
  const lastMessages = new Map<PeerId, MessageRow>();
  await Promise.all(
    rooms.map(async room => {
      const last = await db.messages
        .where('[peerAccountId+timestamp]')
        .between([room.peerAccountId, -Infinity], [room.peerAccountId, Infinity])
        .last();
      if (last) lastMessages.set(room.peerAccountId, last);
    }),
  );
  return { contacts, rooms: new Map(rooms.map(room => [room.peerAccountId, room])), lastMessages, requests };
};

/** One line without markdown marks: a list item or **bold** reads as text. */
const plainText = (text: string): string =>
  text
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** "You: …" for own messages, the system line for system rows. */
const previewLine = (last: MessageRow | undefined, name: string, requests: readonly RequestRow[]): string => {
  if (!last) return '';
  if (last.direction === 'system') return systemText(last, name, requests);
  const text = plainText(messagePreview(last));
  if (last.direction === 'outgoing') return `You: ${text}`;
  return text === '' && last.status === 'streaming' ? 'Thinking…' : text;
};

type Row = { key: string; name: string; at: number; render: () => ReactNode };

/**
 * The Assistant first (local, always there), then contacts and the requests
 * this user sent that wait for an answer, newest activity first.
 */
export const ChatList = ({ query, selected, onOpenRoom, onOpenOutgoing }: Props) => {
  const data = useLiveQuery(loadList, []);
  if (!data) return null;

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => needle === '' || name.toLowerCase().includes(needle);

  const assistantRoom = data.rooms.get(ASSISTANT_PEER);
  const assistantLast = data.lastMessages.get(ASSISTANT_PEER);
  const assistantRow: Row = {
    key: ASSISTANT_PEER,
    name: ASSISTANT_USERNAME,
    at: Number.POSITIVE_INFINITY,
    render: () => (
      <ChatRow
        key={ASSISTANT_PEER}
        testId="chat-row-assistant"
        avatar={<AssistantAvatar />}
        name={ASSISTANT_USERNAME}
        time={assistantLast ? formatListTime(assistantLast.timestamp) : null}
        preview={assistantLast ? previewLine(assistantLast, ASSISTANT_USERNAME, []) : 'AI, in this app'}
        unread={assistantRoom?.unreadCount ?? 0}
        selected={selected.kind === 'room' && selected.peer === ASSISTANT_PEER}
        onClick={() => onOpenRoom(ASSISTANT_PEER)}
      />
    ),
  };

  const contactRows: Row[] = data.contacts.map(contact => {
    const room = data.rooms.get(contact.accountId);
    const last = data.lastMessages.get(contact.accountId);
    const requests = data.requests.filter(request => request.peerAccountId === contact.accountId);
    return {
      key: contact.accountId,
      name: contact.username,
      at: room?.lastMessageAt ?? contact.createdAt,
      render: () => (
        <ChatRow
          key={contact.accountId}
          testId="chat-row"
          avatar={<PeerAvatar name={contact.username} />}
          name={contact.username}
          time={last ? formatListTime(last.timestamp) : null}
          preview={previewLine(last, contact.username, requests)}
          unread={room?.unreadCount ?? 0}
          selected={selected.kind === 'room' && selected.peer === contact.accountId}
          onClick={() => onOpenRoom(contact.accountId)}
        />
      ),
    };
  });

  const contactIds = new Set(data.contacts.map(contact => contact.accountId));
  const outgoingRows: Row[] = data.requests
    .filter(request => request.direction === 'outgoing' && request.status === 'pending' && !contactIds.has(request.peerAccountId))
    .map(request => ({
      key: `outgoing:${request.requestId}`,
      name: request.peerUsername,
      at: request.timestamp,
      render: () => (
        <ChatRow
          key={`outgoing:${request.requestId}`}
          testId="chat-row-outgoing"
          avatar={<PeerAvatar name={request.peerUsername} />}
          name={request.peerUsername}
          time={formatListTime(request.timestamp)}
          preview="Request message sent"
          unread={0}
          selected={selected.kind === 'outgoing' && selected.peer === request.peerAccountId}
          onClick={() => onOpenOutgoing(request.peerAccountId)}
        />
      ),
    }));

  const others = [...contactRows, ...outgoingRows].sort((a, b) => b.at - a.at);
  const rows = [assistantRow, ...others].filter(row => matches(row.name));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
        <SearchX className="mb-2 size-6 text-fg-tertiary" aria-hidden />
        <p className="text-label-m text-fg-primary">No results for “{query.trim()}”</p>
        <p className="text-body-s text-fg-secondary">To find someone new, use the + button.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(row => row.render())}
      {others.length === 0 && needle === '' ? (
        <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <MessagesSquare className="mb-2 size-6 text-fg-tertiary" aria-hidden />
          <p className="text-label-m text-fg-primary">No active chats</p>
          <p className="text-body-s text-fg-secondary">Start a conversation with someone by typing their username</p>
        </div>
      ) : null}
    </div>
  );
};
