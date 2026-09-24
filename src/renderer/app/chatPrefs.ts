/**
 * Chat preferences in Dexie `settings` (M6 steps 1 and 7, M7 step 6, M12c):
 * the send key, notifications and their sound, the typing reveal of bot
 * replies, the spec 0005 signals we send, and the block explorer.
 * Defaults: Enter sends; notifications, sound, reveal and read receipts on;
 * typing off (it costs one network submission every 10 s); Subscan.
 */

import { DEFAULT_EXPLORER, type ExplorerId, isExplorerId } from '../../shared/explorers';

import { readSetting, writeSetting } from './settings';

export type SendKey = 'enter' | 'mod-enter';

export type ChatPrefs = {
  sendKey: SendKey;
  notifications: boolean;
  sound: boolean;
  revealReplies: boolean;
  /** Send spec 0005 `typing` while composing (M12c: opt-in, default off). Receiving always works. */
  sendTyping: boolean;
  /** Send spec 0005 `seen` receipts (M9; default on, docs/decisions.md). */
  readReceipts: boolean;
  /** Where "View on …" opens a transaction or an account. */
  explorer: ExplorerId;
};

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  sendKey: 'enter',
  notifications: true,
  sound: true,
  revealReplies: true,
  sendTyping: false,
  readReceipts: true,
  explorer: DEFAULT_EXPLORER,
};

export const readChatPrefs = async (): Promise<ChatPrefs> => {
  const [sendKey, notifications, sound, reveal, typing, receipts, explorer] = await Promise.all([
    readSetting('chat.sendKey'),
    readSetting('chat.notifications'),
    readSetting('chat.sound'),
    readSetting('chat.reveal'),
    readSetting('chat.sendTyping'),
    readSetting('chat.readReceipts'),
    readSetting('chat.explorer'),
  ]);
  return {
    sendKey: sendKey === 'mod-enter' ? 'mod-enter' : 'enter',
    notifications: notifications !== 'off',
    sound: sound !== 'off',
    revealReplies: reveal !== 'off',
    sendTyping: typing === 'on',
    readReceipts: receipts !== 'off',
    explorer: isExplorerId(explorer) ? explorer : DEFAULT_EXPLORER,
  };
};

export const writeSendKey = (value: SendKey): Promise<unknown> => writeSetting('chat.sendKey', value);
export const writeNotifications = (on: boolean): Promise<unknown> => writeSetting('chat.notifications', on ? 'on' : 'off');
export const writeSound = (on: boolean): Promise<unknown> => writeSetting('chat.sound', on ? 'on' : 'off');
export const writeRevealReplies = (on: boolean): Promise<unknown> => writeSetting('chat.reveal', on ? 'on' : 'off');
export const writeSendTyping = (on: boolean): Promise<unknown> => writeSetting('chat.sendTyping', on ? 'on' : 'off');
export const writeReadReceipts = (on: boolean): Promise<unknown> => writeSetting('chat.readReceipts', on ? 'on' : 'off');
export const writeExplorer = (value: ExplorerId): Promise<unknown> => writeSetting('chat.explorer', value);
