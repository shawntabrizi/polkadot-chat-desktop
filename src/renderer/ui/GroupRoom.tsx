// Spec 0009 fan-out groups (M12 step 3): the group room, its members side
// panel, and the "New group" view. Side panel and inline views, never a modal
// (.refs/polkadot-design-system SKILL.md §10 "Avoid modals"); Remove shows on
// row hover and Leave is a Danger button at `rounded-medium`; both act at
// once and can be undone for a few seconds (§10 "Destructive Actions Must Be
// Undoable").

import { Bell, BellOff, ChevronDown, Pin, UserPlus, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { type ContactRow, type GroupRow, type MessageRow, type PeerCapabilitiesRow, type PeerInfoRow, db, groupPeerOf } from '../app/database';
import { hexToBytes } from '../app/bytes';
import { type TxRunner, referenceNote } from '../domain/chain/transactions';
import { GROUP_SUPPORT_WORDS, type GroupSupport, groupSupportOf, loadAnsweredPeers } from '../domain/chat/capabilities';
import type { BotCommand, TxStatus } from '../domain/chat/content';
import { getDraft, saveDraft } from '../domain/chat/drafts';
import { PERMISSIONS, ROLES } from '../domain/chat/groupCodec';
import { derivedName, groupDisplayName } from '../domain/chat/groupNames';
import { getGroup, memberName } from '../domain/chat/groups';
import { can, heirOf, isV2, memberOf, slowModeWait, slowModeWords } from '../domain/chat/groupsV2';
import type { ChatManager } from '../domain/chat/manager';
import { forwardText } from '../domain/chat/chatActions';
import { listMessages, setRoomMuted } from '../domain/chat/messages';
import { phaseLine, proposalViews } from '../domain/chat/proposals';
import { clearKey } from '../domain/chat/undo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import { GroupAvatar, PeerAvatar } from './Avatar';
import { GroupSettings, InviteSection, JoinRequests, RoleEditor, mayManage } from './GroupAdmin';
import { BotBadge } from './BotBadge';
import { memberCount } from './ChatList';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader } from './RoomHeader';
import { type ForwardTarget, RoomMenu, useChatActions, usePending } from './chatActions';
import { Checkbox } from './controls';
import { plainError } from './format';
import { ProposalStatus, useNow } from './ProposalCard';
import { type StripPhase, TxStrip } from './Transactions';
import { intentExpired } from './txButton';
import { useLiveQuery } from './useLiveQuery';

import { type TxIntent, decodeTxIntent } from '../../shared/txIntent';

/** Remove, Leave and Delete act at once and can be undone this long. */
const UNDO_MS = 6000;
const DRAFT_SAVE_MS = 300;
const NO_ROWS: readonly MessageRow[] = [];
const NO_PEERS: ReadonlySet<string> = new Set();

type Mode = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

/** A member's line in the panel: what this client knows about reaching them. */
export const memberStatus = (group: GroupRow, account: HexString, self: HexString, contacts: readonly ContactRow[]): 'left' | 'invited' | 'member' => {
  if (group.left.includes(account)) return 'left';
  if (account !== self && !contacts.some(contact => contact.accountId === account)) return 'invited';
  return 'member';
};

/**
 * Owner ask 2026-09-24: may this contact be picked for a private group? Only
 * when every known device advertised groups v2 (0013 feature bit 0; a bot by
 * its `botInfo`). The manager checks the same again before anything is sent.
 */
export const contactGroupSupport = (
  contact: ContactRow,
  capabilities: readonly PeerCapabilitiesRow[],
  peerInfo: ReadonlyMap<string, PeerInfoRow>,
  answered: ReadonlySet<string> = NO_PEERS,
): GroupSupport =>
  groupSupportOf(
    contact.devices,
    capabilities.filter(row => row.peer === contact.accountId),
    (peerInfo.get(contact.accountId)?.botInfo ?? null) !== null,
    hexToBytes(contact.accountId),
    answered.has(contact.accountId),
  );

