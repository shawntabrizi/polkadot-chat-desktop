// M16b (spec 0011 supergroup features): the private group's admin parts of
// the members panel — a member's role and flags, join requests, the invite
// link and the group's settings. Inline sections of the side panel, never a
// modal (.refs/polkadot-design-system SKILL.md §10 "Avoid modals"). Every
// change is one group-state statement; the panel shows the state as it lands.

import { useState } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import type { GroupMember } from '../domain/chat/content';
import type { GroupRow } from '../app/database';
import { GROUP2_BOUNDS, PERMISSIONS, ROLES } from '../domain/chat/groupCodec';
import { JOIN_POLICY_WORDS, SLOW_MODE_CHOICES, can, memberOf, slowModeWords } from '../domain/chat/groupsV2';
import type { ChatManager } from '../domain/chat/manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { PeerAvatar } from './Avatar';
import { Checkbox, Switch } from './controls';

/** The flags an admin can hold, in the words the panel uses (0011 permission bits). */
export const FLAG_WORDS: readonly { bit: number; label: string }[] = [
  { bit: PERMISSIONS.post, label: 'Send messages' },
  { bit: PERMISSIONS.add, label: 'Add members and make invite links' },
  { bit: PERMISSIONS.approve, label: 'Approve join requests' },
  { bit: PERMISSIONS.remove, label: 'Remove members' },
  { bit: PERMISSIONS.pin, label: 'Pin messages' },
  { bit: PERMISSIONS.info, label: 'Change name and settings' },
  { bit: PERMISSIONS.delete, label: 'Delete others’ messages' },
  { bit: PERMISSIONS.admins, label: 'Make admins' },
];

/**
 * May `self` change `account`'s role or flags? The owner changes anyone but
 * itself; an admin with `manage admins` changes role-0 members only (0011
 * ruling 5). The state checks it again on every receiver.
 */
export const mayManage = (group: GroupRow, self: HexString, account: HexString): boolean => {
  if (account === self || group.self !== 'member') return false;
  const me = memberOf(group.state, self);
  const target = memberOf(group.state, account);
  if (!me || !target || target.role === ROLES.owner) return false;
  return me.role === ROLES.owner || (target.role === ROLES.member && can(me, PERMISSIONS.admins));
};

type Run = (work: Promise<void>, failure: string) => Promise<void>;

