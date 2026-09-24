// M16b (spec 0011 "Invite link"): the view a group invite link opens. The
// link names the group and up to three admins; "Ask to join" sends one of
// them a chat request with the capability in its opener (or a `joinRequest`
// on a chat we already have). The admin's client decides; this view follows
// the answer from the `groupJoins` row until the group opens. No modal.

import { useState } from 'react';

import { db, groupPeerOf } from '../app/database';
import { getGroup } from '../domain/chat/groups';
import { parseInviteLink } from '../domain/chat/groupsV2';
import type { ChatManager } from '../domain/chat/manager';
import { Button } from '@/components/ui/button';

import { GroupAvatar } from './Avatar';
import { plainError } from './format';
import { RoomHeader } from './RoomHeader';
import { useLiveQuery } from './useLiveQuery';

const STATUS_WORDS = {
  requested: 'Your request went to an admin. You join when their app lets you in.',
  pending: 'An admin will look at your request. The group opens here when they approve it.',
  rejected: 'An admin declined your request.',
} as const;

export const JoinGroupRoom = ({ link, manager, onOpen }: { link: string; manager: ChatManager | null; onOpen: (peer: ReturnType<typeof groupPeerOf>) => void }) => {
  const invite = parseInviteLink(link);
  const join = useLiveQuery(() => (invite ? db.groupJoins.get(invite.groupId) : Promise.resolve(undefined)), [invite?.groupId]);
  const group = useLiveQuery(() => (invite ? getGroup(invite.groupId) : Promise.resolve(undefined)), [invite?.groupId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!invite) return null;
  const member = group?.self === 'member';

  const ask = () => {
    if (!manager) return;
    setBusy(true);
    setError(null);
    manager
      .joinGroupByLink(link)
      .then(result => {
        if (result.member) onOpen(groupPeerOf(result.groupId));
      })
      .catch((cause: unknown) => setError(plainError(cause, 'Your request did not go out. Check your connection and try again.')))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <RoomHeader avatar={<GroupAvatar name={invite.name} />} name={invite.name} status="Private group · invite link" />
      <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto px-4 pb-4" data-testid="join-group">
        <p className="max-w-md text-body-m text-fg-secondary">
          This link lets you ask to join “{invite.name}”. It holds no key: an admin lets you in, and your app gets the group from them.
        </p>
        {join ? (
          <p className="max-w-md text-body-m text-fg-primary" data-testid="join-status" data-status={join.status}>
            {STATUS_WORDS[join.status]}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-s text-fg-error">
            {error}
          </p>
        ) : null}
        {member ? (
          <Button className="h-auto w-fit cursor-pointer rounded-full px-8 py-3 text-label-l" onClick={() => onOpen(groupPeerOf(invite.groupId))}>
            Open group
          </Button>
        ) : !join || join.status === 'rejected' ? (
          <Button
            className="h-auto w-fit cursor-pointer rounded-full px-8 py-3 text-label-l disabled:cursor-not-allowed"
            disabled={busy || manager === null}
            onClick={ask}
            data-testid="join-ask"
          >
            {busy ? 'Asking…' : join?.status === 'rejected' ? 'Ask again' : 'Ask to join'}
          </Button>
        ) : null}
      </div>
    </>
  );
};
