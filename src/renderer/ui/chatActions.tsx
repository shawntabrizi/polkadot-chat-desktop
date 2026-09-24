// M12e chat management: one set of actions for the chat-list row menu and the
// room header menu, and the Forward targets. Every action acts at once (design
// system §10: no confirm dialog). Deleting, clearing and withdrawing keep the
// rows until a 6 s Undo toast ends (domain/chat/undo.ts); archive and block
// are undone by reversing them. Nothing here goes on the wire except a
// group's leave (delete of a group you are in) and a forwarded text.

import { Archive, ArchiveRestore, Ban, Bell, BellOff, Eraser, MailOpen, MessageSquareDot, MoreHorizontal, Pencil, Pin, PinOff, Trash2, Undo2 } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import { type PeerId, type RoomRow, isGroupPeer } from '../app/database';
import {
  MAX_PINNED,
  blockPeer,
  clearHistoryLocally,
  forwardText,
  setArchived,
  setMarkedUnread,
  setPinned,
  unblockPeer,
} from '../domain/chat/chatActions';
import { ASSISTANT_PEER, ASSISTANT_USERNAME, type AssistantChat } from '../domain/assistant/assistant';
import type { ChatManager, ChatTargetId } from '../domain/chat/manager';
import { setRoomMuted } from '../domain/chat/messages';
import { UNDO_MS, clearKey, deleteKey, pendingActions, withdrawKey } from '../domain/chat/undo';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { type ChatActions, type ForwardTarget, useChatActions } from './chatActionsContext';
import { plainError } from './format';

export { ChatActionsProvider, type ChatActions, type ForwardTarget, useChatActions } from './chatActionsContext';

/** The keys whose Undo time runs (hidden rows, emptied rooms). */
export const usePending = (): ReadonlySet<string> => useSyncExternalStore(pendingActions.subscribe, pendingActions.snapshot);

const failed = (what: string) => (cause: unknown) => toast(`${plainError(cause, what)} Try again.`);

/** A local delete with Undo: the rows stay until the toast ends (design system §10). */
const later = (key: string, title: string, description: string, commit: () => Promise<unknown>) => {
  const { undo } = pendingActions.schedule(key, commit);
  toast(title, { description, duration: UNDO_MS, action: { label: 'Undo', onClick: undo } });
};

/** The Assistant as the first Forward target (M12f): ask it about a message. */
export const ASSISTANT_TARGET: ForwardTarget = { peer: ASSISTANT_PEER, name: ASSISTANT_USERNAME, label: 'Ask the Assistant' };

/** Shell builds the one value; the list, the rooms and the bubbles read it. */
export const useChatActionsValue = (manager: ChatManager | null, targets: readonly ForwardTarget[], assistant: AssistantChat | null = null): ChatActions =>
  useMemo(
    () => ({
      targets: assistant ? [ASSISTANT_TARGET, ...targets] : targets,
      ready: manager !== null,
      remove: (peer, name, options = {}) => {
        if (!manager) return;
        const at = Date.now();
        const group = isGroupPeer(peer);
        const title = group ? (options.member ? `You left ${name} and deleted the chat` : `${name} deleted`) : `Chat with ${name} deleted`;
        later(deleteKey(peer), title, group ? 'Only on this device.' : `Only on this device. ${name} keeps their copy.`, () => manager.deleteChat(peer as ChatTargetId, at));
      },
      withdraw: (peer, name) => {
        if (!manager) return;
        later(withdrawKey(peer), `Request to ${name} withdrawn`, 'It expires on the network. Send a new request to chat.', () => manager.withdrawRequest(peer));
      },
      clear: (peer, name) => {
        const at = Date.now();
        later(clearKey(peer), `History with ${name} cleared`, 'Only on this device.', () => clearHistoryLocally(peer, at));
      },
      archive: (peer, name, archived) => {
        void setArchived(peer, archived).catch(failed('The chat did not move.'));
        if (archived) {
          toast(`${name} archived`, {
            duration: UNDO_MS,
            action: { label: 'Undo', onClick: () => void setArchived(peer, false).catch(failed('The chat did not move back.')) },
          });
        }
      },
      pin: (peer, pinned) => {
        void setPinned(peer, pinned).then(done => {
          if (!done) toast(`You can pin up to ${MAX_PINNED} chats`, { description: 'Unpin one to pin this chat.' });
        }, failed('The pin did not change.'));
      },
      markUnread: (peer, unread) => void setMarkedUnread(peer, unread).catch(failed('The chat did not change.')),
      block: (peer, name) => {
        void blockPeer(peer).catch(failed('The block did not take.'));
        toast(`${name} blocked`, {
          description: 'Their messages and requests are dropped on this device. They are not told.',
          duration: UNDO_MS,
          action: { label: 'Undo', onClick: () => void unblockPeer(peer.accountId).catch(failed('The unblock did not take.')) },
        });
      },
      unblock: (accountId, name) => {
        void unblockPeer(accountId).then(() => toast(`${name} unblocked`), failed('The unblock did not take.'));
      },
      forward: (target, row, from) => {
        const text = forwardText(row);
        if (text === null) return;
        if (target.peer === ASSISTANT_PEER) {
          assistant?.send(text, { forwardedFrom: from }).then(() => toast('Sent to the Assistant'), failed('The Assistant did not get the message.'));
          return;
        }
        if (!manager) return;
        manager.sendMessage(target.peer as ChatTargetId, { type: 'text', text }, { forwardedFrom: from }).then(
          () => toast(`Forwarded to ${target.name}`),
          failed(`The message was not forwarded to ${target.name}.`),
        );
      },
    }),
    [manager, targets, assistant],
  );

