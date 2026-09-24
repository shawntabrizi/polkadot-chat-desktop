// Two panes on the page surface, as Polkadot Desktop's ChatFullscreen.tsx
// (.refs/polkadot-desktop, 2026-09-23): the chat list on the left, the open
// room on the right. Requests, the search (M7b) and Settings open in these
// panes, never in a modal (SKILL.md §10 "Avoid modals"). The keyboard shortcuts,
// the window title, the dock badge and the notifications live here, next
// to the selection they read and change (M6 steps 4, 5, 7).

import { MessagesSquare, Plus, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { type HexString, bytesToHex } from '../app/bytes';
import { CONNECTION_LABEL, type ConnectionSnapshot } from '../app/connectionState';
import { type PeerId, db, groupIdOf, groupPeerOf, isGroupPeer } from '../app/database';
import { isPrimaryModifier } from '../app/keyboard';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { ASSISTANT_PEER, type AssistantChat } from '../domain/assistant/assistant';
import { countUnread } from '../domain/chat/messages';
import { applyDripStatus, syncDrip } from '../domain/faucet/dripFlow';
import { FAUCET_PEER } from '../domain/faucet/faucet';
import type { TxRunner } from '../domain/chain/transactions';
import type { ChatManager } from '../domain/chat/manager';
import type { IdentityLookup } from '../domain/identity/lookup';
import type { SearchResult } from '../domain/identity/search';
import type { UserIdentity } from '../domain/identity/userIdentity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import type { DesktopAssistantApi } from '../../shared/desktop-api';

import { PeerAvatar } from './Avatar';
import { ChatList, type ChatSelection, type ChatTarget, useChatOrder } from './ChatList';
import { IncomingRequestRoom, OutgoingRequestRoom, RequestsPanel, usePendingIncoming } from './Requests';
import { BalanceChip, Pocket } from './Pocket';
import { Room } from './Room';
import { FaucetRoom } from './FaucetRoom';
import { GroupRoom, NewGroupRoom } from './GroupRoom';
import { DraftRoom, SearchPane } from './Search';
import { Settings } from './Settings';
import { toSs58 } from './format';
import { useNotifications } from './notifications';
import { useLiveQuery } from './useLiveQuery';

export type Selection =
  | { kind: 'none' }
  /** `jump`: a message search hit to scroll to; `seq` makes a second click on it jump again. */
  | { kind: 'room'; peer: PeerId; jump?: { messageId: string; seq: number } }
  | { kind: 'incoming'; requestId: string }
  | { kind: 'outgoing'; peer: HexString }
  | { kind: 'draft'; result: SearchResult }
  | { kind: 'settings' }
  /** M11b: the Pocket (balances and address), from the footer chip. */
  | { kind: 'pocket' }
  /** M12: "New group" from the New chat panel. */
  | { kind: 'newGroup' };

type LeftView = 'chats' | 'requests';

type Props = {
  username: string;
  identity: UserIdentity;
  profileId: NetworkProfileId;
  /** Null while the chat manager starts. */
  runtime: { manager: ChatManager; lookup: IdentityLookup; transactions: TxRunner | null } | null;
  assistant: AssistantChat | null;
  assistantApi: DesktopAssistantApi | null;
  connection: ConnectionSnapshot;
  onReset: () => Promise<void>;
};

const APP_TITLE = 'Polkadot Chat';

/** Is an overlay (menu, select, tooltip) open? Esc belongs to it then. */
const overlayOpen = (): boolean => document.querySelector('[data-radix-popper-content-wrapper]') !== null;

const IconButton = ({ label, onClick, active = false, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn('rounded-full font-normal', active && 'bg-selection-container-active')}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const EmptyRoom = ({ title, text }: { title: string; text: string }) => (
  <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center" data-testid="empty-room">
    <div className="mb-3 rounded-full bg-surface-nested p-4">
      <MessagesSquare className="size-6 text-fg-tertiary" aria-hidden />
    </div>
    <p className="text-heading-m text-fg-primary">{title}</p>
    <p className="text-body-m text-fg-secondary">{text}</p>
  </div>
);

export const Shell = ({ username, identity, profileId, runtime, assistant, assistantApi, connection, onReset }: Props) => {
  const [left, setLeft] = useState<LeftView>('chats');
  const [chosen, setSelection] = useState<Selection>({ kind: 'none' });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const pendingIncoming = usePendingIncoming();
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);
  const order = useChatOrder();
  const desktopApp = window.desktop?.app ?? null;

  // A sent request that the peer accepts turns into their room.
  const selection: Selection =
    chosen.kind === 'outgoing' && contacts?.some(contact => contact.accountId === chosen.peer) ? { kind: 'room', peer: chosen.peer } : chosen;

  // ── Title and dock badge: unread of the rooms that are not muted.
  const unreadTotal = useLiveQuery(countUnread, []) ?? 0;
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${APP_TITLE}` : APP_TITLE;
    desktopApp?.setBadge(unreadTotal);
  }, [unreadTotal, desktopApp]);

  useNotifications(desktopApp, selection.kind === 'room' ? selection.peer : null);

  // The Faucet's "Get 1 PAS" (dripFlow.ts): mirror the faucet bot's answer, time out, add the balance.
  const chatReady = runtime !== null;
  useEffect(() => {
    if (!chatReady) return;
    const stopStatus = window.desktop?.chain.onTxStatus(event => void applyDripStatus(event).catch(() => undefined)) ?? (() => undefined);
    let running = false;
    const readBalance = async () => {
      const chain = window.desktop?.chain;
      if (!chain) throw new Error('no chain');
      return BigInt((await chain.balance()).free);
    };
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void syncDrip(readBalance)
        .catch((cause: unknown) => console.warn('[faucet] sync failed', cause))
        .finally(() => {
          running = false;
        });
    }, 1_000);
    return () => {
      clearInterval(timer);
      stopStatus();
    };
  }, [chatReady]);

  const exitSearch = () => {
    setSearch('');
    setAdding(false);
  };

  // A pick from "Recent" (empty field) goes back to the list, which shows the
  // selection; with a query the results stay until Esc, as in Telegram.
  const leaveRecent = () => {
    if (search.trim() === '') setAdding(false);
  };

  const openTarget = (target: ChatTarget) => {
    setLeft('chats');
    setSelection(target.kind === 'room' ? { kind: 'room', peer: target.peer } : { kind: 'outgoing', peer: target.peer });
  };

  // A notification click (main focused the window) and the menu's Preferences….
  useEffect(() => {
    if (!desktopApp) return;
    const stopOpen = desktopApp.onNotifyOpen(({ peerId, requestId }) => {
      if (requestId) {
        setLeft('requests');
        setSelection({ kind: 'incoming', requestId });
      } else {
        setLeft('chats');
        setSelection({ kind: 'room', peer: peerId as PeerId });
      }
    });
    const stopMenu = desktopApp.onMenuSettings(() => setSelection({ kind: 'settings' }));
    return () => {
      stopOpen();
      stopMenu();
    };
  }, [desktopApp]);

  // ── Keyboard shortcuts (M6 step 4). One listener; it reads the latest state.
  const onShortcut = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onShortcut.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const primary = isPrimaryModifier(event);
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (primary && !event.altKey && !event.shiftKey && (key === 'k' || key === 'n')) {
        // ⌘K searches; ⌘N is "+": the same field, set to find someone new.
        event.preventDefault();
        setLeft('chats');
        if (key === 'n') setAdding(true);
        setSearchFocus(count => count + 1);
        return;
      }
      if (primary && !event.altKey && key === ',') {
        event.preventDefault();
        setSelection({ kind: 'settings' });
        return;
      }
      if (key === 'Escape' && !primary && !event.altKey) {
        if (overlayOpen()) return;
        if (left !== 'chats') setLeft('chats');
        else if (selection.kind !== 'none') setSelection({ kind: 'none' });
        return;
      }
      if ((key === 'ArrowUp' || key === 'ArrowDown') && (primary || event.altKey) && !event.shiftKey && order.length > 0) {
        event.preventDefault();
        const current = order.findIndex(target => (selection.kind === 'room' || selection.kind === 'outgoing') && target.peer === selection.peer);
        const step = key === 'ArrowUp' ? -1 : 1;
        const next = current === -1 ? (step === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, current + step));
        const target = order[next];
        if (target) openTarget(target);
        return;
      }
      if (primary && !event.altKey && !event.shiftKey && /^[1-9]$/.test(key)) {
        const target = order[Number(key) - 1];
        if (target) {
          event.preventDefault();
          openTarget(target);
        }
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // "Get 1 PAS": the embedded Faucet's devnet transfer (main/chain/faucet.ts); devnet only.
  const devnetAssetHub = profileId === 'devnet' ? NETWORK_PROFILES.devnet.assetHub?.genesis : undefined;
  const chainApi = window.desktop?.chain;
  const drip = devnetAssetHub && chainApi ? () => chainApi.faucetDrip(devnetAssetHub) : null;

  const listSelection: ChatSelection =
    selection.kind === 'room' || selection.kind === 'outgoing' ? selection : { kind: 'other' };

  const right = (() => {
    switch (selection.kind) {
      case 'none':
        return <EmptyRoom title="No chat selected" text="Select a chat to view the conversation" />;
      case 'room':
        if (selection.peer === ASSISTANT_PEER) {
          return assistant ? (
            <Room
              key={ASSISTANT_PEER}
              peer={ASSISTANT_PEER}
              assistant={assistant}
              scrollToMessageId={selection.jump?.messageId ?? null}
              scrollRequest={selection.jump?.seq ?? 0}
            />
          ) : null;
        }
        if (isGroupPeer(selection.peer)) {
          return runtime ? (
            <GroupRoom
              key={selection.peer}
              groupId={groupIdOf(selection.peer)}
              manager={runtime.manager}
              self={bytesToHex(identity.identityAccountId)}
              scrollToMessageId={selection.jump?.messageId ?? null}
              scrollRequest={selection.jump?.seq ?? 0}
            />
          ) : (
            <EmptyRoom title="Starting chat…" text="Connecting to the network. Your chats open when it is ready." />
          );
        }
        if (selection.peer === FAUCET_PEER) {
          return <FaucetRoom key={FAUCET_PEER} address={toSs58(identity.identityAccountId)} drip={drip} />;
        }
        return runtime ? (
          <Room
            key={selection.peer}
            peer={selection.peer}
            manager={runtime.manager}
            transactions={runtime.transactions}
            self={{ accountId: identity.identityAccountId, username }}
            connection={connection}
            scrollToMessageId={selection.jump?.messageId ?? null}
            scrollRequest={selection.jump?.seq ?? 0}
          />
        ) : (
          <EmptyRoom title="Starting chat…" text="Connecting to the network. Your chats open when it is ready." />
        );
      case 'incoming':
        return (
          <IncomingRequestRoom
            key={selection.requestId}
            requestId={selection.requestId}
            manager={runtime?.manager ?? null}
            onAccepted={peer => {
              setLeft('chats');
              setSelection({ kind: 'room', peer });
            }}
            onDeclined={name => {
              setSelection({ kind: 'none' });
              toast(`Request from ${name} was declined`);
            }}
          />
        );
      case 'outgoing':
        return <OutgoingRequestRoom key={selection.peer} peer={selection.peer} />;
      case 'draft':
        return (
          <DraftRoom
            key={selection.result.candidateAccountId}
            result={selection.result}
            lookup={runtime?.lookup ?? null}
            manager={runtime?.manager ?? null}
            onSent={peer => {
              setLeft('chats');
              exitSearch();
              setSelection({ kind: 'outgoing', peer });
            }}
            onClose={() => setSelection({ kind: 'none' })}
          />
        );
      case 'newGroup':
        return (
          <NewGroupRoom
            manager={runtime?.manager ?? null}
            onCreated={groupId => {
              setLeft('chats');
              exitSearch();
              setSelection({ kind: 'room', peer: groupPeerOf(groupId) });
            }}
          />
        );
      case 'settings':
      case 'pocket':
        return null;
    }
  })();

  /** A search result opens what already exists for that person, else a draft. */
  const pick = async (result: SearchResult) => {
    const peer = bytesToHex(result.accountId);
    if (await db.contacts.get(peer)) {
      setLeft('chats');
      setSelection({ kind: 'room', peer });
      return;
    }
    const pending = (await db.requests.where('peerAccountId').equals(peer).toArray()).find(row => row.status === 'pending');
    if (pending?.direction === 'outgoing') setSelection({ kind: 'outgoing', peer });
    else if (pending) setSelection({ kind: 'incoming', requestId: pending.requestId });
    else setSelection({ kind: 'draft', result });
  };

  return (
    <div className="flex h-screen gap-2 bg-surface-main p-2">
      <aside className="flex w-80 shrink-0 flex-col rounded-container bg-surface-container p-2 shadow-1" aria-label="Chats">
        {left === 'requests' ? (
          <RequestsPanel
            selectedRequestId={selection.kind === 'incoming' ? selection.requestId : null}
            onBack={() => setLeft('chats')}
            onOpen={requestId => setSelection({ kind: 'incoming', requestId })}
          />
        ) : (
          <>
            <div className="flex h-12 shrink-0 items-center justify-between ps-2">
              <h1 className="text-heading-m text-fg-primary">Polkadot Chat</h1>
              <IconButton
                label="New chat"
                active={adding}
                onClick={() => {
                  setAdding(true);
                  setSearchFocus(count => count + 1);
                }}
              >
                <Plus className="size-5" />
              </IconButton>
            </div>
            <SearchPane
              query={search}
              onQuery={setSearch}
              adding={adding}
              onExit={exitSearch}
              focusSignal={searchFocus}
              profile={NETWORK_PROFILES[profileId]}
              selfIdentityAccountId={identity.identityAccountId}
              selected={listSelection}
              onOpenTarget={target => {
                leaveRecent();
                openTarget(target);
              }}
              onOpenMessage={(peer, messageId) => setSelection({ kind: 'room', peer, jump: { messageId, seq: Date.now() } })}
              onPickGlobal={result => void pick(result)}
              onNewGroup={() => setSelection({ kind: 'newGroup' })}
              newGroupActive={selection.kind === 'newGroup'}
            >
              {pendingIncoming.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLeft('requests')}
                  data-testid="new-requests"
                  className="mb-2 flex w-fit cursor-pointer items-center gap-2 rounded-full bg-action-tertiary py-1.5 ps-3 pe-1.5 text-label-m text-fg-primary transition-colors hover:bg-action-tertiary-hover"
                >
                  New requests
                  <Badge className="h-5 min-w-5 rounded-full px-1.5 text-label-s">{pendingIncoming.length}</Badge>
                </button>
              ) : null}
              <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
                <ChatList
                  selected={listSelection}
                  onOpenRoom={peer => setSelection({ kind: 'room', peer })}
                  onOpenOutgoing={peer => setSelection({ kind: 'outgoing', peer })}
                  typing={runtime?.manager.typing}
                />
              </div>
            </SearchPane>
          </>
        )}
        {/* The account block (owner, 2026-09-23): its own nested surface, no hover, so it
            never reads as a chat row; the chip has its own line, so the username never
            shares its width. */}
        <section className="mt-2 flex shrink-0 flex-col gap-1.5 rounded-nested bg-surface-nested px-3 py-2" aria-label="Your account" data-testid="account-block">
          <div className="flex items-center justify-between gap-2">
            <p className="text-overline text-fg-tertiary uppercase">You</p>
            <IconButton label="Settings" active={selection.kind === 'settings'} onClick={() => setSelection({ kind: 'settings' })}>
              <SettingsIcon className="size-5" />
            </IconButton>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <PeerAvatar name={username} size="xs" />
            <p className="min-w-0 text-label-m break-all text-fg-primary" data-testid="username">
              {username}
            </p>
            <p
              className={cn('shrink-0 text-caption', connection.state === 'offline' ? 'text-fg-error' : 'text-fg-tertiary')}
              data-testid="connection-status"
            >
              {CONNECTION_LABEL[connection.state]}
            </p>
          </div>
          <div className="flex">
            <BalanceChip active={selection.kind === 'pocket'} onOpen={() => setSelection({ kind: 'pocket' })} />
          </div>
        </section>
      </aside>
      {selection.kind === 'settings' ? (
        <main className="min-w-0 flex-1">
          <Settings
            username={username}
            identity={identity}
            profileId={profileId}
            onReset={onReset}
            assistantApi={assistantApi}
            submissions={runtime?.manager.submissions ?? null}
          />
        </main>
      ) : selection.kind === 'pocket' ? (
        <main className="min-w-0 flex-1">
          <Pocket
            username={username}
            address={toSs58(identity.identityAccountId)}
            profileId={profileId}
            onGetFunds={() => {
              setLeft('chats');
              setSelection({ kind: 'room', peer: FAUCET_PEER });
            }}
          />
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-container bg-surface-container shadow-1">{right}</main>
      )}
    </div>
  );
};
