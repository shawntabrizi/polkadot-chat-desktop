import { Archive, ChevronDown, ChevronRight, MessagesSquare } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { HexString } from '../app/bytes';
import {
  type BlockedRow,
  type ContactRow,
  type DraftRow,
  type GroupRow,
  type MessageRow,
  type PeerId,
  type PeerInfoRow,
  type RequestRow,
  type RoomRow,
  db,
  groupPeerOf,
} from '../app/database';
import { ASSISTANT_PEER, ASSISTANT_USERNAME } from '../domain/assistant/assistant';
import { isLiveFrame } from '../domain/chat/content';
import { displayName } from '../domain/chat/chatActions';
import { groupDisplayName, readSelfAccount } from '../domain/chat/groupNames';
import { draftPreview } from '../domain/chat/drafts';
import { clearKey, deleteKey, withdrawKey } from '../domain/chat/undo';
import { DEMO_NO_ANSWER_MS } from '../domain/demo/demo';
import { FAUCET_INFO, FAUCET_PEER, FAUCET_USERNAME } from '../domain/faucet/faucet';
import type { PeerTyping, TypingStore } from '../domain/chat/signals';

import { AssistantAvatar, GroupAvatar, PeerAvatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { ChatRow } from './ChatRow';
import { FaucetAvatar } from './FaucetRoom';
import { messagePreview, systemText } from './MessageBubble';
import { typingText } from './RoomHeader';
import { ChatMenuItems, type ForwardTarget, usePending } from './chatActions';
import { formatAgo, formatListTime } from './format';
import { useLiveQuery } from './useLiveQuery';

export type ChatSelection = { kind: 'room'; peer: PeerId } | { kind: 'outgoing'; peer: HexString } | { kind: 'other' };

type Props = {
  selected: ChatSelection;
  onOpenRoom: (peer: PeerId) => void;
  onOpenOutgoing: (peer: HexString) => void;
  /** Spec 0005 typing states: a row shows "typing…" / "working…" while one is active. */
  typing?: TypingStore;
};

// A stable snapshot: useSyncExternalStore re-renders on every new object.
const NO_TYPING: ReadonlyMap<PeerId, PeerTyping> = new Map();
const noTyping = { subscribe: () => () => undefined, snapshot: () => NO_TYPING };

export type ListData = {
  contacts: ContactRow[];
  rooms: Map<PeerId, RoomRow>;
  lastMessages: Map<PeerId, MessageRow>;
  requests: RequestRow[];
  drafts: Map<PeerId, DraftRow>;
  /** Spec 0008 info per peer: the bot badge and the search's Bots section. */
  peerInfo: Map<PeerId, PeerInfoRow>;
  /** Spec 0009 groups this client is (or was) in. */
  groups: GroupRow[];
  /** M12e: peers this device blocked (the menu offers Unblock). */
  blocked: Map<HexString, BlockedRow>;
  /** Our identity account: an unnamed group's derived name leaves it out. */
  self: HexString | null;
};

/** Everything the list shows, read in one go (exported for the specs). */
export const loadList = async (): Promise<ListData> => {
  const [contacts, rooms, requests, drafts, peerInfo, groups, blocked, self] = await Promise.all([
    db.contacts.toArray(),
    db.rooms.toArray(),
    db.requests.toArray(),
    db.drafts.toArray(),
    db.peerInfo.toArray(),
    db.groups.toArray(),
    db.blocked.toArray(),
    readSelfAccount(),
  ]);
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
    peerInfo: new Map(peerInfo.map(row => [row.peerId, row])),
    groups,
    blocked: new Map(blocked.map(row => [row.accountId, row])),
    self,
  };
};

/** "3 members" (spec 0009 list row and header). */
export const memberCount = (group: GroupRow): string => `${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`;

/** A group's last line: "alice: …", "You: …", a roster event, or the member count before anything is said. */
const groupPreview = (group: GroupRow, last: MessageRow | undefined): string => {
  if (!last) return memberCount(group);
  if (last.direction === 'system') return messagePreview(last);
  const text = plainText(messagePreview(last));
  if (last.direction === 'outgoing') return `You: ${text}`;
  const sender = group.members.find(member => member.account === last.senderAccountId)?.username;
  return sender ? `${sender}: ${text}` : text;
};

