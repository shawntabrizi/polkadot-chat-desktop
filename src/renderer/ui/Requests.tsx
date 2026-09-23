import { useState } from 'react';

import { hexToBytes } from '../app/bytes';
import type { RequestRow } from '../app/database';
import type { ChatManager } from '../domain/chat/manager';
import { listRequests } from '../domain/requests/repository';

import { formatTime, shortAccount, toSs58 } from './format';
import { useLiveQuery } from './useLiveQuery';

type Props = { manager: ChatManager };

const peerLabel = (request: RequestRow): string =>
  `${request.peerUsername} (${shortAccount(toSs58(hexToBytes(request.peerAccountId)))})`;

export const Requests = ({ manager }: Props) => {
  const requests = useLiveQuery(listRequests, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (requestId: string, action: 'accept' | 'decline') => {
    setError(null);
    setBusy(requestId);
    try {
      if (action === 'accept') await manager.acceptRequest(requestId);
      else await manager.declineRequest(requestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} the request.`);
    } finally {
      setBusy(null);
    }
  };

  const incoming = requests?.filter(request => request.direction === 'incoming') ?? [];
  const outgoing = requests?.filter(request => request.direction === 'outgoing') ?? [];

  return (
    <section>
      <h2>Requests</h2>
      {error ? <p role="alert">{error}</p> : null}
      <h3>Incoming</h3>
      {incoming.length === 0 ? <p>No incoming requests.</p> : null}
      <ul>
        {incoming.map(request => (
          <li key={request.requestId} style={{ margin: '8px 0' }} data-testid="incoming-request">
            <strong>{peerLabel(request)}</strong> — {formatTime(request.timestamp)}
            {request.welcomeMessage ? <blockquote>{request.welcomeMessage}</blockquote> : null}
            {request.status === 'pending' ? (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void act(request.requestId, 'accept')}>
                  Accept
                </button>{' '}
                <button type="button" disabled={busy !== null} onClick={() => void act(request.requestId, 'decline')}>
                  Decline
                </button>
              </>
            ) : (
              <em>{request.status}</em>
            )}
          </li>
        ))}
      </ul>
      <h3>Outgoing</h3>
      {outgoing.length === 0 ? <p>No outgoing requests.</p> : null}
      <ul>
        {outgoing.map(request => (
          <li key={request.requestId} style={{ margin: '8px 0' }} data-testid="outgoing-request">
            <strong>{peerLabel(request)}</strong> — {formatTime(request.timestamp)} — <em>{request.status}</em>
          </li>
        ))}
      </ul>
    </section>
  );
};