/** A member's role and flags, opened inline under its row. */
export const RoleEditor = ({ group, self, member, manager, run }: { group: GroupRow; self: HexString; member: GroupMember; manager: ChatManager; run: Run }) => {
  const [busy, setBusy] = useState(false);
  const target = memberOf(group.state, member.account);
  const owner = memberOf(group.state, self)?.role === ROLES.owner;
  if (!target) return null;
  const act = (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    void run(work(), failure).finally(() => setBusy(false));
  };
  const admin = target.role === ROLES.admin;
  // A member's admin flags do nothing (0011): only "Send messages" is shown for one.
  const flags = admin ? FLAG_WORDS : FLAG_WORDS.filter(flag => flag.bit === PERMISSIONS.post);
  return (
    <div className="flex flex-col gap-2 px-4 pb-3 ps-14" data-testid="role-editor">
      <div className="flex flex-col gap-1">
        {flags.map(flag => (
          <label key={flag.bit} className="flex cursor-pointer items-center gap-2 text-body-s text-fg-primary">
            <Checkbox
              checked={(target.permissions & flag.bit) !== 0}
              disabled={busy || (admin && !owner)}
              onCheckedChange={() => act(() => manager.setGroupPermissions(group.id, member.account, target.permissions ^ flag.bit), 'The change did not go through.')}
              data-testid="role-flag"
            />
            {flag.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {admin ? (
          owner ? (
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer rounded-medium font-normal"
              disabled={busy}
              onClick={() => act(() => manager.setGroupRole(group.id, member.account, 0), 'The change did not go through.')}
            >
              Remove admin
            </Button>
          ) : null
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="cursor-pointer rounded-medium"
            disabled={busy}
            data-testid="make-admin"
            onClick={() => act(() => manager.setGroupRole(group.id, member.account, 1), 'The change did not go through.')}
          >
            Make admin
          </Button>
        )}
        {owner ? (
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer rounded-medium font-normal"
            disabled={busy}
            onClick={() => act(() => manager.transferGroupOwnership(group.id, member.account), 'The group was not handed over.')}
          >
            Make owner
          </Button>
        ) : null}
      </div>
      {!admin ? <p className="text-caption text-fg-tertiary">An admin gets every flag but “Make admins”; the owner can change them.</p> : null}
    </div>
  );
};

/** Join requests by link waiting for this admin (policy 1): Approve adds the person, Reject answers no. */
export const JoinRequests = ({ group, manager, run }: { group: GroupRow; manager: ChatManager; run: Run }) => {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const requests = group.joinRequests ?? [];
  if (requests.length === 0) return null;
  const act = (account: string, work: Promise<void>, failure: string) => {
    setBusy(current => new Set(current).add(account));
    void run(work, failure).finally(() =>
      setBusy(current => {
        const next = new Set(current);
        next.delete(account);
        return next;
      }),
    );
  };
  return (
    <section aria-label="Join requests" className="flex flex-col pt-2" data-testid="join-requests">
      <h4 className="px-4 pb-1 text-label-m text-fg-primary">Asking to join · {requests.length}</h4>
      {requests.map(request => (
        <div key={request.account} className="flex flex-col gap-2 px-4 py-2 transition-colors hover:bg-surface-container" data-testid="join-request">
          <div className="flex min-w-0 items-center gap-3">
            <PeerAvatar name={request.username} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-m text-fg-primary">{request.username}</p>
              <p className="truncate text-caption text-fg-tertiary">{request.note || 'Opened your invite link'}</p>
            </div>
          </div>
          <div className="flex gap-2 ps-11">
            <Button
              variant="secondary"
              size="sm"
              className="cursor-pointer rounded-medium"
              disabled={busy.has(request.account)}
              data-testid="join-approve"
              onClick={() => act(request.account, manager.approveGroupJoin(group.id, request.account), `${request.username} was not added.`)}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer rounded-medium font-normal"
              disabled={busy.has(request.account)}
              data-testid="join-reject"
              onClick={() => act(request.account, manager.rejectGroupJoin(group.id, request.account), 'The request was not answered.')}
            >
              Reject
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
};

/** "Copy invite link" (one state statement the first time) and "Revoke links". */
export const InviteSection = ({ group, manager, run, later }: { group: GroupRow; manager: ChatManager; run: Run; later: (key: string, label: string, commit: () => Promise<void>) => void }) => {
  const [copying, setCopying] = useState(false);
  const state = group.state;
  if (!state) return null;
  const copy = () => {
    setCopying(true);
    void run(
      manager.createGroupInvite(group.id).then(async link => {
        await navigator.clipboard.writeText(link);
        toast('Invite link copied', { description: 'Anyone with it can ask to join. It holds no key.' });
      }),
      'The invite link was not made.',
    ).finally(() => setCopying(false));
  };
  return (
    <section aria-label="Invite link" className="flex flex-col gap-2 px-4 pt-4" data-testid="invite-section">
      <h4 className="text-label-m text-fg-primary">Invite link</h4>
      <p className="text-body-s text-fg-secondary">
        {state.joinPolicy === 0 ? 'Only admins add members. A new link asks an admin to approve each person.' : `Who joins: ${JOIN_POLICY_WORDS[state.joinPolicy]}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="cursor-pointer rounded-medium" disabled={copying} onClick={copy} data-testid="copy-invite">
          {copying ? 'Making link…' : 'Copy invite link'}
        </Button>
        {state.invites.length > 0 ? (
          <Button
            variant="ghost"
            className="cursor-pointer rounded-medium font-normal"
            data-testid="revoke-invites"
            onClick={() => later('revoke', 'Invite links revoked', () => manager.revokeGroupInvites(group.id))}
          >
            Revoke links
          </Button>
        ) : null}
      </div>
    </section>
  );
};

/** Name, who can join, slow mode, history for newcomers: for an admin who may change the group's info. */
export const GroupSettings = ({ group, manager, run }: { group: GroupRow; manager: ChatManager; run: Run }) => {
  const [name, setName] = useState(group.name);
  const state = group.state;
  if (!state) return null;
  const save = (settings: Parameters<ChatManager['setGroupSettings']>[1], failure = 'The setting did not change.') => void run(manager.setGroupSettings(group.id, settings), failure);
  return (
    <section aria-label="Group settings" className="flex flex-col gap-3 px-4 pt-4" data-testid="group-settings">
      <h4 className="text-label-m text-fg-primary">Settings</h4>
      <label className="flex flex-col gap-1">
        <span className="text-body-s text-fg-secondary">Name</span>
        <div className="flex gap-2">
          <Input
            value={name}
            maxLength={60}
            onChange={event => setName(event.target.value)}
            aria-label="Group name"
            className="h-9 rounded-nested bg-surface-container px-2 text-body-m md:text-body-m"
          />
          {name.trim() !== group.name && name.trim() !== '' ? (
            <Button variant="secondary" className="cursor-pointer rounded-medium" onClick={() => save({ name }, 'The name did not change.')}>
              Save
            </Button>
          ) : null}
        </div>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-s text-fg-secondary">Who can join</span>
        <Select value={String(state.joinPolicy)} onValueChange={value => save({ joinPolicy: Number(value) })}>
          <SelectTrigger className="w-full rounded-nested text-body-m" data-testid="join-policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 1, 2].map(policy => (
              <SelectItem key={policy} value={String(policy)}>
                {JOIN_POLICY_WORDS[policy]!.replace(/^./, c => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-s text-fg-secondary">Slow mode for members</span>
        <Select value={String(state.slowModeSecs)} onValueChange={value => save({ slowModeSecs: Number(value) })}>
          <SelectTrigger className="w-full rounded-nested text-body-m" data-testid="slow-mode-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...SLOW_MODE_CHOICES, state.slowModeSecs])].map(secs => (
              <SelectItem key={secs} value={String(secs)}>
                {secs === 0 ? 'Off' : `One message every ${slowModeWords(secs)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="history-share" className="flex cursor-pointer flex-col">
          <span className="text-body-s text-fg-primary">Share recent history</span>
          <span className="text-caption text-fg-tertiary">New members get the last {GROUP2_BOUNDS.historyShare} messages from the admin who lets them in</span>
        </label>
        <Switch id="history-share" checked={state.historyShare > 0} onCheckedChange={on => save({ historyShare: on ? GROUP2_BOUNDS.historyShare : 0 })} data-testid="history-share" />
      </div>
    </section>
  );
};
