// The built-in Faucet's room (M10 step 6): the Assistant's room shape, with
// no composer: the Faucet only has its keyboard. An embedded bot (M12): its
// logic runs in this app; "Get 1 PAS" is a devnet transfer the main process
// sends (main/chain/faucet.ts), shown by domain/faucet/dripFlow.ts.

import { Droplets } from 'lucide-react';
import { useState } from 'react';

import { type MessageRow, db } from '../app/database';
import { listMessages, markButtonPressed, markRoomRead } from '../domain/chat/messages';
import { isDripBusy, startDrip } from '../domain/faucet/dripFlow';
import { COPY_ADDRESS_COMMAND, DRIP_COMMAND, FAUCET_INFO, FAUCET_PEER, FAUCET_USERNAME, addCopiedRow } from '../domain/faucet/faucet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { BotBadge } from './BotBadge';
import type { BubbleActions } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader } from './RoomHeader';
import type { FaucetDrip } from '../../shared/desktop-api';

import { plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

export const FaucetAvatar = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
  <Avatar className={size === 'md' ? 'size-10' : 'size-8'} aria-hidden>
    <AvatarFallback className="bg-surface-container-inverted text-fg-primary-inverted">
      <Droplets className={size === 'md' ? 'size-5' : 'size-4'} />
    </AvatarFallback>
  </Avatar>
);

/** A press stays highlighted this long, as in a contact's room. */
const PRESS_FLASH_MS = 1_000;

type Props = {
  address: string;
  /** The in-app devnet drip (`faucet:drip`); null where it cannot run (not devnet, no desktop). */
  drip: (() => Promise<FaucetDrip>) | null;
};

export const FaucetRoom = ({ address, drip }: Props) => {
  const messages = useLiveQuery(() => listMessages(FAUCET_PEER), []);
  const room = useLiveQuery(() => db.rooms.get(FAUCET_PEER), []);
  const [active, setActive] = useState<{ messageId: string; row: number; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const press = async (row: MessageRow, r: number, i: number) => {
    if (row.content.type !== 'buttons') return;
    const action = row.content.rows[r]?.[i]?.action;
    if (!action) return;
    setError(null);
    setActive({ messageId: row.messageId, row: r, index: i });
    setTimeout(() => setActive(null), PRESS_FLASH_MS);
    try {
      if (action.kind === 'url') {
        // The confirm strip already showed the host.
        if (!window.desktop) throw new Error('Links open in the desktop app only.');
        await window.desktop.app.openUrl(action.url);
      } else if (action.kind === 'command' && action.command === COPY_ADDRESS_COMMAND) {
        await navigator.clipboard.writeText(address);
        await addCopiedRow();
      } else if (action.kind === 'command' && action.command === DRIP_COMMAND) {
        if (!drip) throw new Error('The in-app faucet runs on devnet only.');
        // The pending row, the reference and the balance come from dripFlow.ts; a press while busy does nothing.
        if ((await startDrip(drip)) === 'ignored') return;
      } else {
        return;
      }
      await markButtonPressed(row.messageId, r, i);
    } catch (cause) {
      setError(`${plainError(cause, 'The button did not work.')} Try again.`);
    }
  };

  // "Get 1 PAS" spins while its request is pending, and a press then does nothing.
  const pending = isDripBusy(messages ?? []);
  const dripAt = (row: MessageRow): { row: number; index: number } | null => {
    if (row.content.type !== 'buttons') return null;
    for (const [r, buttons] of row.content.rows.entries()) {
      const i = buttons.findIndex(button => button.action.kind === 'command' && button.action.command === DRIP_COMMAND);
      if (i >= 0) return { row: r, index: i };
    }
    return null;
  };

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    if (row.content.type !== 'buttons') return {};
    const drip = pending ? dripAt(row) : null;
    return {
      keyboard: {
        press: (r, i) => {
          if (drip && drip.row === r && drip.index === i) return;
          void press(row, r, i);
        },
        active: drip ? { ...drip, busy: true } : active?.messageId === row.messageId ? { row: active.row, index: active.index, busy: false } : null,
      },
    };
  };

  return (
    <>
      <RoomHeader
        avatar={<FaucetAvatar />}
        name={FAUCET_USERNAME}
        badge={<BotBadge kind={FAUCET_INFO.kind} />}
        status={<span data-testid="bot-description">{FAUCET_INFO.description}</span>}
      />
      <MessageFlow
        rows={messages ?? []}
        peerName={FAUCET_USERNAME}
        requests={[]}
        assistant={false}
        actionsFor={actionsFor}
        unread={room?.unreadCount ?? 0}
        onSeen={() => {
          if ((room?.unreadCount ?? 0) > 0) void markRoomRead(FAUCET_PEER);
        }}
      />
      {error ? (
        <p role="alert" className="px-4 pb-4 text-body-s text-fg-error">
          {error}
        </p>
      ) : (
        <p className="px-4 pt-2 pb-4 text-center text-body-s text-fg-tertiary">The Faucet has no chat. Use the buttons above.</p>
      )}
    </>
  );
};
