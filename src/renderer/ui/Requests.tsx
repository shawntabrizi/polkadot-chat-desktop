// Flow and strings from docs/reference/mobile-ux.md "Starting a chat"; banner
// layout from .refs/polkadot-desktop/src/features/chat/ui/partials/RequestBanner.tsx
// and ChatFullscreen.tsx's requests list and pending room (2026-09-23).

import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import type { HexString } from '../app/bytes';
import { type MessageRow, type RequestRow, db } from '../app/database';
import type { ChatManager } from '../domain/chat/manager';
import { useChatActions } from './chatActions';
import { listRequests } from '../domain/requests/repository';
import { Button } from '@/components/ui/button';

import { PeerAvatar } from './Avatar';
import { ChatRow } from './ChatRow';
import { DateSeparator, MessageBubble } from './MessageBubble';
import { RoomHeader } from './RoomHeader';
import { formatDay, formatListTime, plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

/**
 * Incoming requests that wait for an answer, newest first: one per person
 * (a sender's earlier requests replay from the network as separate rows),
 * and none from someone who is already a contact.
 */
export const usePendingIncoming = (): RequestRow[] => {
  const requests = useLiveQuery(listRequests, []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);
  const blocked = useLiveQuery(() => db.blocked.toArray(), []);
  // M12e: a blocked sender's earlier requests are not shown either.
  const known = new Set([...(contacts ?? []).map(contact => contact.accountId), ...(blocked ?? []).map(row => row.accountId)]);
  const newest = new Map<string, RequestRow>();
  for (const request of requests ?? []) {
    if (request.direction !== 'incoming' || request.status !== 'pending' || known.has(request.peerAccountId)) continue;
    const seen = newest.get(request.peerAccountId);
    if (!seen || request.timestamp > seen.timestamp) newest.set(request.peerAccountId, request);
  }
  return [...newest.values()].sort((a, b) => b.timestamp - a.timestamp);
};

type PanelProps = {
  selectedRequestId: string | null;
  onBack: () => void;
  onOpen: (requestId: string) => void;
};

/** The left pane while "New requests" is open: replaces the chat list. */
export const RequestsPanel = ({ selectedRequestId, onBack, onOpen }: PanelProps) => {
  const requests = usePendingIncoming();
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" className="rounded-full font-normal" aria-label="Back to chats" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-heading-m text-fg-primary">Message requests</h1>
      </div>
      <p className="mb-2 rounded-nested bg-surface-nested px-3 py-2 text-body-s text-fg-secondary">
        Message requests from people who aren't in your contact list appear here.
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {requests.length === 0 ? <p className="px-2 py-6 text-center text-body-s text-fg-secondary">No requests right now.</p> : null}
        {requests.map(request => (
          <ChatRow
            key={request.requestId}
            testId="incoming-request"
            avatar={<PeerAvatar name={request.peerUsername} />}
            name={request.peerUsername}
            time={formatListTime(request.timestamp)}
            preview={request.welcomeMessage ?? 'Message request'}
            unread={0}
            selected={selectedRequestId === request.requestId}
            onClick={() => onOpen(request.requestId)}
          />
        ))}
      </div>
    </>
  );
};

/** A request's welcome message, shown as the bubble it will become. */
const welcomeRow = (request: RequestRow): MessageRow => ({
  messageId: `request:${request.requestId}`,
  peerAccountId: request.peerAccountId,
  timestamp: request.timestamp,
  direction: request.direction === 'incoming' ? 'incoming' : 'outgoing',
  status: request.direction === 'incoming' ? 'received' : 'sent',
  content: { type: 'text', text: request.welcomeMessage ?? '' },
  reactions: [],
  editedAt: null,
});

const RequestBody = ({ request, note }: { request: RequestRow; note: string | null }) => (
  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-testid="messages">
    <DateSeparator text={formatDay(request.timestamp)} />
    {note ? <p className="py-2 text-center text-label-s text-fg-secondary">{note}</p> : null}
    {request.welcomeMessage ? <MessageBubble row={welcomeRow(request)} quote={null} first last actions={null} /> : null}
  </div>
);

type IncomingProps = {
  requestId: string;
  manager: ChatManager | null;
  /** Called with the new contact once the request is accepted. */
  onAccepted: (peer: HexString) => void;
  /** `silent`: the caller shows no toast of its own (Block has its own). */
  onDeclined: (name: string, options?: { silent?: boolean }) => void;
};

/** The recipient's view: the banner replaces the composer. */
export const IncomingRequestRoom = ({ requestId, manager, onAccepted, onDeclined }: IncomingProps) => {
  const request = useLiveQuery(() => db.requests.get(requestId), [requestId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatActions = useChatActions();
  if (!request) return null;
  const name = request.peerUsername;

  // M12e: Block drops this request and every later one from them (Undo in the toast; Settings › Privacy unblocks).
  const block = () => {
    chatActions.block({ accountId: request.peerAccountId, username: name }, name);
    onDeclined(name, { silent: true });
  };

  const act = async (action: 'accept' | 'decline') => {
    if (!manager) return;
    setError(null);
    setBusy(true);
    try {
      if (action === 'accept') {
        await manager.acceptRequest(request.requestId);
        onAccepted(request.peerAccountId);
      } else {
        await manager.declineRequest(request.requestId);
        onDeclined(name);
      }
    } catch (cause) {
      const fallback = action === 'accept' ? 'The request was not accepted.' : 'The request was not declined.';
      setError(`${plainError(cause, fallback)} Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <RoomHeader avatar={<PeerAvatar name={name} />} name={name} />
      <RequestBody request={request} note={request.welcomeMessage ? null : `${name} sent message request`} />
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-4" data-testid="request-banner">
        <div className="flex items-center gap-4 rounded-nested bg-surface-nested px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-heading-s text-fg-primary">Accept chat request from {name}</p>
            <p className="text-body-m text-fg-secondary">
              Add {name} to your contacts to accept the chat request. They won't know you've seen their message until you accept.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" className="rounded-medium font-normal text-fg-error" disabled={busy} onClick={block} data-testid="request-block">
              Block
            </Button>
            <Button variant="secondary" className="rounded-medium text-label-m" disabled={busy || !manager} onClick={() => void act('decline')}>
              Decline
            </Button>
            <Button className="rounded-medium text-label-m" disabled={busy || !manager} onClick={() => void act('accept')}>
              Accept
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-body-s text-fg-error">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
};

/** The sender's view: the welcome message, and a line instead of the composer. */
export const OutgoingRequestRoom = ({ peer }: { peer: HexString }) => {
  const request = useLiveQuery(
    async () =>
      (await db.requests.where('peerAccountId').equals(peer).toArray())
        .filter(row => row.direction === 'outgoing')
        .sort((a, b) => b.timestamp - a.timestamp)[0],
    [peer],
  );
  if (!request) return null;
  const name = request.peerUsername;
  return (
    <>
      <RoomHeader avatar={<PeerAvatar name={name} />} name={name} />
      <RequestBody request={request} note="You sent message request" />
      <p className="shrink-0 px-4 pt-2 pb-5 text-center text-body-m text-fg-secondary" data-testid="request-waiting">
        {request.status === 'declined'
          ? `${name} declined your request.`
          : `Wait for ${name} to accept your request message before sending the next message.`}
      </p>
    </>
  );
};
