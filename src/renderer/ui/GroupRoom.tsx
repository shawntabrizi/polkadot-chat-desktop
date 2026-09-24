// Spec 0009 fan-out groups (M12 step 3): the group room, its members side
// panel, and the "New group" view. Side panel and inline views, never a modal
// (.refs/polkadot-design-system SKILL.md §10 "Avoid modals"); Remove shows on
// row hover and Leave is a Danger button at `rounded-medium`; both act at
// once and can be undone for a few seconds (§10 "Destructive Actions Must Be
// Undoable").

import { Bell, BellOff, UserPlus, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { type ContactRow, type GroupRow, type MessageRow, type PeerInfoRow, db, groupPeerOf } from '../app/database';
import type { BotCommand } from '../domain/chat/content';
import { getDraft, saveDraft } from '../domain/chat/drafts';
import { getGroup, memberName } from '../domain/chat/groups';
import type { ChatManager } from '../domain/chat/manager';
import { forwardText } from '../domain/chat/chatActions';
import { listMessages, setRoomMuted } from '../domain/chat/messages';
import { clearKey } from '../domain/chat/undo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import { GroupAvatar, PeerAvatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { memberCount } from './ChatList';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader } from './RoomHeader';
import { type ForwardTarget, RoomMenu, useChatActions, usePending } from './chatActions';
import { Checkbox } from './controls';
import { plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

/** Remove, Leave and Delete act at once and can be undone this long. */
const UNDO_MS = 6000;
const DRAFT_SAVE_MS = 300;
const NO_ROWS: readonly MessageRow[] = [];

type Mode = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

/** A member's line in the panel: what this client knows about reaching them. */
export const memberStatus = (group: GroupRow, account: HexString, self: HexString, contacts: readonly ContactRow[]): 'left' | 'invited' | 'member' => {
  if (group.left.includes(account)) return 'left';
  if (account !== self && !contacts.some(contact => contact.accountId === account)) return 'invited';
  return 'member';
};

const IconToggle = ({ label, pressed, onClick, children, testId }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode; testId?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        data-testid={testId}
        onClick={onClick}
        className={cn('rounded-full font-normal', pressed && 'bg-selection-container-active')}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

type PanelProps = {
  group: GroupRow;
  self: HexString;
  contacts: readonly ContactRow[];
  peerInfo: ReadonlyMap<string, PeerInfoRow>;
  manager: ChatManager;
  onClose: () => void;
};

/** The members side panel: who is in, their state; the admin adds and removes; anyone leaves. */
const MembersPanel = ({ group, self, contacts, peerInfo, manager, onClose }: PanelProps) => {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const admin = group.admin === self;
  const active = group.self === 'member';
  const needle = query.trim().toLowerCase();
  const candidates =
    admin && needle !== ''
      ? contacts.filter(contact => !group.members.some(member => member.account === contact.accountId) && contact.username.toLowerCase().includes(needle)).slice(0, 5)
      : [];

  const others = (without: HexString | null) =>
    group.members.filter(member => member.account !== self && member.account !== without).map(member => ({ account: member.account, username: member.username }));

  const run = (work: Promise<void>, what: string) => work.catch((cause: unknown) => setError(`${plainError(cause, what)} Try again.`));

  const add = (contact: ContactRow) => {
    setError(null);
    setQuery('');
    void run(manager.updateRoster(group.id, [...others(null), { account: contact.accountId, username: contact.username }]), 'The member was not added.');
  };

  const later = (key: string, label: string, commit: () => Promise<void>) => {
    setError(null);
    setPending(current => new Set(current).add(key));
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      void run(commit(), `${label} did not go through.`).finally(() =>
        setPending(current => {
          const next = new Set(current);
          next.delete(key);
          return next;
        }),
      );
    }, UNDO_MS);
    toast(label, {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(timer);
          setPending(current => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        },
      },
    });
  };

  return (
    <aside className="m-2 ms-0 flex w-72 shrink-0 flex-col overflow-hidden rounded-nested bg-surface-nested" aria-label="Members" data-testid="members-panel">
      <div className="flex h-12 shrink-0 items-center justify-between ps-4 pe-2">
        <h3 className="text-heading-s text-fg-primary">Members · {group.members.length}</h3>
        <Button variant="ghost" size="icon-sm" className="rounded-full font-normal" aria-label="Close members" onClick={onClose}>
          <X className="size-4 text-fg-secondary" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {group.members.map(member => {
          const status = memberStatus(group, member.account, self, contacts);
          const removing = pending.has(`remove:${member.account}`);
          const info = peerInfo.get(member.account)?.botInfo;
          const words = [member.account === self ? 'you' : null, member.account === group.admin ? 'admin' : null, removing ? 'removing…' : status].filter(Boolean).join(' · ');
          return (
            <div
              key={member.account}
              className="group/member flex items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-container focus-within:bg-surface-container"
              data-testid="member-row"
              data-status={status}
            >
              <PeerAvatar name={member.username} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-label-m text-fg-primary">{member.username}</span>
                  {info ? <BotBadge kind={info.kind} /> : null}
                </div>
                <p className={cn('text-caption', status === 'member' ? 'text-fg-tertiary' : 'text-fg-warning')}>{words}</p>
              </div>
              {admin && active && member.account !== self && !removing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer rounded-medium font-normal text-fg-error opacity-0 transition-opacity group-hover/member:opacity-100 focus-visible:opacity-100"
                  data-testid="member-remove"
                  onClick={() => later(`remove:${member.account}`, `${member.username} removed`, () => manager.updateRoster(group.id, others(member.account)))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {admin && active ? (
        <div className="flex shrink-0 flex-col gap-1 px-4 pt-2">
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Add member"
            aria-label="Add member"
            autoComplete="off"
            spellCheck={false}
            className="h-9 rounded-nested bg-surface-container px-2 text-body-m md:text-body-m"
          />
          {candidates.map(contact => (
            <button
              key={contact.accountId}
              type="button"
              onClick={() => add(contact)}
              className="flex cursor-pointer items-center gap-2 rounded-nested px-2 py-1.5 text-left transition-colors hover:bg-surface-container"
              data-testid="member-candidate"
            >
              <UserPlus className="size-4 text-fg-secondary" aria-hidden />
              <span className="truncate text-body-m text-fg-primary">{contact.username}</span>
            </button>
          ))}
          {needle !== '' && candidates.length === 0 ? <p className="px-2 py-1 text-body-s text-fg-tertiary">No contact with that name.</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 pt-2 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      <div className="shrink-0 p-4">
        {active ? (
          <Button
            variant="destructive"
            className="cursor-pointer rounded-medium"
            data-testid="group-leave"
            disabled={pending.has('leave')}
            onClick={() => later('leave', `You left ${group.name}`, () => manager.leaveGroup(group.id))}
          >
            {pending.has('leave') ? 'Leaving…' : 'Leave group'}
          </Button>
        ) : (
          <p className="text-body-s text-fg-secondary">{group.self === 'removed' ? 'You were removed from this group.' : 'You left this group.'}</p>
        )}
      </div>
    </aside>
  );
};

type RoomProps = {
  groupId: string;
  manager: ChatManager;
  self: HexString;
  scrollToMessageId?: string | null;
  scrollRequest?: number;
};

/** One room per group: the composer fans out, each peer bubble names its sender. */
export const GroupRoom = ({ groupId, manager, self, scrollToMessageId = null, scrollRequest = 0 }: RoomProps) => {
  const peer = groupPeerOf(groupId);
  const group = useLiveQuery(() => getGroup(groupId), [groupId]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const room = useLiveQuery(() => db.rooms.get(peer), [peer]);
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const peerInfoRows = useLiveQuery(() => db.peerInfo.toArray(), []) ?? [];
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());
  const peerInfo = new Map(peerInfoRows.map(row => [row.peerId, row]));
  const chatActions = useChatActions();
  // "Clear history" waits out its Undo time with the messages hidden (M12e).
  const clearing = usePending().has(clearKey(peer));

  // Draft: restored when the room opens, saved 300 ms after typing stops.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const latestDraft = useRef({ text: '', dirty: false });
  useEffect(() => {
    let live = true;
    void getDraft(peer).then(text => {
      if (!live) return;
      if (text) setDraft(current => current || text);
      setDraftLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [peer]);
  useEffect(() => {
    if (!draftLoaded || mode.mode === 'edit') return;
    latestDraft.current = { text: draft, dirty: true };
    const timer = setTimeout(() => {
      latestDraft.current.dirty = false;
      void saveDraft(peer, draft);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, mode.mode, peer]);
  useEffect(
    () => () => {
      if (latestDraft.current.dirty) void saveDraft(peer, latestDraft.current.text);
    },
    [peer],
  );

  if (!group) return null;
  const active = group.self === 'member';
  const senderOf = (row: MessageRow) => (row.senderAccountId ? memberName(group, row.senderAccountId) : null);
  // The commands of the bots in the group (spec 0008), once each.
  const commands: BotCommand[] = [];
  for (const member of group.members) {
    for (const command of peerInfo.get(member.account)?.botInfo?.commands ?? []) if (!commands.some(entry => entry.name === command.name)) commands.push(command);
  }

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    const current = mode;
    setDraft('');
    setMode({ mode: 'new' });
    try {
      if (current.mode === 'edit') await manager.edit(peer, current.target.messageId, text);
      else if (current.mode === 'reply') await manager.sendMessage(peer, { type: 'reply', messageId: current.target.messageId, text });
      else await manager.sendMessage(peer, { type: 'text', text });
    } catch (cause) {
      setDraft(text);
      setError(`${plainError(cause, 'The message was not sent.')} Your text is back in the field; send it again.`);
    }
  };

  const markDeleting = (messageId: string, on: boolean) =>
    setDeleting(current => {
      const next = new Set(current);
      if (on) next.add(messageId);
      else next.delete(messageId);
      return next;
    });

  const requestDelete = (row: MessageRow) => {
    setError(null);
    markDeleting(row.messageId, true);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      manager
        .deleteForEveryone(peer, row.messageId)
        .catch((cause: unknown) => setError(`${plainError(cause, 'The message was not deleted.')} Try again.`))
        .finally(() => markDeleting(row.messageId, false));
    }, UNDO_MS);
    toast('Message deleted', {
      description: 'This asks every member’s device to delete it.',
      duration: UNDO_MS,
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

  const guarded = (work: Promise<void>, what: string) => void work.catch((cause: unknown) => setError(`${plainError(cause, what)} Try again.`));
  const isOwnText = (row: MessageRow) => row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply') && !deleting.has(row.messageId);

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    if (row.content.type === 'deleted' || deleting.has(row.messageId) || !active) return null;
    const keyboard =
      row.content.type === 'buttons' && row.direction === 'incoming'
        ? {
            // v1: command, callback and url buttons; a `tx` button needs the 1:1 signing strip (docs/decisions.md M12).
            press: (r: number, i: number) => {
              if (row.content.type !== 'buttons') return;
              const action = row.content.rows[r]?.[i]?.action;
              if (!action || action.kind === 'tx' || action.kind === 'unsupported') return;
              const open = action.kind === 'url' && window.desktop ? window.desktop.app.openUrl(action.url) : Promise.resolve();
              guarded(
                open.then(() => manager.pressButton(peer, row.messageId, r, i)),
                'The button did not work.',
              );
            },
            active: null,
          }
        : undefined;
    // M12e Forward: a copy of the text, captioned with its author on this device only.
    const author = row.direction === 'outgoing' ? 'you' : (senderOf(row) ?? group.name);
    const forward = forwardText(row) !== null ? (target: ForwardTarget) => chatActions.forward(target, row, author) : undefined;
    return {
      ...(keyboard ? { keyboard } : {}),
      ...(forward ? { forward } : {}),
      react: emoji => guarded(manager.react(peer, row.messageId, emoji, !row.reactions.some(r => r.emoji === emoji && r.by === 'me')), 'The reaction was not sent.'),
      reply: () => setMode({ mode: 'reply', target: row }),
      edit: isOwnText(row)
        ? () => {
            setMode({ mode: 'edit', target: row });
            setDraft(messagePreview(row));
          }
        : undefined,
      retry: row.direction === 'outgoing' && row.status === 'failed' ? () => guarded(manager.retry(peer, row.messageId), 'The message was not sent.') : undefined,
      remove: isOwnText(row) ? { label: 'Delete for everyone', run: () => requestDelete(row) } : undefined,
    };
  };

  const context =
    mode.mode === 'new'
      ? null
      : {
          title: mode.mode === 'edit' ? 'Editing message' : mode.target.direction === 'outgoing' ? 'Reply to yourself' : `Reply to ${senderOf(mode.target) ?? 'message'}`,
          text: messagePreview(mode.target),
          onClose: () => {
            if (mode.mode === 'edit') setDraft('');
            setMode({ mode: 'new' });
          },
        };

  const muted = room?.muted === true;
  const unread = room?.unreadCount ?? 0;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <RoomHeader
          avatar={<GroupAvatar name={group.name} />}
          name={group.name}
          status={
            <span data-testid="group-status">
              {memberCount(group)} · admin {memberName(group, group.admin)}
            </span>
          }
        >
          <IconToggle label="Members" pressed={panel} onClick={() => setPanel(open => !open)} testId="members-toggle">
            <Users className="size-5 text-fg-secondary" />
          </IconToggle>
          {room ? (
            <IconToggle label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={() => void setRoomMuted(peer, !muted)} testId="mute-toggle">
              {muted ? <BellOff className="size-5 text-fg-secondary" /> : <Bell className="size-5 text-fg-secondary" />}
            </IconToggle>
          ) : null}
          <RoomMenu subject={{ peer, name: group.name, kind: 'group', room, member: active }} />
        </RoomHeader>
        <MessageFlow
          rows={clearing ? NO_ROWS : (messages ?? [])}
          peerName={group.name}
          requests={[]}
          assistant={false}
          actionsFor={actionsFor}
          unread={unread}
          onSeen={() => {
            if (unread > 0 || room?.markedUnread === true) void manager.markRead(peer);
          }}
          deleting={deleting}
          reveal={prefs.revealReplies}
          jumpTo={scrollToMessageId ? { messageId: scrollToMessageId, request: scrollRequest } : null}
          senderOf={senderOf}
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-heading-m text-fg-primary">No messages yet</p>
              <p className="text-body-m text-fg-secondary">Say hello to {memberCount(group)}</p>
            </div>
          }
        />
        {error ? (
          <p role="alert" className="px-4 text-body-s text-fg-error">
            {error}
          </p>
        ) : null}
        {active ? (
          <Composer
            draft={draft}
            onDraft={text => {
              setDraft(text);
              if (mode.mode !== 'edit') manager.composing(peer, text);
            }}
            onSend={() => void submit()}
            context={context}
            sendLabel={mode.mode === 'edit' ? 'Save' : 'Send'}
            sendKey={prefs.sendKey}
            commands={mode.mode === 'new' ? commands : []}
          />
        ) : (
          <p className="px-4 py-4 text-center text-body-m text-fg-secondary" data-testid="group-inactive">
            {group.self === 'removed' ? 'You were removed from this group.' : 'You left this group.'}
          </p>
        )}
      </div>
      {panel ? (
        <MembersPanel group={group} self={self} contacts={contacts} peerInfo={peerInfo} manager={manager} onClose={() => setPanel(false)} />
      ) : null}
    </div>
  );
};

type NewGroupProps = {
  manager: ChatManager | null;
  onCreated: (groupId: string) => void;
};

/** "New group": a name, contacts as checkbox rows, Create (the view's one main action). */
export const NewGroupRoom = ({ manager, onCreated }: NewGroupProps) => {
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const peerInfoRows = useLiveQuery(() => db.peerInfo.toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...contacts].sort((a, b) => a.username.localeCompare(b.username));
  const ready = name.trim() !== '' && picked.size > 0 && !busy && manager !== null;

  const toggle = (account: string) =>
    setPicked(current => {
      const next = new Set(current);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });

  const create = async () => {
    if (!ready || !manager) return;
    setError(null);
    setBusy(true);
    try {
      const members = sorted.filter(contact => picked.has(contact.accountId)).map(contact => ({ account: contact.accountId, username: contact.username }));
      onCreated(await manager.createGroup(name, members));
    } catch (cause) {
      setError(plainError(cause, 'The group was not created. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <>
      <RoomHeader avatar={<GroupAvatar name={name.trim() || 'Group'} />} name={name.trim() || 'New group'} status={`${picked.size + 1} ${picked.size === 0 ? 'member' : 'members'}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4" data-testid="new-group">
        <label className="flex max-w-md flex-col gap-1.5">
          <span className="text-label-m text-fg-primary">Group name</span>
          <Input
            value={name}
            maxLength={60}
            onChange={event => setName(event.target.value)}
            placeholder="Weekend plans"
            aria-label="Group name"
            className="h-10 rounded-nested px-2 text-body-m md:text-body-m"
          />
        </label>
        <section className="flex flex-col gap-1" aria-label="Members">
          <h3 className="text-label-m text-fg-primary">Members</h3>
          <p className="text-body-s text-fg-secondary">Pick from your contacts. Each gets the group on the chat you already share.</p>
          <div className="mt-1 flex max-w-md flex-col gap-0.5">
            {sorted.length === 0 ? <p className="py-2 text-body-s text-fg-tertiary">No contacts yet. Start a chat first.</p> : null}
            {sorted.map(contact => {
              const info = peerInfoRows.find(row => row.peerId === contact.accountId)?.botInfo;
              const checked = picked.has(contact.accountId);
              return (
                <label
                  key={contact.accountId}
                  className="flex cursor-pointer items-center gap-3 rounded-nested px-2 py-2 transition-colors hover:bg-selection-container-hover focus-within:bg-selection-container-hover"
                  data-testid="group-candidate"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(contact.accountId)} aria-label={contact.username} />
                  <PeerAvatar name={contact.username} size="sm" />
                  <span className="truncate text-label-m text-fg-primary">{contact.username}</span>
                  {info ? <BotBadge kind={info.kind} /> : null}
                </label>
              );
            })}
          </div>
        </section>
        {error ? (
          <p role="alert" className="text-body-s text-fg-error">
            {error}
          </p>
        ) : null}
        <Button className="h-auto w-fit cursor-pointer rounded-full px-8 py-3 text-label-l disabled:cursor-not-allowed" disabled={!ready} onClick={() => void create()} data-testid="group-create">
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </>
  );
};
