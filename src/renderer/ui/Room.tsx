import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';

import type { HexString } from '../app/bytes';
import { type MessageRow, db } from '../app/database';
import { previewOf } from '../domain/chat/content';
import type { ChatManager } from '../domain/chat/manager';
import { listMessages } from '../domain/chat/messages';

import { formatTime } from './format';
import { useLiveQuery } from './useLiveQuery';

type Props = {
  peer: HexString;
  manager: ChatManager;
  onBack: VoidFunction;
};

const QUICK_REACTIONS = ['👍', '❤️', '😂'];

const statusMark = (row: MessageRow): string => {
  switch (row.status) {
    case 'sending':
      return '…';
    case 'sent':
      return '✓';
    case 'delivered':
      return '✓✓';
    case 'failed':
      return '✗ failed';
    case 'received':
      return '';
  }
};

type Composer = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

export const Room = ({ peer, manager, onBack }: Props) => {
  const contact = useLiveQuery(() => db.contacts.get(peer), [peer]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const [draft, setDraft] = useState('');
  const [composer, setComposer] = useState<Composer>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);

  // Everything that arrives while the room is open is read.
  const messageCount = messages?.length ?? 0;
  useEffect(() => {
    void manager.markRead(peer);
  }, [manager, peer, messageCount]);

  const byId = new Map((messages ?? []).map(row => [row.messageId, row]));

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    const current = composer;
    setDraft('');
    setComposer({ mode: 'new' });
    try {
      if (current.mode === 'edit') await manager.edit(peer, current.target.messageId, text);
      else if (current.mode === 'reply') await manager.sendMessage(peer, { type: 'reply', messageId: current.target.messageId, text });
      else await manager.sendMessage(peer, { type: 'text', text });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send.');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const toggleReaction = async (row: MessageRow, emoji: string) => {
    const mine = row.reactions.some(r => r.emoji === emoji && r.by === 'me');
    setError(null);
    try {
      await manager.react(peer, row.messageId, emoji, !mine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not react.');
    }
  };

  const startEdit = (row: MessageRow) => {
    if (row.content.type !== 'text' && row.content.type !== 'reply') return;
    setComposer({ mode: 'edit', target: row });
    setDraft(row.content.text);
  };

  const renderBody = (row: MessageRow) => {
    const { content } = row;
    switch (content.type) {
      case 'text':
        return <span style={{ whiteSpace: 'pre-wrap' }}>{content.text}</span>;
      case 'reply': {
        const target = byId.get(content.messageId);
        return (
          <>
            <blockquote style={{ margin: '0 0 4px', paddingLeft: 8, borderLeft: '2px solid #999', color: '#555' }}>
              {target ? previewOf(target.content) : '(message not available)'}
            </blockquote>
            <span style={{ whiteSpace: 'pre-wrap' }}>{content.text}</span>
          </>
        );
      }
      case 'richText':
        return (
          <>
            {content.text ? <span style={{ whiteSpace: 'pre-wrap' }}>{content.text}</span> : null}
            {content.attachments.map((attachment, index) => (
              <div key={index} style={{ border: '1px dashed #999', padding: 4, marginTop: 4 }}>
                Attachment: {attachment.kind} {attachment.mimeType} ({attachment.fileSize} bytes) — download is not supported yet
              </div>
            ))}
          </>
        );
      default:
        return <em>{previewOf(content)}</em>;
    }
  };

  return (
    <section>
      <p>
        <button type="button" onClick={onBack}>
          ← Chats
        </button>
      </p>
      <h2>{contact?.username ?? peer}</h2>
      {contact && contact.devices.length === 0 ? <p role="alert">This contact has no known device yet; messages cannot be sent.</p> : null}
      <ol style={{ listStyle: 'none', padding: 0 }} data-testid="messages">
        {messages?.map(row => (
          <li
            key={row.messageId}
            data-testid={`message-${row.direction}`}
            style={{
              margin: '6px 0',
              padding: 8,
              borderRadius: 8,
              background: row.direction === 'outgoing' ? '#e8f0ff' : row.direction === 'system' ? 'transparent' : '#f2f2f2',
              textAlign: row.direction === 'system' ? 'center' : 'left',
            }}
          >
            {renderBody(row)}
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {formatTime(row.timestamp)} {row.editedAt ? '(edited)' : ''} {statusMark(row)}
              {row.reactions.length > 0 ? <span> · {row.reactions.map(r => r.emoji).join(' ')}</span> : null}
              {row.direction !== 'system' ? (
                <span style={{ marginLeft: 8 }}>
                  {QUICK_REACTIONS.map(emoji => (
                    <button key={emoji} type="button" onClick={() => void toggleReaction(row, emoji)} title="React">
                      {emoji}
                    </button>
                  ))}{' '}
                  <button type="button" onClick={() => setComposer({ mode: 'reply', target: row })}>
                    Reply
                  </button>
                  {row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply') ? (
                    <>
                      {' '}
                      <button type="button" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={event => void submit(event)}>
        {composer.mode !== 'new' ? (
          <p>
            {composer.mode === 'reply' ? 'Replying to' : 'Editing'}: <em>{previewOf(composer.target.content)}</em>{' '}
            <button
              type="button"
              onClick={() => {
                setComposer({ mode: 'new' });
                setDraft('');
              }}
            >
              Cancel
            </button>
          </p>
        ) : null}
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          style={{ width: '100%' }}
          placeholder="Message (Enter sends, Shift+Enter for a new line)"
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim()}>
          {composer.mode === 'edit' ? 'Save' : 'Send'}
        </button>
      </form>
    </section>
  );
};
