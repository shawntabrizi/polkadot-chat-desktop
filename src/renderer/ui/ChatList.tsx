import { MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';

import type { HexString } from '../app/bytes';
import { type ContactRow, type DraftRow, type MessageRow, type PeerId, type RequestRow, type RoomRow, db } from '../app/database';
import { ASSISTANT_PEER, ASSISTANT_USERNAME } from '../domain/assistant/assistant';
import { isLiveFrame } from '../domain/chat/content';
import { draftPreview } from '../domain/chat/drafts';
import { setRoomMuted } from '../domain/chat/messages';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { ChatRow } from './ChatRow';
import { messagePreview, systemText } from './MessageBubble';
import { formatListTime } from './format';
import { useLiveQuery } from './useLiveQuery';

export type ChatSelection = { kind: 'room'; peer: PeerId } | { kind: 'outgoing'; peer: HexString } | { kind: 'other' };

type Props = {
  selected: ChatSelection;
  onOpenRoom: (peer: PeerId) => void;
  onOpenOutgoing: (peer: HexString) => void;
};

export type ListData = {
  contacts: ContactRow[];
  rooms: Map<PeerId, RoomRow>;
  lastMessages: Map<PeerId, MessageRow>;
  requests: RequestRow[];
  drafts: Map<PeerId, DraftRow>;
};

const loadList = async (): Promise<ListData> => {
  const [contacts, rooms, requests, drafts] = await Promise.all([db.contacts.toArray(), db.rooms.toArray(), db.requests.toArray(), db.drafts.toArray()]);
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
  return {
    contacts,
    rooms: new Map(rooms.map(room => [room.peerAccountId, room])),
    lastMessages,
    requests,
    drafts: new Map(drafts.map(draft => [draft.peerId, draft])),
  };
};

/** One line without markdown marks: a list item or **bold** reads as text. */
const plainText = (text: string): string =>
  text
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A bot's live frame is status, not a message: the list says so (M7 review carry item 2). */
const TYPING = 'Typing…';

/** "You: …" for own messages, the system line for system rows. */
const previewLine = (last: MessageRow | undefined, name: string, requests: readonly RequestRow[]): string => {
  if (!last) return '';
  if (last.direction === 'system') return systemText(last, name, requests);
  if (last.direction === 'incoming' && isLiveFrame(last.content)) return TYPING;
  const text = plainText(messagePreview(last));
  if (last.direction === 'outgoing') return `You: ${text}`;
  return text === '' && last.status === 'streaming' ? 'Thinking…' : text;
};

/** What a row opens: a room, or the pending room of a request this user sent. */
export type ChatTarget = { kind: 'room'; peer: PeerId } | { kind: 'outgoing'; peer: HexString };

/** One row of the list, or of the search's "Chats and contacts" section. */
export type Row = { key: string; name: string; at: number; target: ChatTarget; render: (highlighted?: boolean) => ReactNode };

const muteOf = (room: RoomRow | undefined) =>
  room ? { muted: room.muted === true, toggle: () => void setRoomMuted(room.peerAccountId, room.muted !== true) } : undefined;

/** A draft wins over the last message until a newer message arrives (mobile). */
const previewWithDraft = (data: ListData, peer: PeerId, fallback: string): string =>
  draftPreview(data.drafts.get(peer), data.lastMessages.get(peer)?.timestamp) ?? fallback;

/**
 * The Assistant first (local, always there), then contacts and the requests
 * this user sent that wait for an answer, newest activity first. Shared by
 * the list and the ⌘↑/⌘↓/⌘1…9 shortcuts, so both see one order.
 */
const buildRows = (data: ListData, selected: ChatSelection, open: (target: ChatTarget) => void): { rows: Row[]; others: number } => {
  const assistantRoom = data.rooms.get(ASSISTANT_PEER);
  const assistantLast = data.lastMessages.get(ASSISTANT_PEER);
  const assistantTarget: ChatTarget = { kind: 'room', peer: ASSISTANT_PEER };
  const assistantRow: Row = {
    key: ASSISTANT_PEER,
    name: ASSISTANT_USERNAME,
    at: Number.POSITIVE_INFINITY,
    target: assistantTarget,
    render: highlighted => (
      <ChatRow
        key={ASSISTANT_PEER}
        testId="chat-row-assistant"
        avatar={<AssistantAvatar />}
        name={ASSISTANT_USERNAME}
        time={assistantLast ? formatListTime(assistantLast.timestamp) : null}
        preview={previewWithDraft(data, ASSISTANT_PEER, assistantLast ? previewLine(assistantLast, ASSISTANT_USERNAME, []) : 'AI, in this app')}
        unread={assistantRoom?.unreadCount ?? 0}
        selected={selected.kind === 'room' && selected.peer === ASSISTANT_PEER}
        highlighted={highlighted}
        onClick={() => open(assistantTarget)}
        mute={muteOf(assistantRoom)}
      />
    ),
  };

  const contactRows: Row[] = data.contacts.map(contact => {
    const room = data.rooms.get(contact.accountId);
    const last = data.lastMessages.get(contact.accountId);
    const requests = data.requests.filter(request => request.peerAccountId === contact.accountId);
    const target: ChatTarget = { kind: 'room', peer: contact.accountId };
    return {
      key: contact.accountId,
      name: contact.username,
      at: room?.lastMessageAt ?? contact.createdAt,
      target,
      render: highlighted => {
        const preview = previewWithDraft(data, contact.accountId, previewLine(last, contact.username, requests));
        return (
          <ChatRow
            key={contact.accountId}
            testId="chat-row"
            avatar={<PeerAvatar name={contact.username} />}
            name={contact.username}
            time={last ? formatListTime(last.timestamp) : null}
            preview={preview}
            previewTone={preview === TYPING ? 'tertiary' : 'secondary'}
            unread={room?.unreadCount ?? 0}
            selected={selected.kind === 'room' && selected.peer === contact.accountId}
            highlighted={highlighted}
            onClick={() => open(target)}
            mute={muteOf(room)}
          />
        );
      },
    };
  });

  const contactIds = new Set(data.contacts.map(contact => contact.accountId));
  const outgoingRows: Row[] = data.requests
    .filter(request => request.direction === 'outgoing' && request.status === 'pending' && !contactIds.has(request.peerAccountId))
    .map(request => {
      const target: ChatTarget = { kind: 'outgoing', peer: request.peerAccountId };
      return {
        key: `outgoing:${request.requestId}`,
        name: request.peerUsername,
        at: request.timestamp,
        target,
        render: highlighted => (
          <ChatRow
            key={`outgoing:${request.requestId}`}
            testId="chat-row-outgoing"
            avatar={<PeerAvatar name={request.peerUsername} />}
            name={request.peerUsername}
            time={formatListTime(request.timestamp)}
            preview="Request message sent"
            unread={0}
            selected={selected.kind === 'outgoing' && selected.peer === request.peerAccountId}
            highlighted={highlighted}
            onClick={() => open(target)}
          />
        ),
      };
    });

  const others = [...contactRows, ...outgoingRows].sort((a, b) => b.at - a.at);
  return { rows: [assistantRow, ...others], others: others.length };
};

/** The list's order, for the keyboard shortcuts. */
export const useChatOrder = (): ChatTarget[] => {
  const data = useLiveQuery(loadList, []);
  if (!data) return [];
  return buildRows(data, { kind: 'other' }, () => undefined).rows.map(row => row.target);
};

/**
 * The list's rows in the list's order, and the data they came from: the
 * search's "Chats and contacts" and "Recent" sections, and the peer names of
 * its message hits.
 */
export const useChatRows = (selected: ChatSelection, open: (target: ChatTarget) => void): { rows: Row[]; data: ListData } | undefined => {
  const data = useLiveQuery(loadList, []);
  if (!data) return undefined;
  return { rows: buildRows(data, selected, open).rows, data };
};

export const ChatList = ({ selected, onOpenRoom, onOpenOutgoing }: Props) => {
  const data = useLiveQuery(loadList, []);
  if (!data) return null;
  const { rows, others } = buildRows(data, selected, target => (target.kind === 'room' ? onOpenRoom(target.peer) : onOpenOutgoing(target.peer)));

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(row => row.render())}
      {others === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <MessagesSquare className="mb-2 size-6 text-fg-tertiary" aria-hidden />
          <p className="text-label-m text-fg-primary">No active chats</p>
          <p className="text-body-s text-fg-secondary">Start a conversation with someone by typing their username</p>
        </div>
      ) : null}
    </div>
  );
};