/** The badge of a peer that described itself (spec 0008). */
const badgeOf = (data: ListData, peer: PeerId) => {
  const info = data.peerInfo.get(peer)?.botInfo;
  return info ? <BotBadge kind={info.kind} /> : undefined;
};

/** One line without markdown marks: a list item or **bold** reads as text. */
const plainText = (text: string): string =>
  text
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A bot's live frame is status, not a message: the list says so (M7 review
 * carry item 2). Lower case since M9, the same word as a spec 0005 hint.
 */
const TYPING = 'typing…';

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

/**
 * One row of the list, or of the search's "Chats and contacts" section.
 * `username` is set when the name is a nickname (M12e): the search matches both.
 */
export type Row = {
  key: string;
  name: string;
  username?: string;
  at: number;
  target: ChatTarget;
  /** M12e: pinned rows go first, in the order they were pinned. */
  pinnedAt?: number;
  /** M12e: in the Archived section. */
  archived?: boolean;
  render: (highlighted?: boolean) => ReactNode;
};

/** What a room row shows of its local state (M12e). */
const stateOf = (room: RoomRow | undefined) => ({
  muted: room?.muted === true,
  pinned: room?.pinnedAt !== undefined && room.archived !== true,
  markedUnread: room?.markedUnread === true,
});

/** A draft wins over the last message until a newer message arrives (mobile). */
const previewWithDraft = (data: ListData, peer: PeerId, fallback: string): string =>
  draftPreview(data.drafts.get(peer), data.lastMessages.get(peer)?.timestamp) ?? fallback;

/**
 * A pending outgoing request (M12e): how long it has waited. The first 15 s
 * read "Sent · just now", as the demo row does (M12i review): "No answer yet"
 * a second after sending reads as a failure.
 */
export const outgoingPreview = (sentAt: number, now: number = Date.now()): string =>
  now - sentAt < DEMO_NO_ANSWER_MS ? 'Sent · just now' : `No answer yet · sent ${formatAgo(sentAt, now)}`;

/**
 * The list's clock for pending requests: moves when the youngest one passes
 * 15 s, so its row turns to "No answer yet" on its own, and catches up on any
 * change of the list's data (as the ages did when they read the time in render).
 */
export const useSentClock = (data: Pick<ListData, 'requests'> | undefined): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const current = Date.now();
    const turns = (data?.requests ?? [])
      .filter(r => r.direction === 'outgoing' && r.status === 'pending' && current - r.timestamp < DEMO_NO_ANSWER_MS)
      .map(r => r.timestamp + DEMO_NO_ANSWER_MS - current + 50);
    if (current - now > 1_000) turns.push(0);
    if (turns.length === 0) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...turns)));
    return () => clearTimeout(timer);
  }, [data, now]);
  return now;
};

const NO_PENDING: ReadonlySet<string> = new Set();

/** The rows of the list: the main part, and the "Archived" section (M12e). */
export type ListRows = { rows: Row[]; archived: Row[]; others: number };

/** Pinned first in pin order, then by the newest activity. */
const byPinThenActivity = (a: Row, b: Row): number => {
  if (a.pinnedAt !== undefined || b.pinnedAt !== undefined) {
    if (a.pinnedAt === undefined) return 1;
    if (b.pinnedAt === undefined) return -1;
    return a.pinnedAt - b.pinnedAt;
  }
  return b.at - a.at;
};

/**
 * Pinned chats first (M12f), then the Assistant and the Faucet (local, always there), then contacts and the requests
 * this user sent that wait for an answer, newest activity first. Shared by
 * the list and the ⌘↑/⌘↓/⌘1…9 shortcuts, so both see one order.
 */
