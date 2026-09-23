// The unified search of the left pane (M7b) and the draft room.
// Draft room from .refs/polkadot-desktop/src/features/chat/ui/partials/DraftInvitationRoom.tsx
// (2026-09-23); strings from docs/reference/mobile-ux.md "Starting a chat".

import { SearchX, UserPlus } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { type HexString, bytesToHex } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { type MessageRow, type PeerId, isLocalPeer } from '../app/database';
import type { NetworkProfile } from '../app/network';
import { ASSISTANT_PEER, ASSISTANT_USERNAME } from '../domain/assistant/assistant';
import type { BotInfo } from '../domain/chat/content';
import type { ChatManager } from '../domain/chat/manager';
import { searchMessages } from '../domain/chat/messages';
import { FAUCET_PEER, FAUCET_USERNAME } from '../domain/faucet/faucet';
import type { IdentityLookup } from '../domain/identity/lookup';
import { type SearchResult, searchUsernames } from '../domain/identity/search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { type ChatSelection, type ChatTarget, type ListData, type Row, useChatRows } from './ChatList';
import { ChatRow } from './ChatRow';
import { Composer } from './Composer';
import { FaucetAvatar } from './FaucetRoom';
import { messagePreview } from './MessageBubble';
import { RoomHeader } from './RoomHeader';
import { formatListTime, plainError } from './format';
import {
  GLOBAL_PAGE_SIZE,
  GLOBAL_SEARCH_DELAY_MS,
  RECENT_LIMIT,
  assembleSections,
  botMatches,
  chatMatches,
  globalQuery,
  moveHighlight,
  resultKey,
  snippetOf,
} from './searchSections';
import { useLiveQuery } from './useLiveQuery';

/** The network's answer for one query; pages append on "Show more". */
type GlobalState = {
  query: string;
  results: SearchResult[];
  nextCursor: string | null;
  failed: boolean;
  loadingMore: boolean;
};

type PanelProps = {
  query: string;
  onQuery: (query: string) => void;
  /** Opened with "+" (or ⌘N): the "Type username" placeholder and the Recent section. */
  adding: boolean;
  /** Esc: clear the field and leave "+". */
  onExit: () => void;
  /** Bumped by "+", ⌘K and ⌘N: the field takes focus. */
  focusSignal: number;
  profile: NetworkProfile;
  selfIdentityAccountId: Uint8Array;
  selected: ChatSelection;
  onOpenTarget: (target: ChatTarget) => void;
  onOpenMessage: (peer: PeerId, messageId: string) => void;
  onPickGlobal: (result: SearchResult) => void;
  /** What the pane shows while the field is empty: the chat list. */
  children: ReactNode;
};

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <h2 className="px-2 pt-3 pb-1 text-overline text-fg-tertiary uppercase">{children}</h2>
);

const peerNameOf = (data: ListData | undefined, peer: PeerId): string => {
  if (peer === ASSISTANT_PEER) return ASSISTANT_USERNAME;
  if (peer === FAUCET_PEER) return FAUCET_USERNAME;
  const contact = data?.contacts.find(row => row.accountId === peer);
  if (contact) return contact.username;
  return data?.requests.find(row => row.peerAccountId === peer)?.peerUsername ?? 'Unknown';
};

/** A peer that described itself (spec 0008), for the Bots section. */
type BotHit = { key: string; peer: PeerId; username: string; info: BotInfo };

/** Every contact (and the Faucet) with a `botInfo`, matched on username, name or description. */
const botHits = (data: ListData | undefined, query: string): BotHit[] => {
  if (!data) return [];
  const hits: BotHit[] = [];
  for (const row of data.peerInfo.values()) {
    if (!row.botInfo) continue;
    const username = row.peerId === FAUCET_PEER ? FAUCET_USERNAME : data.contacts.find(contact => contact.accountId === row.peerId)?.username;
    if (username === undefined) continue;
    if (botMatches({ username, name: row.botInfo.name, description: row.botInfo.description }, query)) hits.push({ key: row.peerId, peer: row.peerId, username, info: row.botInfo });
  }
  return hits.sort((a, b) => a.username.localeCompare(b.username));
};