/** A contact the picker cannot take: greyed, with the reason as its caption and on hover. */
const GatedReason = ({ support }: { support: GroupSupport }) =>
  support === 'ready' ? null : (
    <span className="block truncate text-caption text-fg-tertiary" data-testid="candidate-reason">
      {GROUP_SUPPORT_WORDS[support]}
    </span>
  );

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
  capabilities: readonly PeerCapabilitiesRow[];
  peerInfo: ReadonlyMap<string, PeerInfoRow>;
  /** Contacts that answered our set without one of their own (`loadAnsweredPeers`). */
  answered: ReadonlySet<string>;
  manager: ChatManager;
  onClose: () => void;
};

/** Spec 0011 role words for the members panel. */
export const roleWord = (role: number): string => (role === ROLES.owner ? 'owner' : role === ROLES.admin ? 'admin' : 'member');

/**
 * May `self` remove `account` from this group? v1: the admin removes anyone
 * else. v2 (0011): the owner, or an admin with `remove members`; nobody
 * removes the owner, and only the owner removes an admin.
 */
export const mayRemove = (group: GroupRow, self: HexString, account: HexString): boolean => {
  if (account === self || group.self !== 'member') return false;
  if (!isV2(group)) return group.admin === self;
  const me = memberOf(group.state, self);
  const target = memberOf(group.state, account);
  if (!target || !can(me, PERMISSIONS.remove) || target.role === ROLES.owner) return false;
  return target.role < ROLES.admin || me?.role === ROLES.owner;
};