export const buildRows = (
  data: ListData,
  selected: ChatSelection,
  open: (target: ChatTarget) => void,
  typing: ReadonlyMap<PeerId, PeerTyping> = new Map(),
  pending: ReadonlySet<string> = NO_PENDING,
  now: number = Date.now(),
): ListRows => {
  // A chat whose delete (or a request whose withdraw) waits out its Undo time is hidden;
  // a room whose history is being cleared shows no last message (M12e).
  const lastOf = (peer: PeerId): MessageRow | undefined => (pending.has(clearKey(peer)) ? undefined : data.lastMessages.get(peer));
  const assistantRoom = data.rooms.get(ASSISTANT_PEER);
  const assistantLast = lastOf(ASSISTANT_PEER);
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
        {...stateOf(assistantRoom)}
        pinned={false}
        menu={assistantRoom ? <ChatMenuItems subject={{ peer: ASSISTANT_PEER, name: ASSISTANT_USERNAME, kind: 'assistant', room: assistantRoom }} /> : undefined}
      />
    ),
  };

  // The Faucet exists once App seeded its room (M10 step 6).
  const faucetRoom = data.rooms.get(FAUCET_PEER);
  const faucetLast = lastOf(FAUCET_PEER);
  const faucetTarget: ChatTarget = { kind: 'room', peer: FAUCET_PEER };
  const faucetRow: Row | null = faucetRoom
    ? {
        key: FAUCET_PEER,
        name: FAUCET_USERNAME,
        at: Number.POSITIVE_INFINITY,
        target: faucetTarget,
        render: highlighted => (
          <ChatRow
            key={FAUCET_PEER}
            testId="chat-row-faucet"
            avatar={<FaucetAvatar />}
            name={FAUCET_USERNAME}
            badge={<BotBadge kind={FAUCET_INFO.kind} />}
            time={faucetLast ? formatListTime(faucetLast.timestamp) : null}
            preview={FAUCET_INFO.description}
            unread={faucetRoom.unreadCount}
            selected={selected.kind === 'room' && selected.peer === FAUCET_PEER}
            highlighted={highlighted}
            onClick={() => open(faucetTarget)}
            {...stateOf(faucetRoom)}
            pinned={false}
            menu={<ChatMenuItems subject={{ peer: FAUCET_PEER, name: FAUCET_USERNAME, kind: 'faucet', room: faucetRoom }} />}
          />
        ),
      }
    : null;

  // A contact without a room is a chat deleted on this device (M12e): it comes back with the peer's next message.
  const contactRows: Row[] = data.contacts
    .filter(contact => data.rooms.has(contact.accountId) && !pending.has(deleteKey(contact.accountId)))
    .map(contact => {
      const room = data.rooms.get(contact.accountId);
      const last = lastOf(contact.accountId);
      const requests = data.requests.filter(request => request.peerAccountId === contact.accountId);
      const target: ChatTarget = { kind: 'room', peer: contact.accountId };
      const name = displayName(contact);
      return {
        key: contact.accountId,
        name,
        ...(contact.nickname ? { username: contact.username } : {}),
        at: room?.lastMessageAt ?? contact.createdAt,
        target,
        archived: room?.archived === true,
        ...(room?.pinnedAt !== undefined && room.archived !== true ? { pinnedAt: room.pinnedAt } : {}),
        render: (highlighted?: boolean) => {
          const hint = typing.get(contact.accountId);
          // A live typing hint wins over the draft and the last message.
          const preview = hint ? typingText(hint) : previewWithDraft(data, contact.accountId, previewLine(last, name, requests));
          const status = hint !== undefined || preview === TYPING;
          return (
            <ChatRow
              key={contact.accountId}
              testId="chat-row"
              avatar={<PeerAvatar name={contact.username} />}
              name={name}
              nameNote={contact.nickname ? contact.username : undefined}
              badge={badgeOf(data, contact.accountId)}
              time={last ? formatListTime(last.timestamp) : null}
              preview={preview}
              previewTone={status ? 'tertiary' : 'secondary'}
              unread={room?.unreadCount ?? 0}
              selected={selected.kind === 'room' && selected.peer === contact.accountId}
              highlighted={highlighted}
              onClick={() => open(target)}
              {...stateOf(room)}
              menu={
                <ChatMenuItems
                  subject={{
                    peer: contact.accountId,
                    name,
                    kind: 'contact',
                    room,
                    contact: { accountId: contact.accountId, username: contact.username, blocked: data.blocked.has(contact.accountId) },
                  }}
                />
              }
            />
          );
        },
      };
    });

  const groupRows: Row[] = data.groups
    .filter(group => !pending.has(deleteKey(groupPeerOf(group.id))))
    .map(group => {
      const peer = groupPeerOf(group.id);
      const room = data.rooms.get(peer);
      const last = lastOf(peer);
      const target: ChatTarget = { kind: 'room', peer };
      // Owner ask 2026-09-24: an unnamed group shows (and is found by) its members' names.
      const name = groupDisplayName(group, data.self, data.contacts);
      return {
        key: peer,
        name,
        at: room && room.lastMessageAt > 0 ? room.lastMessageAt : group.createdAt,
        target,
        archived: room?.archived === true,
        ...(room?.pinnedAt !== undefined && room.archived !== true ? { pinnedAt: room.pinnedAt } : {}),
        render: (highlighted?: boolean) => (
          <ChatRow
            key={peer}
            testId="chat-row-group"
            avatar={<GroupAvatar name={name} />}
            name={name}
            time={last ? formatListTime(last.timestamp) : null}
            preview={previewWithDraft(data, peer, groupPreview(group, last))}
            unread={room?.unreadCount ?? 0}
            selected={selected.kind === 'room' && selected.peer === peer}
            highlighted={highlighted}
            onClick={() => open(target)}
            {...stateOf(room)}
            menu={<ChatMenuItems subject={{ peer, name, kind: 'group', room, member: group.self === 'member' }} />}
          />
        ),
      };
    });

  const contactIds = new Set(data.contacts.map(contact => contact.accountId));
  const outgoingRows: Row[] = data.requests
    .filter(
      request =>
        request.direction === 'outgoing' &&
        request.status === 'pending' &&
        !contactIds.has(request.peerAccountId) &&
        !pending.has(withdrawKey(request.peerAccountId)) &&
        !pending.has(deleteKey(request.peerAccountId)),
    )
    .map(request => {
      const target: ChatTarget = { kind: 'outgoing', peer: request.peerAccountId };
      return {
        key: `outgoing:${request.requestId}`,
        name: request.peerUsername,
        at: request.timestamp,
        target,
        archived: false,
        render: (highlighted?: boolean) => (
          <ChatRow
            key={`outgoing:${request.requestId}`}
            testId="chat-row-outgoing"
            avatar={<PeerAvatar name={request.peerUsername} />}
            name={request.peerUsername}
            time={formatListTime(request.timestamp)}
            preview={outgoingPreview(request.timestamp, now)}
            previewTone="tertiary"
            unread={0}
            selected={selected.kind === 'outgoing' && selected.peer === request.peerAccountId}
            highlighted={highlighted}
            onClick={() => open(target)}
            menu={<ChatMenuItems subject={{ peer: request.peerAccountId, name: request.peerUsername, kind: 'outgoing' }} />}
          />
        ),
      };
    });

  const all = [...contactRows, ...groupRows, ...outgoingRows];
  const others = all.filter(row => !row.archived).sort(byPinThenActivity);
  const archived = all.filter(row => row.archived).sort((a, b) => b.at - a.at);
  // M12f: pinned means top, so pinned chats sit above the Assistant and the Faucet.
  const pinned = others.filter(row => row.pinnedAt !== undefined);
  const rest = others.filter(row => row.pinnedAt === undefined);
  return { rows: [...pinned, assistantRow, ...(faucetRow ? [faucetRow] : []), ...rest], archived, others: others.length };
};

