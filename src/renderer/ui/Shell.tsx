// Two panes on the page surface, as Polkadot Desktop's ChatFullscreen.tsx
// (.refs/polkadot-desktop, 2026-09-23): the chat list on the left, the open
// room on the right. Requests, New chat and Settings open in these panes,
// never in a modal (SKILL.md §10 "Avoid modals").

import { MessagesSquare, Plus, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import { type HexString, bytesToHex } from '../app/bytes';
import { type PeerId, db } from '../app/database';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { ConnectionStatus } from '../app/statementStore';
import { ASSISTANT_PEER, type AssistantChat } from '../domain/assistant/assistant';
import type { ChatManager } from '../domain/chat/manager';
import type { IdentityLookup } from '../domain/identity/lookup';
import type { SearchResult } from '../domain/identity/search';
import type { UserIdentity } from '../domain/identity/userIdentity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import type { DesktopAssistantApi } from '../../shared/desktop-api';

import { PeerAvatar } from './Avatar';
import { ChatList, type ChatSelection } from './ChatList';
import { IncomingRequestRoom, OutgoingRequestRoom, RequestsPanel, usePendingIncoming } from './Requests';
import { Room } from './Room';
import { DraftRoom, NewChatPanel } from './Search';
import { Settings } from './Settings';
import { useLiveQuery } from './useLiveQuery';

export type Selection =
  | { kind: 'none' }
  | { kind: 'room'; peer: PeerId }
  | { kind: 'incoming'; requestId: string }
  | { kind: 'outgoing'; peer: HexString }
  | { kind: 'draft'; result: SearchResult }
  | { kind: 'settings' };

type LeftView = 'chats' | 'requests' | 'newChat';

type Props = {
  username: string;
  identity: UserIdentity;
  profileId: NetworkProfileId;
  /** Null while the chat manager starts. */
  runtime: { manager: ChatManager; lookup: IdentityLookup } | null;
  assistant: AssistantChat | null;
  assistantApi: DesktopAssistantApi | null;
  connection: ConnectionStatus;
  onReset: () => Promise<void>;
};

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
};

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
  const [filter, setFilter] = useState('');
  const pendingIncoming = usePendingIncoming();
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);

  // A sent request that the peer accepts turns into their room.
  const selection: Selection =
    chosen.kind === 'outgoing' && contacts?.some(contact => contact.accountId === chosen.peer) ? { kind: 'room', peer: chosen.peer } : chosen;

  const listSelection: ChatSelection =
    selection.kind === 'room' || selection.kind === 'outgoing' ? selection : { kind: 'other' };

  const right = (() => {
    switch (selection.kind) {
      case 'none':
        return <EmptyRoom title="No chat selected" text="Select a chat to view the conversation" />;
      case 'room':
        if (selection.peer === ASSISTANT_PEER) {
          return assistant ? <Room key={ASSISTANT_PEER} peer={ASSISTANT_PEER} assistant={assistant} /> : null;
        }
        return runtime ? (
          <Room key={selection.peer} peer={selection.peer} manager={runtime.manager} />
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
              setSelection({ kind: 'outgoing', peer });
            }}
          />
        );
      case 'settings':
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
        ) : left === 'newChat' ? (
          <NewChatPanel
            profile={NETWORK_PROFILES[profileId]}
            selfIdentityAccountId={identity.identityAccountId}
            onBack={() => setLeft('chats')}
            onPick={result => void pick(result)}
          />
        ) : (
          <>
            <div className="flex h-12 shrink-0 items-center justify-between ps-2">
              <h1 className="text-heading-m text-fg-primary">Polkadot Chat</h1>
              <IconButton label="New chat" onClick={() => setLeft('newChat')}>
                <Plus className="size-5" />
              </IconButton>
            </div>
            <Input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder="Type username"
              aria-label="Search chats"
              autoComplete="off"
              spellCheck={false}
              className="mb-2 h-10 shrink-0 rounded-nested px-2 text-body-m md:text-body-m"
            />
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
                query={filter}
                selected={listSelection}
                onOpenRoom={peer => setSelection({ kind: 'room', peer })}
                onOpenOutgoing={peer => setSelection({ kind: 'outgoing', peer })}
              />
            </div>
          </>
        )}
        <div className="mt-2 flex shrink-0 items-center gap-3 ps-2">
          <PeerAvatar name={username} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label-m text-fg-primary" data-testid="username">
              {username}
            </p>
            <p
              className={cn('text-caption', connection === 'disconnected' ? 'text-fg-error' : 'text-fg-tertiary')}
              data-testid="connection-status"
            >
              {CONNECTION_TEXT[connection]}
            </p>
          </div>
          <IconButton label="Settings" active={selection.kind === 'settings'} onClick={() => setSelection({ kind: 'settings' })}>
            <SettingsIcon className="size-5" />
          </IconButton>
        </div>
      </aside>
      {selection.kind === 'settings' ? (
        <main className="min-w-0 flex-1">
          <Settings username={username} identity={identity} profileId={profileId} onReset={onReset} assistantApi={assistantApi} />
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-container bg-surface-container shadow-1">{right}</main>
      )}
    </div>
  );
};