/** The members side panel: who is in, their state; the admin adds and removes; anyone leaves. */
const MembersPanel = ({ group, self, contacts, capabilities, peerInfo, answered, manager, onClose }: PanelProps) => {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HexString | null>(null);
  const v2 = isV2(group);
  const me = v2 ? memberOf(group.state, self) : null;
  const admin = v2 ? can(me, PERMISSIONS.add) : group.admin === self;
  // 0011 heir rule: the owner leaving hands the group to the longest-standing admin.
  const heir = v2 && me?.role === ROLES.owner && group.state ? heirOf(group.state) : null;
  const ownerStuck = v2 && me?.role === ROLES.owner && !heir;
  const active = group.self === 'member';
  const needle = query.trim().toLowerCase();
  const candidates =
    admin && needle !== ''
      ? contacts.filter(contact => !group.members.some(member => member.account === contact.accountId) && contact.username.toLowerCase().includes(needle)).slice(0, 5)
      : [];

  const others = (without: HexString | null) =>
    group.members.filter(member => member.account !== self && member.account !== without).map(member => ({ account: member.account, username: member.username }));

  const run = (work: Promise<void>, what: string) => {
    setError(null);
    return work.catch((cause: unknown) => setError(`${plainError(cause, what)} Try again.`));
  };

  const add = (contact: ContactRow) => {
    if (v2 && contactGroupSupport(contact, capabilities, peerInfo, answered) !== 'ready') return;
    setError(null);
    setQuery('');
    const member = { account: contact.accountId, username: contact.username };
    void run(v2 ? manager.addGroupMember(group.id, member) : manager.updateRoster(group.id, [...others(null), member]), 'The member was not added.');
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
          const role = v2 ? roleWord(memberOf(group.state, member.account)?.role ?? ROLES.member) : member.account === group.admin ? 'admin' : null;
          // v2: the role is the state; "member" alone says nothing new next to a member's role.
          const state = removing ? 'removing…' : v2 && status === 'member' ? null : status;
          const words = [member.account === self ? 'you' : null, role, state].filter(Boolean).join(' · ');
          const manageable = v2 && active && mayManage(group, self, member.account);
          const open = manageable && editing === member.account;
          const who = (
            <>
              <PeerAvatar name={member.username} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-label-m text-fg-primary">{member.username}</span>
                  {info ? <BotBadge kind={info.kind} /> : null}
                </div>
                <p className={cn('text-caption', status === 'member' ? 'text-fg-tertiary' : 'text-fg-warning')} data-testid="member-role">
                  {words}
                </p>
              </div>
            </>
          );
          return (
            <div key={member.account} className={cn(open && 'bg-surface-container')}>
            <div
              className="group/member flex items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-container focus-within:bg-surface-container"
              data-testid="member-row"
              data-status={status}
            >
              {manageable ? (
                // M16b: the role and flags open inline under the row.
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  aria-expanded={open}
                  aria-label={`Role of ${member.username}`}
                  data-testid="member-manage"
                  onClick={() => setEditing(current => (current === member.account ? null : member.account))}
                >
                  {who}
                  <ChevronDown className={cn('size-4 shrink-0 text-fg-tertiary transition-transform', open && 'rotate-180')} aria-hidden />
                </button>
              ) : (
                who
              )}
              {mayRemove(group, self, member.account) && !removing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer rounded-medium font-normal text-fg-error opacity-0 transition-opacity group-hover/member:opacity-100 focus-visible:opacity-100"
                  data-testid="member-remove"
                  onClick={() =>
                    later(`remove:${member.account}`, `${member.username} removed`, () =>
                      v2 ? manager.removeGroupMember(group.id, member.account) : manager.updateRoster(group.id, others(member.account)),
                    )
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {open ? <RoleEditor group={group} self={self} member={member} manager={manager} run={run} /> : null}
            </div>
          );
        })}
        {v2 && active && (can(me, PERMISSIONS.approve) || can(me, PERMISSIONS.add)) ? <JoinRequests group={group} manager={manager} run={run} /> : null}
        {v2 && active && can(me, PERMISSIONS.add) ? <InviteSection group={group} manager={manager} run={run} later={later} /> : null}
        {v2 && active && can(me, PERMISSIONS.info) ? (
          <GroupSettings key={group.name} group={group} derived={groupDisplayName({ ...group, name: '' }, self, contacts)} manager={manager} run={run} />
        ) : null}
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
          {candidates.map(contact => {
            // A v1 room fans out by kind (0013 gate per message); a private group takes only capable contacts.
            const support = v2 ? contactGroupSupport(contact, capabilities, peerInfo, answered) : 'ready';
            const gated = support !== 'ready';
            return (
              <button
                key={contact.accountId}
                type="button"
                onClick={() => add(contact)}
                disabled={gated}
                title={gated ? GROUP_SUPPORT_WORDS[support] : undefined}
                className="flex cursor-pointer items-center gap-2 rounded-nested px-2 py-1.5 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:hover:bg-transparent"
                data-testid="member-candidate"
                data-gated={gated || undefined}
              >
                <UserPlus className={cn('size-4 shrink-0', gated ? 'text-fg-tertiary' : 'text-fg-secondary')} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block truncate text-body-m', gated ? 'text-fg-tertiary' : 'text-fg-primary')}>{contact.username}</span>
                  <GatedReason support={support} />
                </span>
              </button>
            );
          })}
          {needle !== '' && candidates.length === 0 ? <p className="px-2 py-1 text-body-s text-fg-tertiary">No contact with that name.</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 pt-2 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      <div className="flex shrink-0 flex-col items-start gap-2 p-4">
        {!v2 && active && group.admin === self ? (
          // 0011 Compatibility: the v1 admin opens epoch 1 from this roster; the room keeps its messages.
          <Button
            variant="secondary"
            className="cursor-pointer rounded-medium"
            data-testid="group-upgrade"
            disabled={pending.has('upgrade')}
            onClick={() => {
              setError(null);
              setPending(current => new Set(current).add('upgrade'));
              void run(manager.upgradeGroup(group.id), 'The group was not upgraded.').finally(() =>
                setPending(current => {
                  const next = new Set(current);
                  next.delete('upgrade');
                  return next;
                }),
              );
            }}
          >
            {pending.has('upgrade') ? 'Upgrading…' : 'Upgrade to private group'}
          </Button>
        ) : null}
        {active ? (
          <>
            {heir ? <p className="text-body-s text-fg-secondary">When you leave, {memberName(group, heir.account)} becomes the owner.</p> : null}
            {ownerStuck ? <p className="text-body-s text-fg-secondary">Make someone an admin first: the longest-standing admin becomes the owner when you leave.</p> : null}
            <Button
              variant="destructive"
              className="cursor-pointer rounded-medium"
              data-testid="group-leave"
              disabled={pending.has('leave') || ownerStuck}
              onClick={() => later('leave', `You left ${groupDisplayName(group, self, contacts)}`, () => manager.leaveGroup(group.id))}
            >
              {pending.has('leave') ? 'Leaving…' : 'Leave group'}
            </Button>
          </>
        ) : (
          <p className="text-body-s text-fg-secondary">{group.self === 'removed' ? 'You were removed from this group.' : 'You left this group.'}</p>
        )}
      </div>
    </aside>
  );
};