/** The list's order, for the keyboard shortcuts (the Archived section is not in it). */
export const useChatOrder = (): ChatTarget[] => {
  const data = useLiveQuery(loadList, []);
  const pending = usePending();
  if (!data) return [];
  return buildRows(data, { kind: 'other' }, () => undefined, undefined, pending).rows.map(row => row.target);
};

/**
 * The list's rows in the list's order, archived ones last, and the data they
 * came from: the search's "Chats and contacts" and "Recent" sections, and the
 * peer names of its message hits.
 */
export const useChatRows = (selected: ChatSelection, open: (target: ChatTarget) => void): { rows: Row[]; data: ListData } | undefined => {
  const data = useLiveQuery(loadList, []);
  const pending = usePending();
  if (!data) return undefined;
  const built = buildRows(data, selected, open, undefined, pending);
  return { rows: [...built.rows, ...built.archived], data };
};

/**
 * Where a message can be forwarded (M12e): contacts with a chat on this
 * device that are not blocked, and groups this identity is in, newest first.
 * The same array while the targets stay the same, so the rooms that read it
 * do not re-render for nothing.
 */
export const useForwardTargets = (): readonly ForwardTarget[] => {
  const data = useLiveQuery(loadList, []);
  const targets: ForwardTarget[] = [];
  if (data) {
    const at = (peer: PeerId) => data.rooms.get(peer)?.lastMessageAt ?? 0;
    const entries = [
      ...data.contacts.filter(contact => data.rooms.has(contact.accountId) && !data.blocked.has(contact.accountId)).map(contact => ({ peer: contact.accountId as PeerId, name: displayName(contact) })),
      ...data.groups.filter(group => group.self === 'member').map(group => ({ peer: groupPeerOf(group.id) as PeerId, name: groupDisplayName(group, data.self, data.contacts) })),
    ];
    targets.push(...entries.sort((a, b) => at(b.peer) - at(a.peer)));
  }
  const key = JSON.stringify(targets);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the targets changed
  return useMemo(() => targets, [key]);
};