/** What a menu is about. `kind` decides which items it offers. */
export type ChatMenuSubject = {
  peer: PeerId;
  name: string;
  kind: 'contact' | 'group' | 'assistant' | 'faucet' | 'outgoing';
  room?: RoomRow;
  /** A contact: the account and username (block), and whether it is blocked. */
  contact?: { accountId: HexString; username: string; blocked: boolean };
  /** A group: still a member (Delete leaves it first). */
  member?: boolean;
  /** The room header only: start editing the nickname in place. */
  onNickname?: () => void;
  hasNickname?: boolean;
};

const Item = ({ onSelect, icon, children, testId }: { onSelect: () => void; icon: ReactNode; children: ReactNode; testId?: string }) => (
  <DropdownMenuItem onSelect={onSelect} data-testid={testId}>
    {icon} {children}
  </DropdownMenuItem>
);

/**
 * The items of a chat's menu: the same in the list row and the room header.
 * Destructive items come last, after a separator.
 */
export const ChatMenuItems = ({ subject }: { subject: ChatMenuSubject }) => {
  const actions = useChatActions();
  const { peer, name, kind, room } = subject;
  if (kind === 'outgoing') {
    return (
      <Item onSelect={() => actions.withdraw(peer as HexString, name)} icon={<Undo2 />} testId="menu-withdraw">
        Withdraw request
      </Item>
    );
  }
  const unread = room !== undefined && (room.unreadCount > 0 || room.markedUnread === true);
  const local = kind === 'assistant' || kind === 'faucet';
  return (
    <>
      {room && !local ? (
        <Item onSelect={() => actions.pin(peer, room.pinnedAt === undefined)} icon={room.pinnedAt === undefined ? <Pin /> : <PinOff />} testId="menu-pin">
          {room.pinnedAt === undefined ? 'Pin' : 'Unpin'}
        </Item>
      ) : null}
      {room ? (
        <Item onSelect={() => actions.markUnread(peer, !unread)} icon={unread ? <MailOpen /> : <MessageSquareDot />} testId="menu-unread">
          {unread ? 'Mark as read' : 'Mark as unread'}
        </Item>
      ) : null}
      {room ? (
        <Item onSelect={() => void setRoomMuted(peer, room.muted !== true)} icon={room.muted ? <Bell /> : <BellOff />} testId="menu-mute">
          {room.muted ? 'Unmute' : 'Mute'}
        </Item>
      ) : null}
      {room && !local ? (
        <Item onSelect={() => actions.archive(peer, name, room.archived !== true)} icon={room.archived ? <ArchiveRestore /> : <Archive />} testId="menu-archive">
          {room.archived ? 'Unarchive' : 'Archive'}
        </Item>
      ) : null}
      {subject.onNickname ? (
        <Item onSelect={subject.onNickname} icon={<Pencil />} testId="menu-nickname">
          {subject.hasNickname ? 'Edit nickname' : 'Set nickname'}
        </Item>
      ) : null}
      {kind !== 'faucet' ? (
        <>
          <DropdownMenuSeparator />
          <Item onSelect={() => actions.clear(peer, name)} icon={<Eraser />} testId="menu-clear">
            Clear history
          </Item>
          {subject.contact ? (
            subject.contact.blocked ? (
              <Item onSelect={() => subject.contact && actions.unblock(subject.contact.accountId, name)} icon={<Ban />} testId="menu-unblock">
                Unblock
              </Item>
            ) : (
              <Item onSelect={() => subject.contact && actions.block(subject.contact, name)} icon={<Ban />} testId="menu-block">
                Block
              </Item>
            )
          ) : null}
          {!local && actions.ready ? (
            <Item onSelect={() => actions.remove(peer, name, { member: subject.member })} icon={<Trash2 />} testId="menu-delete">
              {kind === 'group' && subject.member ? 'Leave and delete' : 'Delete chat'}
            </Item>
          ) : null}
        </>
      ) : null}
    </>
  );
};

/** The room header's "More" button with the chat's menu (the same items as its list row). */
export const RoomMenu = ({ subject }: { subject: ChatMenuSubject }) => {
  // "Set nickname" opens an input in the header. It starts once the menu has
  // closed: the open menu holds the focus, and would take it from the input.
  const nicknameAfterClose = useRef(false);
  const onNickname = subject.onNickname;
  const items = onNickname
    ? {
        ...subject,
        onNickname: () => {
          nicknameAfterClose.current = true;
        },
      }
    : subject;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full font-normal" aria-label="Chat actions" data-testid="room-menu">
              <MoreHorizontal className="size-5 text-fg-secondary" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Chat actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        data-testid="chat-menu"
        onCloseAutoFocus={event => {
          if (!nicknameAfterClose.current) return;
          nicknameAfterClose.current = false;
          event.preventDefault();
          onNickname?.();
        }}
      >
        <ChatMenuItems subject={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
