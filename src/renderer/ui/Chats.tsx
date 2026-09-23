import { hexToBytes } from '../app/bytes';
import { type PeerId, db } from '../app/database';
import { ASSISTANT_PEER, ASSISTANT_USERNAME } from '../domain/assistant/assistant';
import { listRooms } from '../domain/chat/messages';

import { formatTime, shortAccount, toSs58 } from './format';
import { useLiveQuery } from './useLiveQuery';

type Props = { onOpen: (peer: PeerId) => void };

/**
 * The Assistant first (local, always there), then contacts with their room,
 * newest activity first. A contact without a room yet still shows.
 */
export const Chats = ({ onOpen }: Props) => {
  const rooms = useLiveQuery(listRooms, []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);

  const rows = (contacts ?? [])
    .map(contact => ({ contact, room: rooms?.find(room => room.peerAccountId === contact.accountId) ?? null }))
    .sort((a, b) => (b.room?.lastMessageAt ?? 0) - (a.room?.lastMessageAt ?? 0));
  const assistantRoom = rooms?.find(room => room.peerAccountId === ASSISTANT_PEER) ?? null;

  return (
    <section>
      <h2>Chats</h2>
      {contacts?.length === 0 ? <p>No chats yet. Find someone and send a request.</p> : null}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        <li style={{ margin: '8px 0' }} data-testid="chat-row-assistant">
          <button type="button" onClick={() => onOpen(ASSISTANT_PEER)} style={{ width: '100%', textAlign: 'left', padding: 8 }}>
            <strong>{ASSISTANT_USERNAME}</strong> <em>AI, in this app</em>
            {assistantRoom && assistantRoom.unreadCount > 0 ? <strong> · {assistantRoom.unreadCount} unread</strong> : null}
            {assistantRoom?.lastPreview ? (
              <div style={{ color: '#555' }}>
                {assistantRoom.lastPreview} <small>{formatTime(assistantRoom.lastMessageAt)}</small>
              </div>
            ) : null}
          </button>
        </li>
        {rows.map(({ contact, room }) => (
          <li key={contact.accountId} style={{ margin: '8px 0' }} data-testid="chat-row">
            <button
              type="button"
              onClick={() => onOpen(contact.accountId)}
              style={{ width: '100%', textAlign: 'left', padding: 8 }}
            >
              <strong>{contact.username}</strong> <code>{shortAccount(toSs58(hexToBytes(contact.accountId)))}</code>{' '}
              <em>
                {contact.devices.length} device{contact.devices.length === 1 ? '' : 's'}
              </em>
              {room && room.unreadCount > 0 ? <strong> · {room.unreadCount} unread</strong> : null}
              {room?.lastPreview ? (
                <div style={{ color: '#555' }}>
                  {room.lastPreview} <small>{formatTime(room.lastMessageAt)}</small>
                </div>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