/** The collapsed "Archived" section at the bottom (M12e): its unread still counts in the badge. */
const ArchivedSection = ({ rows, unread }: { rows: Row[]; unread: number }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-2 flex flex-col gap-0.5" aria-label="Archived" data-testid="archived-section">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        data-testid="archived-toggle"
        className="flex cursor-pointer items-center gap-2 rounded-nested px-2 py-2 text-left transition-colors hover:bg-selection-container-hover"
      >
        <Archive className="size-4 text-fg-tertiary" aria-hidden />
        <span className="flex-1 text-label-m text-fg-secondary">
          Archived <span className="text-fg-tertiary">· {rows.length}</span>
        </span>
        {unread > 0 ? <span className="text-label-s text-fg-tertiary" aria-label={`${unread} unread in archived chats`}>{unread}</span> : null}
        {open ? <ChevronDown className="size-4 text-fg-tertiary" aria-hidden /> : <ChevronRight className="size-4 text-fg-tertiary" aria-hidden />}
      </button>
      {open ? rows.map(row => row.render()) : null}
    </section>
  );
};

export const ChatList = ({ selected, onOpenRoom, onOpenOutgoing, typing }: Props) => {
  const data = useLiveQuery(loadList, []);
  const store = typing ?? noTyping;
  const typingStates = useSyncExternalStore(store.subscribe, store.snapshot);
  const pending = usePending();
  const now = useSentClock(data);
  if (!data) return null;
  const { rows, archived, others } = buildRows(
    data,
    selected,
    target => (target.kind === 'room' ? onOpenRoom(target.peer) : onOpenOutgoing(target.peer)),
    typingStates,
    pending,
    now,
  );
  const archivedUnread = archived.reduce((sum, row) => {
    const room = row.target.kind === 'room' ? data.rooms.get(row.target.peer) : undefined;
    return sum + (room?.muted ? 0 : (room?.unreadCount ?? 0));
  }, 0);

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(row => row.render())}
      {others === 0 && archived.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <MessagesSquare className="mb-2 size-6 text-fg-tertiary" aria-hidden />
          <p className="text-label-m text-fg-primary">No active chats</p>
          <p className="text-body-s text-fg-secondary">Start a conversation with someone by typing their username</p>
        </div>
      ) : null}
      {archived.length > 0 ? <ArchivedSection rows={archived} unread={archivedUnread} /> : null}
    </div>
  );
};
