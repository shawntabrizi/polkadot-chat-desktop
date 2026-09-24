// The M12e chat actions as a React context, apart from chatActions.tsx: the
// bubbles read the Forward targets from here, and must not load `sonner`
// (its CSS injection needs a real DOM, which the render specs do not have).

import { createContext, useContext } from 'react';

import type { HexString } from '../app/bytes';
import type { MessageRow, PeerId } from '../app/database';

/** A chat a message can be forwarded to. `label` replaces the name in the menu ("Ask the Assistant"). */
export type ForwardTarget = { peer: PeerId; name: string; label?: string };

export type ChatActions = {
  /** Contacts and groups (you are in) of the list, in its order; the Forward menu lists them. */
  targets: readonly ForwardTarget[];
  /** Null while chat starts: the actions that need the network are not offered. */
  ready: boolean;
  remove: (peer: PeerId, name: string, options?: { member?: boolean }) => void;
  withdraw: (peer: HexString, name: string) => void;
  clear: (peer: PeerId, name: string) => void;
  archive: (peer: PeerId, name: string, archived: boolean) => void;
  pin: (peer: PeerId, pinned: boolean) => void;
  markUnread: (peer: PeerId, unread: boolean) => void;
  block: (peer: { accountId: HexString; username: string }, name: string) => void;
  unblock: (accountId: HexString, name: string) => void;
  forward: (target: ForwardTarget, row: MessageRow, from: string) => void;
};

const noop = () => undefined;
const NO_ACTIONS: ChatActions = {
  targets: [],
  ready: false,
  remove: noop,
  withdraw: noop,
  clear: noop,
  archive: noop,
  pin: noop,
  markUnread: noop,
  block: noop,
  unblock: noop,
  forward: noop,
};

const ChatActionsContext = createContext<ChatActions>(NO_ACTIONS);

export const ChatActionsProvider = ChatActionsContext.Provider;
export const useChatActions = (): ChatActions => useContext(ChatActionsContext);