/**
 * M16b: the group's pinned messages (the state, so every member sees the
 * same), newest first. A click jumps to the message and moves on to the next
 * pin, as Telegram's bar does. Inline at the top of the room, never an overlay.
 */
const PinBar = ({
  pinned,
  rows,
  canUnpin,
  onJump,
  onUnpin,
  previewOf,
}: {
  pinned: readonly string[];
  rows: readonly MessageRow[];
  canUnpin: boolean;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  /** M14: a proposal pin says its state ("… · Voting closes in 1 min 5 s"). */
  previewOf: (row: MessageRow) => string;
}) => {
  const [at, setAt] = useState(0);
  if (pinned.length === 0) return null;
  const newestFirst = [...pinned].reverse();
  const index = Math.min(at, newestFirst.length - 1);
  const id = newestFirst[index]!;
  const row = rows.find(r => r.messageId === id);
  return (
    <div className="mx-4 mb-1 flex shrink-0 items-center gap-1 rounded-nested bg-surface-nested pe-1" data-testid="pin-bar">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-nested px-3 py-2 text-left transition-colors hover:bg-surface-container"
        onClick={() => {
          onJump(id);
          setAt((index + 1) % newestFirst.length);
        }}
      >
        <Pin className="size-4 shrink-0 text-fg-secondary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-label-m text-fg-primary">{newestFirst.length > 1 ? `Pinned message ${index + 1} of ${newestFirst.length}` : 'Pinned message'}</span>
          <span className="block truncate text-body-s text-fg-secondary" data-testid="pin-text">
            {row ? previewOf(row) : 'A message from before you joined'}
          </span>
        </span>
      </button>
      {canUnpin ? (
        <Button variant="ghost" size="icon-sm" className="cursor-pointer rounded-full font-normal" aria-label="Unpin" onClick={() => onUnpin(id)}>
          <X className="size-4 text-fg-secondary" />
        </Button>
      ) : null}
    </div>
  );
};

/** Seconds left of our slow-mode wait (0011: the sender's client keeps slow mode); the clock ticks only while slow mode binds us. */
const useSlowModeWait = (group: GroupRow | undefined, self: HexString): number => {
  const me = group && isV2(group) ? memberOf(group.state, self) : null;
  const binds = me?.role === ROLES.member && (group?.state?.slowModeSecs ?? 0) > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!binds) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [binds]);
  return binds ? Math.ceil(slowModeWait(group?.state, me, group?.lastSentAt, now) / 1000) : 0;
};