/**
 * The field at the top of the left pane. Empty, the pane shows the chat list
 * (`children`). With text it shows, in this order: chats and contacts
 * (local, instant), the network's username directory (after a pause and
 * three letters), and messages (local, instant). ↑/↓ move across all rows,
 * Enter opens, Esc clears.
 */
export const SearchPane = ({
  query,
  onQuery,
  adding,
  onExit,
  focusSignal,
  profile,
  selfIdentityAccountId,
  selected,
  onOpenTarget,
  onOpenMessage,
  onPickGlobal,
  children,
}: PanelProps) => {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [global, setGlobal] = useState<GlobalState | null>(null);
  const [highlight, setHighlight] = useState<{ query: string; key: string | null }>({ query: '', key: null });
  const typed = query.trim();
  const active = typed !== '' || adding;
  const prefix = globalQuery(query);

  useEffect(() => {
    if (focusSignal === 0) return;
    field.current?.focus();
    field.current?.select();
  }, [focusSignal]);

  // One network search per pause in typing: each one mines a proof of work
  // and the backend rate-limits (M7b step 1b).
  useEffect(() => {
    if (prefix === null) return;
    let live = true;
    const timer = setTimeout(() => {
      searchUsernames(profile, prefix, selfIdentityAccountId, fetch, { limit: GLOBAL_PAGE_SIZE }).then(
        page => {
          if (live) setGlobal({ query: prefix, results: page.results, nextCursor: page.nextCursor, failed: false, loadingMore: false });
        },
        () => {
          if (live) setGlobal({ query: prefix, results: [], nextCursor: null, failed: true, loadingMore: false });
        },
      );
    }, GLOBAL_SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [prefix, profile, selfIdentityAccountId]);

  const current = prefix !== null && global?.query === prefix ? global : null;
  const searching = prefix !== null && current === null;

  const showMore = () => {
    if (!current?.nextCursor || current.loadingMore) return;
    const shown = current;
    setGlobal({ ...shown, loadingMore: true });
    searchUsernames(profile, shown.query, selfIdentityAccountId, fetch, { limit: GLOBAL_PAGE_SIZE, cursor: shown.nextCursor }).then(
      page => {
        setGlobal(latest => {
          if (latest?.query !== shown.query) return latest;
          const seen = new Set(latest.results.map(hit => hit.candidateAccountId));
          return { ...latest, results: [...latest.results, ...page.results.filter(hit => !seen.has(hit.candidateAccountId))], nextCursor: page.nextCursor, loadingMore: false };
        });
      },
      () => setGlobal(latest => (latest?.query === shown.query ? { ...latest, nextCursor: null, failed: true, loadingMore: false } : latest)),
    );
  };

  const chats = useChatRows(selected, onOpenTarget);
  const messageHits = useLiveQuery(() => searchMessages(query), [query]) ?? [];

  const recent: Row[] = adding && typed === '' ? (chats?.rows ?? []).filter(row => row.target.kind === 'room' && !isLocalPeer(row.target.peer)).slice(0, RECENT_LIMIT) : [];
  const chatHits = typed === '' ? [] : (chats?.rows ?? []).filter(row => chatMatches(row.name, query)).map(row => ({ key: row.key, peer: row.target.peer, row }));
  const sections = assembleSections(chatHits, typed === '' ? [] : botHits(chats?.data, query), current?.results ?? [], typed === '' ? [] : messageHits);
  const order = typed === '' ? recent.map(row => resultKey.chat({ key: row.key, peer: row.target.peer })) : sections.order;
  const highlighted = highlight.query === query ? highlight.key : null;

  const openers = new Map<string, () => void>();
  for (const row of recent) openers.set(resultKey.chat({ key: row.key, peer: row.target.peer }), () => onOpenTarget(row.target));
  for (const hit of sections.chats) openers.set(resultKey.chat(hit), () => onOpenTarget(hit.row.target));
  for (const hit of sections.bots) openers.set(resultKey.bot(hit), () => onOpenTarget({ kind: 'room', peer: hit.peer }));
  for (const hit of sections.global) openers.set(resultKey.global(hit), () => onPickGlobal(hit));
  for (const hit of sections.messages) openers.set(resultKey.message(hit), () => onOpenMessage(hit.peerAccountId, hit.messageId));

  useEffect(() => {
    list.current?.querySelector('[data-highlighted=true]')?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!active || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setHighlight({ query, key: moveHighlight(order, highlighted, event.key === 'ArrowDown' ? 1 : -1) });
    } else if (event.key === 'Enter') {
      const open = highlighted ? openers.get(highlighted) : undefined;
      if (!open) return;
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && active) {
      // Handled here: the window's Esc (close the room) must not run as well.
      event.preventDefault();
      onExit();
    }
  };

  const messageRow = (hit: MessageRow) => {
    const name = peerNameOf(chats?.data, hit.peerAccountId);
    const snippet = snippetOf(messagePreview(hit), query);
    const key = resultKey.message(hit);
    return (
      <ChatRow
        key={key}
        testId="search-message"
        avatar={hit.peerAccountId === ASSISTANT_PEER ? <AssistantAvatar /> : <PeerAvatar name={name} />}
        name={name}
        time={formatListTime(hit.timestamp)}
        preview={
          <>
            {hit.direction === 'outgoing' ? 'You: ' : ''}
            {snippet.before}
            <strong className="font-semibold text-fg-primary">{snippet.match}</strong>
            {snippet.after}
          </>
        }
        unread={0}
        selected={false}
        highlighted={highlighted === key}
        onClick={() => onOpenMessage(hit.peerAccountId, hit.messageId)}
      />
    );
  };

  const nothing = typed !== '' && !searching && sections.order.length === 0;

  return (
    <>
      <Input
        ref={field}
        value={query}
        onChange={event => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={adding ? 'Type username' : 'Search by username or in messages'}
        aria-label="Search"
        autoComplete="off"
        spellCheck={false}
        className="mb-2 h-10 shrink-0 rounded-nested px-2 text-body-m md:text-body-m"
      />
      {active ? (
        <div ref={list} className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2" data-testid="search-results">
          {typed === '' ? (
            recent.length > 0 ? (
              <section aria-label="Recent" className="flex flex-col gap-0.5">
                <SectionHeader>Recent</SectionHeader>
                {recent.map(row => row.render(highlighted === resultKey.chat({ key: row.key, peer: row.target.peer })))}
              </section>
            ) : (
              <p className="px-2 py-4 text-body-s text-fg-secondary">Type a username to find someone.</p>
            )
          ) : null}
          {sections.chats.length > 0 ? (
            <section aria-label="Chats and contacts" className="flex flex-col gap-0.5" data-testid="search-chats">
              <SectionHeader>Chats and contacts</SectionHeader>
              {sections.chats.map(hit => hit.row.render(highlighted === resultKey.chat(hit)))}
            </section>
          ) : null}
          {sections.bots.length > 0 ? (
            <section aria-label="Bots" className="flex flex-col gap-0.5" data-testid="search-bots">
              <SectionHeader>Bots</SectionHeader>
              {sections.bots.map(hit => {
                const key = resultKey.bot(hit);
                return (
                  <ChatRow
                    key={key}
                    testId="search-bot-row"
                    avatar={hit.peer === FAUCET_PEER ? <FaucetAvatar /> : <PeerAvatar name={hit.username} />}
                    name={hit.info.name || hit.username}
                    badge={<BotBadge kind={hit.info.kind} />}
                    time={null}
                    preview={hit.info.description || hit.username}
                    unread={0}
                    selected={selected.kind === 'room' && selected.peer === hit.peer}
                    highlighted={highlighted === key}
                    onClick={() => onOpenTarget({ kind: 'room', peer: hit.peer })}
                  />
                );
              })}
            </section>
          ) : null}
          {sections.global.length > 0 || searching || current?.failed ? (
            <section aria-label="Global search" className="flex flex-col gap-0.5" data-testid="search-global">
              <SectionHeader>Global search</SectionHeader>
              {sections.global.map(hit => {
                const key = resultKey.global(hit);
                return (
                  <ChatRow
                    key={key}
                    testId="search-global-row"
                    avatar={<PeerAvatar name={hit.username} />}
                    name={hit.username}
                    time={null}
                    preview="Not a contact yet"
                    unread={0}
                    selected={false}
                    highlighted={highlighted === key}
                    onClick={() => onPickGlobal(hit)}
                  />
                );
              })}
              {searching || current?.loadingMore ? <p className="px-2 py-1.5 text-body-s text-fg-tertiary">Searching…</p> : null}
              {current?.failed ? (
                <p className="px-2 py-1.5 text-body-s text-fg-tertiary" data-testid="search-unavailable">
                  Search unavailable
                </p>
              ) : null}
              {current?.nextCursor && !current.loadingMore ? (
                <Button variant="ghost" size="sm" className="ms-1 w-fit font-normal" onClick={showMore} data-testid="search-show-more">
                  Show more
                </Button>
              ) : null}
            </section>
          ) : null}
          {sections.messages.length > 0 ? (
            <section aria-label="Messages" className="flex flex-col gap-0.5" data-testid="search-messages">
              <SectionHeader>Messages</SectionHeader>
              {sections.messages.map(messageRow)}
            </section>
          ) : null}
          {nothing ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center" data-testid="search-no-results">
              <SearchX className="mb-2 size-6 text-fg-tertiary" aria-hidden />
              <p className="text-label-m text-fg-primary">No results for “{typed}”</p>
            </div>
          ) : null}
        </div>
      ) : (
        children
      )}
    </>
  );
};

type DraftProps = {
  result: SearchResult;
  lookup: IdentityLookup | null;
  manager: ChatManager | null;
  /** The request is out; the caller opens the pending room. */
  onSent: (peer: HexString) => void;
  /** Esc in the field: leave the draft. */
  onClose: () => void;
};

/** The right pane for someone new: one message goes with the request. */
export const DraftRoom = ({ result, lookup, manager, onSent, onClose }: DraftProps) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const name = result.username;

  const send = async () => {
    if (!lookup || !manager) return;
    setError(null);
    setBusy(true);
    try {
      const peer = await lookup.getPeerIdentity(result.accountId);
      if (!peer) throw new Error(`${name} has no chat key on the People chain yet, so a request cannot reach them. Try again later.`);
      await manager.sendRequest(peer, text.trim() || null);
      onSent(bytesToHex(result.accountId));
    } catch (cause) {
      setError(plainError(cause, 'The request was not sent. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <>
      <RoomHeader avatar={<PeerAvatar name={name} />} name={name} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <div className="mb-3 rounded-full bg-surface-nested p-4">
          <UserPlus className="size-6 text-fg-tertiary" aria-hidden />
        </div>
        <p className="text-heading-m text-fg-primary">Invite {name} to chat</p>
        <p className="text-body-m text-fg-secondary">You can only send one message in this request.</p>
      </div>
      {error ? (
        <p role="alert" className="px-4 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      {/* The room's composer, as Desktop's DraftInvitationRoom reuses MessageInput:
          the send-key setting applies, Esc closes the draft. */}
      <Composer
        draft={text}
        onDraft={setText}
        onSend={() => void send()}
        context={null}
        placeholder="Say hello... (optional)"
        sendLabel={busy ? 'Sending…' : 'Send Request'}
        sendButton="pill"
        allowEmpty
        sendDisabled={busy || !manager}
        sendKey={prefs.sendKey}
        onEscape={onClose}
      />
    </>
  );
};
