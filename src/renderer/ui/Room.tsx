import { Bell, BellOff } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { BANNER_DELAY_MS, type ConnectionSnapshot, showsBanner } from '../app/connectionState';
import { type AssistantPeerId, type MessageRow, type PeerId, db } from '../app/database';
import { ASSISTANT_USERNAME, type AssistantChat } from '../domain/assistant/assistant';
import { isLiveFrame } from '../domain/chat/content';
import { getDraft, saveDraft } from '../domain/chat/drafts';
import type { ChatManager } from '../domain/chat/manager';
import { listMessages, markRoomRead, setRoomMuted } from '../domain/chat/messages';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { AssistantSettings } from '../../shared/desktop-api';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader } from './RoomHeader';
import { engineLabel, toolsLine } from './engines';
import { plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

/**
 * A contact's room sends through the chat manager. The Assistant's room
 * (local, not on chain) sends to the engine chosen in Settings instead and
 * has no replies, reactions or edits; its replies render as markdown.
 */
type Props = ({ peer: HexString; manager: ChatManager } | { peer: AssistantPeerId; assistant: AssistantChat }) & {
  /** The People-chain connection (contact rooms show a banner when it is down). */
  connection?: ConnectionSnapshot;
};

type Mode = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

/** How long typing pauses before the draft is saved (M6 step 2). */
const DRAFT_SAVE_MS = 300;

/** Delete acts at once and can be undone this long; then it is sent (M7 step 3). */
const DELETE_UNDO_MS = 6000;

const noActivity = { subscribe: () => () => undefined, snapshot: () => null };

/** "Reconnecting to the People chain…" once the connection has been down 5 s. */
const ReconnectBanner = ({ connection }: { connection: ConnectionSnapshot }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const since = connection.state === 'connected' ? null : connection.notConnectedSince;
    const wait = since === null ? 0 : since + BANNER_DELAY_MS - Date.now();
    const timer = setTimeout(() => setVisible(showsBanner(connection, Date.now())), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [connection]);
  if (!visible || connection.state === 'connected') return null;
  return (
    <p className="mx-4 mb-1 rounded-nested bg-surface-nested px-3 py-2 text-body-s text-fg-secondary" role="status" data-testid="reconnect-banner">
      Reconnecting to the People chain…
    </p>
  );
};

const MuteButton = ({ peer, muted }: { peer: PeerId; muted: boolean }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full font-normal"
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        data-testid="mute-toggle"
        onClick={() => void setRoomMuted(peer, !muted)}
      >
        {muted ? <BellOff className="size-5 text-fg-secondary" /> : <Bell className="size-5 text-fg-secondary" />}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{muted ? 'Unmute' : 'Mute'}</TooltipContent>
  </Tooltip>
);

export const Room = (props: Props) => {
  const { peer, connection } = props;
  const manager = 'manager' in props ? props.manager : null;
  const assistant = 'assistant' in props ? props.assistant : null;
  const contact = useLiveQuery(async () => (manager ? db.contacts.get(peer as HexString) : undefined), [peer, manager]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const room = useLiveQuery(() => db.rooms.get(peer), [peer]);
  const requests = useLiveQuery(() => db.requests.where('peerAccountId').equals(peer).toArray(), [peer]);
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());

  const activityStore = assistant ? { subscribe: assistant.onActivity, snapshot: assistant.activity } : noActivity;
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.snapshot);

  useEffect(() => {
    if (!assistant) return;
    let active = true;
    window.desktop?.assistant.getSettings().then(
      settings => {
        if (active) setAssistantSettings(settings);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [assistant]);

  // ── Draft: restored when the room opens, saved 300 ms after typing stops.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const latestDraft = useRef({ text: '', dirty: false });
  useEffect(() => {
    let active = true;
    void getDraft(peer).then(text => {
      if (!active) return;
      if (text) setDraft(current => current || text);
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [peer]);
  useEffect(() => {
    // Edit text is the old message, not a draft.
    if (!draftLoaded || mode.mode === 'edit') return;
    latestDraft.current = { text: draft, dirty: true };
    const timer = setTimeout(() => {
      latestDraft.current.dirty = false;
      void saveDraft(peer, draft);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, mode.mode, peer]);
  // Leaving the room within 300 ms of a keystroke still keeps it.
  useEffect(
    () => () => {
      if (latestDraft.current.dirty) void saveDraft(peer, latestDraft.current.text);
    },
    [peer],
  );

  // ── Unread: "New messages" sits above the first message that was unread
  // when the room opened; it stays there while the room is open.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (firstUnreadId !== undefined || !messages || room === undefined) return;
    const count = room?.unreadCount ?? 0;
    const incoming = messages.filter(row => row.direction === 'incoming');
    const anchor = count > 0 ? (incoming[Math.max(0, incoming.length - count)]?.messageId ?? null) : null;
    // Set once, off the render path.
    void Promise.resolve().then(() => setFirstUnreadId(anchor));
  }, [messages, room, firstUnreadId]);

  const unread = room?.unreadCount ?? 0;
  const markSeen = () => {
    if (unread === 0) return;
    void (manager ? manager.markRead(peer as HexString) : markRoomRead(peer));
  };

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

  const retry = async (row: MessageRow) => {
    if (!manager) return;
    setError(null);
    try {
      await manager.retry(peer as HexString, row.messageId);
    } catch (cause) {
      setError(`${plainError(cause, 'The message was not sent.')} Try again.`);
    }
  };

  const markDeleting = (messageId: string, on: boolean) =>
    setDeleting(current => {
      const next = new Set(current);
      if (on) next.add(messageId);
      else next.delete(messageId);
      return next;
    });

  // Act, then undo (design system §10): no confirm. The bubble says
  // "Deleting…" while Undo is offered; the deletion is sent when it ends.
  // It is committed even if the room is closed meanwhile.
  const requestDelete = (row: MessageRow) => {
    setError(null);
    markDeleting(row.messageId, true);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      const work = assistant
        ? assistant.deleteMessage(row.messageId)
        : manager
          ? manager.deleteForEveryone(peer as HexString, row.messageId)
          : Promise.resolve();
      work
        .catch((cause: unknown) => setError(`${plainError(cause, 'The message was not deleted.')} Try again.`))
        .finally(() => markDeleting(row.messageId, false));
    }, DELETE_UNDO_MS);
    toast('Message deleted', {
      // RFC-0003: delete for everyone is a request to the peer's device, never a guarantee.
      ...(assistant ? {} : { description: 'This asks their device to delete it.' }),
      duration: DELETE_UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(commit);
          markDeleting(row.messageId, false);
        },
      },
    });
  };

  const isEditable = (row: MessageRow) =>
    row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply') && !deleting.has(row.messageId);
  const startEdit = (row: MessageRow) => {
    setMode({ mode: 'edit', target: row });
    setDraft(messagePreview(row));
  };

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    // A tombstone, a message on its way out, and a bot's live frame take no actions.
    if (row.content.type === 'deleted' || deleting.has(row.messageId) || (manager && isLiveFrame(row.content))) return null;
    if (!manager) {
      // The Assistant: Copy text, and Delete (local only) once a reply is finished.
      return row.content.type === 'text' && row.status !== 'streaming' ? { remove: { label: 'Delete', run: () => requestDelete(row) } } : {};
    }
    return {
      react: emoji => void toggleReaction(row, emoji),
      reply: () => setMode({ mode: 'reply', target: row }),
      edit: isEditable(row) ? () => startEdit(row) : undefined,
      retry: row.direction === 'outgoing' && row.status === 'failed' ? () => void retry(row) : undefined,
      remove: isEditable(row) ? { label: 'Delete for everyone', run: () => requestDelete(row) } : undefined,
    };
  };

  // Up arrow in an empty field edits your last text message (contacts only).
  const lastOwnText = manager ? [...(messages ?? [])].reverse().find(row => isEditable(row) && row.status !== 'failed') : undefined;

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
  const muted = room?.muted === true;

  return (
    <>
      <RoomHeader
        avatar={assistant ? <AssistantAvatar /> : <PeerAvatar name={name || '?'} />}
        name={name}
        status={
          assistant ? (
            assistantSettings ? (
              <span data-testid="assistant-engine">
                {engineLabel(assistantSettings.engine)}, in this app · {toolsLine(assistantSettings.tools)}
              </span>
            ) : (
              'AI, in this app'
            )
          ) : noDevice ? (
            <span className="text-fg-warning">No device of this contact is known yet, so messages cannot be delivered.</span>
          ) : undefined
        }
      >
        {room ? <MuteButton peer={peer} muted={muted} /> : null}
      </RoomHeader>
      {!assistant && connection ? <ReconnectBanner connection={connection} /> : null}
      <MessageFlow
        rows={messages ?? []}
        peerName={name}
        requests={requests ?? []}
        assistant={assistant !== null}
        actionsFor={actionsFor}
        firstUnreadId={firstUnreadId ?? null}
        unread={unread}
        onSeen={markSeen}
        noteFor={row => (activity && row.messageId === activity.messageId && row.status === 'streaming' ? activity.title : null)}
        deleting={deleting}
        reveal={prefs.revealReplies}
      />
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
        sendKey={prefs.sendKey}
        onEditLast={lastOwnText ? () => startEdit(lastOwnText) : undefined}
      />
    </>
  );
};
