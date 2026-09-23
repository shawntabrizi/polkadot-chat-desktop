import { useEffect, useState } from 'react';

import type { HexString } from '../app/bytes';
import { type AssistantPeerId, type MessageRow, db } from '../app/database';
import { ASSISTANT_USERNAME, type AssistantChat } from '../domain/assistant/assistant';
import type { ChatManager } from '../domain/chat/manager';
import { listMessages, markRoomRead } from '../domain/chat/messages';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader } from './RoomHeader';
import { plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

/**
 * A contact's room sends through the chat manager. The Assistant's room
 * (local, not on chain) sends to the LLM proxy instead and has no replies,
 * reactions or edits; its replies render as markdown.
 */
type Props = { peer: HexString; manager: ChatManager } | { peer: AssistantPeerId; assistant: AssistantChat };

type Mode = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

export const Room = (props: Props) => {
  const { peer } = props;
  const manager = 'manager' in props ? props.manager : null;
  const assistant = 'assistant' in props ? props.assistant : null;
  const contact = useLiveQuery(async () => (manager ? db.contacts.get(peer as HexString) : undefined), [peer, manager]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const requests = useLiveQuery(() => db.requests.where('peerAccountId').equals(peer).toArray(), [peer]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);

  // Everything that arrives while the room is open is read.
  const messageCount = messages?.length ?? 0;
  useEffect(() => {
    void (manager ? manager.markRead(peer as HexString) : markRoomRead(peer));
  }, [manager, peer, messageCount]);

  // One assistant reply at a time: Send waits until it ends or is stopped.
  const answering = assistant !== null && (messages ?? []).some(row => row.status === 'streaming');
  const name = assistant ? ASSISTANT_USERNAME : (contact?.username ?? '');

  const submit = async () => {
    const text = draft.trim();
    if (!text || answering) return;
    setError(null);
    const current = mode;
    setDraft('');
    setMode({ mode: 'new' });
    try {
      if (assistant) await assistant.send(text);
      else if (!manager) return;
      else if (current.mode === 'edit') await manager.edit(peer as HexString, current.target.messageId, text);
      else if (current.mode === 'reply') await manager.sendMessage(peer as HexString, { type: 'reply', messageId: current.target.messageId, text });
      else await manager.sendMessage(peer as HexString, { type: 'text', text });
    } catch (cause) {
      // Keep the text: losing it on top of the failure is worse.
      setDraft(text);
      setError(`${plainError(cause, 'The message was not sent.')} Your text is back in the field; send it again.`);
    }
  };

  const toggleReaction = async (row: MessageRow, emoji: string) => {
    if (!manager) return;
    const mine = row.reactions.some(r => r.emoji === emoji && r.by === 'me');
    setError(null);
    try {
      await manager.react(peer as HexString, row.messageId, emoji, !mine);
    } catch (cause) {
      setError(`${plainError(cause, 'The reaction was not sent.')} Try again.`);
    }
  };

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    if (!manager) return {}; // The Assistant: Copy text only.
    const editable = row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply');
    return {
      react: emoji => void toggleReaction(row, emoji),
      reply: () => setMode({ mode: 'reply', target: row }),
      edit: editable
        ? () => {
            setMode({ mode: 'edit', target: row });
            setDraft(messagePreview(row));
          }
        : undefined,
    };
  };

  const context =
    mode.mode === 'new'
      ? null
      : {
          title: mode.mode === 'edit' ? 'Editing message' : mode.target.direction === 'outgoing' ? 'Reply to yourself' : `Reply to ${name}`,
          text: messagePreview(mode.target),
          onClose: () => {
            if (mode.mode === 'edit') setDraft('');
            setMode({ mode: 'new' });
          },
        };

  const noDevice = contact !== undefined && contact.devices.length === 0;

  return (
    <>
      <RoomHeader
        avatar={assistant ? <AssistantAvatar /> : <PeerAvatar name={name || '?'} />}
        name={name}
        status={
          assistant ? (
            'AI, in this app'
          ) : noDevice ? (
            <span className="text-fg-warning">No device of this contact is known yet, so messages cannot be delivered.</span>
          ) : undefined
        }
      />
      <MessageFlow rows={messages ?? []} peerName={name} requests={requests ?? []} assistant={assistant !== null} actionsFor={actionsFor} />
      {error ? (
        <p role="alert" className="px-4 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      <Composer
        draft={draft}
        onDraft={setDraft}
        onSend={() => void submit()}
        context={context}
        sendDisabled={answering}
        onStop={answering ? () => void assistant?.stop() : undefined}
        sendLabel={mode.mode === 'edit' ? 'Save' : 'Send'}
      />
    </>
  );
};