/** M16b: a stranger's `welcome` waits here until the person joins or declines (review M16 answer 5). */
const InviteRow = ({ group, manager, onDecline }: { group: GroupRow; manager: ChatManager; onDecline: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-4 text-center" data-testid="group-invite">
      <p className="text-body-m text-fg-secondary">
        {group.invitedBy?.username ?? 'Someone'} invited you to {group.name ? `“${group.name}”` : 'a private group'}. They are not one of your contacts, so you decide: nothing from the group shows until you join.
      </p>
      {error ? (
        <p role="alert" className="text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          className="h-auto cursor-pointer rounded-full px-8 py-3 text-label-l"
          disabled={busy}
          data-testid="invite-join"
          onClick={() => {
            setBusy(true);
            setError(null);
            manager
              .acceptGroupInvite(group.id)
              .catch((cause: unknown) => setError(`${plainError(cause, 'You did not join.')} Try again.`))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Joining…' : 'Join group'}
        </Button>
        <Button variant="ghost" className="cursor-pointer rounded-medium font-normal" disabled={busy} onClick={onDecline} data-testid="invite-decline">
          Decline
        </Button>
      </div>
    </div>
  );
};

type RoomProps = {
  groupId: string;
  manager: ChatManager;
  self: HexString;
  /** M14: signs `tx` buttons in the group; the reference goes on the group topic. */
  transactions?: TxRunner | null;
  /** The strip's "Signs as". */
  username?: string;
  scrollToMessageId?: string | null;
  scrollRequest?: number;
};

/** M14: the one signing strip of the room (spec 0007 rate limit): which button, the intent, where it is. */
type Strip = { messageId: string; row: number; index: number; intent: TxIntent; state: StripPhase };

/** One room per group: the composer fans out, each peer bubble names its sender. */
export const GroupRoom = ({ groupId, manager, self, transactions = null, username = 'this account', scrollToMessageId = null, scrollRequest = 0 }: RoomProps) => {
  const peer = groupPeerOf(groupId);
  const group = useLiveQuery(() => getGroup(groupId), [groupId]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const room = useLiveQuery(() => db.rooms.get(peer), [peer]);
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const peerInfoRows = useLiveQuery(() => db.peerInfo.toArray(), []) ?? [];
  const capabilityRows = useLiveQuery(() => db.peerCapabilities.toArray(), []) ?? [];
  const answeredPeers = useLiveQuery(loadAnsweredPeers, []) ?? NO_PEERS;
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());
  const [pinJump, setPinJump] = useState<{ messageId: string; request: number } | null>(null);
  const slowWait = useSlowModeWait(group, self);
  const [strip, setStrip] = useState<Strip | null>(null);
  // The `tx` button each keyboard started a transaction from (this session).
  const [txButtons, setTxButtons] = useState<ReadonlyMap<string, { row: number; index: number }>>(() => new Map());
  // M14: the DAO bot's proposals, read from its messages; the clock ticks while one is not closed.
  const proposals = useMemo(() => proposalViews(messages ?? NO_ROWS), [messages]);
  const now = useNow([...proposals.values()].some(view => !view.outcome && !view.executed));
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
  // Owner ask 2026-09-24: an unnamed group shows its members' names, recomputed as the roster changes.
  const title = groupDisplayName(group, self, contacts);
  const active = group.self === 'member';
  const v2 = isV2(group);
  const me = v2 ? memberOf(group.state, self) : null;
  const pinned = v2 ? (group.state?.pinned ?? []) : [];
  const mayPin = v2 && active && can(me, PERMISSIONS.pin);
  const slowSecs = v2 && me?.role === ROLES.member ? (group.state?.slowModeSecs ?? 0) : 0;
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

  // ── Spec 0007 in a group (M14): the same strip as a contact room; a dry-run always comes first.
  const openStrip = (messageId: string, r: number, i: number, bytes: Uint8Array) => {
    if (strip?.state.phase === 'signing') {
      setError('A transaction is being signed in this chat. Wait for it, then try again.');
      return;
    }
    const intent = decodeTxIntent(bytes);
    // Spec 0007 rule 1: an expired offer is never dry-run or signed (its button is disabled; this covers a race).
    if (!intent || intentExpired(intent, Date.now())) return;
    setError(null);
    setStrip({ messageId, row: r, index: i, intent, state: { phase: 'checking' } });
    const update = (state: StripPhase) => setStrip(current => (current && current.messageId === messageId && current.row === r && current.index === i ? { ...current, state } : current));
    const chain = window.desktop?.chain;
    if (!chain || !transactions) {
      update({ phase: 'refused', reason: 'This app cannot run chain actions here.', dryRun: null });
      return;
    }
    chain
      .dryRun(bytes)
      .then(dryRun => update(dryRun.ok ? { phase: 'ready', dryRun } : { phase: 'refused', reason: dryRun.error ?? 'The test run failed.', dryRun }))
      .catch((cause: unknown) => update({ phase: 'refused', reason: `${plainError(cause, 'The network did not answer.')} Try again.`, dryRun: null }));
  };

  const signStrip = async () => {
    if (!strip || strip.state.phase !== 'ready' || !transactions) return;
    const current = strip;
    const { dryRun } = strip.state;
    if (!dryRun.id) return;
    const dryRunId = dryRun.id;
    setStrip({ ...current, state: { phase: 'signing', dryRun } });
    try {
      // The reference goes to the group (its topic), answering the bot's buttons message.
      await transactions.run({ peer, dryRunId, chainId: current.intent.chainId, note: referenceNote(current.intent.display), intentMessageId: current.messageId });
      setTxButtons(map => new Map(map).set(current.messageId, { row: current.row, index: current.index }));
      await manager.pressButton(peer, current.messageId, current.row, current.index);
      setStrip(s => (s === null || s.messageId !== current.messageId ? s : null));
    } catch (cause) {
      setStrip(s => (s && s.messageId === current.messageId ? { ...s, state: { phase: 'refused', reason: plainError(cause, 'It was not signed.'), dryRun } } : s));
    }
  };

  // The latest state of the transaction each keyboard started (our own reference rows).
  const txStatusOf = (messageId: string): TxStatus | null => {
    const ref = [...(messages ?? [])]
      .reverse()
      .find(r => r.direction === 'outgoing' && r.content.type === 'transactionReference' && r.content.reference.intentMessageId === messageId);
    return ref?.content.type === 'transactionReference' ? ref.content.reference.status : null;
  };
  const isOwnText = (row: MessageRow) => row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply') && !deleting.has(row.messageId);

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    if (row.content.type === 'deleted' || deleting.has(row.messageId) || !active) return null;
    const button = txButtons.get(row.messageId);
    const status = button ? txStatusOf(row.messageId) : null;
    const signing = strip?.messageId === row.messageId && (strip.state.phase === 'checking' || strip.state.phase === 'signing');
    const keyboard =
      row.content.type === 'buttons' && row.direction === 'incoming'
        ? {
            // M14: `tx` buttons open the signing strip here too (in v1 groups they were not pressable, decisions M12).
            press: (r: number, i: number) => {
              if (row.content.type !== 'buttons') return;
              const action = row.content.rows[r]?.[i]?.action;
              if (!action || action.kind === 'unsupported') return;
              if (action.kind === 'tx') {
                openStrip(row.messageId, r, i, action.intent);
                return;
              }
              const open = action.kind === 'url' && window.desktop ? window.desktop.app.openUrl(action.url) : Promise.resolve();
              guarded(
                open.then(() => manager.pressButton(peer, row.messageId, r, i)),
                'The button did not work.',
              );
            },
            active: signing && strip ? { row: strip.row, index: strip.index, busy: true } : null,
            tx: button && status ? { ...button, status } : null,
          }
        : undefined;
    const proposal = proposals.get(row.messageId);
    // M12e Forward: a copy of the text, captioned with its author on this device only.
    const author = row.direction === 'outgoing' ? 'you' : (senderOf(row) ?? title);
    const forward = forwardText(row) !== null ? (target: ForwardTarget) => chatActions.forward(target, row, author) : undefined;
    return {
      ...(keyboard ? { keyboard } : {}),
      ...(proposal ? { status: <ProposalStatus view={proposal} now={now} /> } : {}),
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
      pin:
        mayPin && row.direction !== 'system'
          ? { pinned: pinned.includes(row.messageId), run: () => guarded(manager.pinGroupMessage(group.id, row.messageId, !pinned.includes(row.messageId)), 'The pin did not change.') }
          : undefined,
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
          avatar={<GroupAvatar name={title} />}
          name={title}
          status={
            <span data-testid="group-status">
              {isV2(group) ? `${memberCount(group)} · epoch ${group.epoch ?? 1} · one statement per message` : `${memberCount(group)} · admin ${memberName(group, group.admin)}`}
            </span>
          }
        >
          {group.self !== 'invited' ? (
            <IconToggle label="Members" pressed={panel} onClick={() => setPanel(open => !open)} testId="members-toggle">
              <Users className="size-5 text-fg-secondary" />
            </IconToggle>
          ) : null}
          {room ? (
            <IconToggle label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={() => void setRoomMuted(peer, !muted)} testId="mute-toggle">
              {muted ? <BellOff className="size-5 text-fg-secondary" /> : <Bell className="size-5 text-fg-secondary" />}
            </IconToggle>
          ) : null}
          <RoomMenu subject={{ peer, name: title, kind: 'group', room, member: active }} />
        </RoomHeader>
        <PinBar
          pinned={pinned}
          rows={messages ?? NO_ROWS}
          canUnpin={mayPin}
          onJump={messageId => setPinJump(current => ({ messageId, request: (current?.request ?? 0) + 1 }))}
          onUnpin={messageId => guarded(manager.pinGroupMessage(group.id, messageId, false), 'The pin did not change.')}
          previewOf={row => {
            const proposal = proposals.get(row.messageId);
            return proposal ? `Proposal #${proposal.id}: ${proposal.title} · ${phaseLine(proposal, now)}` : messagePreview(row);
          }}
        />
        <MessageFlow
          rows={clearing ? NO_ROWS : (messages ?? [])}
          peerName={title}
          requests={[]}
          assistant={false}
          actionsFor={actionsFor}
          unread={unread}
          onSeen={() => {
            if (unread > 0 || room?.markedUnread === true) void manager.markRead(peer);
          }}
          deleting={deleting}
          reveal={prefs.revealReplies}
          jumpTo={pinJump ?? (scrollToMessageId ? { messageId: scrollToMessageId, request: scrollRequest } : null)}
          senderOf={senderOf}
          keepInView={strip?.messageId ?? null}
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
        {group.self === 'invited' ? (
          <InviteRow group={group} manager={manager} onDecline={() => chatActions.remove(peer, group.name || 'this group', { member: false })} />
        ) : active && group.locked ? (
          <p className="px-4 py-4 text-center text-body-m text-fg-secondary" data-testid="group-locked">
            Waiting for the new group key from an admin.
          </p>
        ) : active ? (
          <>
          {slowSecs > 0 ? (
            // 0011 Limits: the sender's client keeps slow mode; this says why Send waits.
            <p className="px-4 pb-1 text-body-s text-fg-secondary" data-testid="slow-mode">
              Slow mode: one message every {slowModeWords(slowSecs)}.{slowWait > 0 ? ` You can send again in ${slowWait} s.` : ''}
            </p>
          ) : null}
          <Composer
            sendDisabled={slowWait > 0}
            quietSend={strip !== null}
            // Esc in the field closes the open strip, unless it is signing.
            onEscape={strip && strip.state.phase !== 'signing' ? () => setStrip(null) : undefined}
            // The signing strip docks here, above the field: always in view (2026-09-24).
            panel={
              strip ? (
                <TxStrip intent={strip.intent} state={strip.state} signerName={username} outcome={null} onSign={() => void signStrip()} onCancel={() => setStrip(null)} />
              ) : null
            }
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
          </>
        ) : (
          <p className="px-4 py-4 text-center text-body-m text-fg-secondary" data-testid="group-inactive">
            {group.self === 'removed' ? 'You were removed from this group.' : 'You left this group.'}
          </p>
        )}
      </div>
      {panel ? (
        <MembersPanel group={group} self={self} contacts={contacts} capabilities={capabilityRows} peerInfo={peerInfo} answered={answeredPeers} manager={manager} onClose={() => setPanel(false)} />
      ) : null}
    </div>
  );
};

type NewGroupProps = {
  manager: ChatManager | null;
  onCreated: (groupId: string) => void;
};

/**
 * "New group": an optional name, contacts as checkbox rows, Create (the view's
 * one main action). Owner ask 2026-09-24: without a name the group shows its
 * members' names; only contacts whose devices all advertised groups can be picked.
 */
export const NewGroupRoom = ({ manager, onCreated }: NewGroupProps) => {
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const peerInfoRows = useLiveQuery(() => db.peerInfo.toArray(), []) ?? [];
  const capabilityRows = useLiveQuery(() => db.peerCapabilities.toArray(), []) ?? [];
  const answeredPeers = useLiveQuery(loadAnsweredPeers, []) ?? NO_PEERS;
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...contacts].sort((a, b) => a.username.localeCompare(b.username));
  const peerInfo = new Map(peerInfoRows.map(row => [row.peerId, row]));
  const supportOf = (contact: ContactRow) => contactGroupSupport(contact, capabilityRows, peerInfo, answeredPeers);
  // A pick whose contact stopped qualifying (a new device without groups) no longer counts.
  const chosen = sorted.filter(contact => picked.has(contact.accountId) && supportOf(contact) === 'ready');
  const ready = chosen.length > 0 && !busy && manager !== null;
  const title = name.trim() || (chosen.length > 0 ? derivedName(chosen.map(contact => contact.nickname ?? contact.username)) : 'New group');

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
      const members = chosen.map(contact => ({ account: contact.accountId, username: contact.username }));
      onCreated(await manager.createGroup(name, members));
    } catch (cause) {
      setError(plainError(cause, 'The group was not created. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <>
      <RoomHeader avatar={<GroupAvatar name={chosen.length > 0 || name.trim() ? title : 'Group'} />} name={title} status={`${chosen.length + 1} ${chosen.length === 0 ? 'member' : 'members'}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4" data-testid="new-group">
        <label className="flex max-w-md flex-col gap-1.5">
          <span className="text-label-m text-fg-primary">Group name</span>
          <Input
            value={name}
            maxLength={60}
            onChange={event => setName(event.target.value)}
            placeholder="Group name (optional)"
            aria-label="Group name"
            className="h-10 rounded-nested px-2 text-body-m md:text-body-m"
          />
          <span className="text-caption text-fg-tertiary">Without a name, the group shows its members’ names.</span>
        </label>
        <section className="flex flex-col gap-1" aria-label="Members">
          <h3 className="text-label-m text-fg-primary">Members</h3>
          <p className="text-body-s text-fg-secondary">Pick from your contacts. Each gets the group on the chat you already share. Only contacts whose apps support private groups can be picked.</p>
          <div className="mt-1 flex max-w-md flex-col gap-0.5">
            {sorted.length === 0 ? <p className="py-2 text-body-s text-fg-tertiary">No contacts yet. Start a chat first.</p> : null}
            {sorted.map(contact => {
              const info = peerInfo.get(contact.accountId)?.botInfo;
              const support = supportOf(contact);
              const gated = support !== 'ready';
              const checked = !gated && picked.has(contact.accountId);
              return (
                <label
                  key={contact.accountId}
                  title={gated ? GROUP_SUPPORT_WORDS[support] : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-nested px-2 py-2 transition-colors',
                    gated ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-selection-container-hover focus-within:bg-selection-container-hover',
                  )}
                  data-testid="group-candidate"
                  data-gated={gated || undefined}
                >
                  <Checkbox checked={checked} disabled={gated} onCheckedChange={() => toggle(contact.accountId)} aria-label={contact.username} />
                  <span className={cn(gated && 'opacity-50')}>
                    <PeerAvatar name={contact.username} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className={cn('truncate text-label-m', gated ? 'text-fg-tertiary' : 'text-fg-primary')}>{contact.username}</span>
                      {info ? <BotBadge kind={info.kind} /> : null}
                    </span>
                    <GatedReason support={support} />
                  </span>
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
