/**
 * Chat preferences in Dexie `settings` (M6 steps 1 and 7): the send key,
 * notifications and their sound. Defaults: Enter sends, notifications and
 * sound on.
 */

import { readSetting, writeSetting } from './settings';

export type SendKey = 'enter' | 'mod-enter';

export type ChatPrefs = { sendKey: SendKey; notifications: boolean; sound: boolean };

export const DEFAULT_CHAT_PREFS: ChatPrefs = { sendKey: 'enter', notifications: true, sound: true };

export const readChatPrefs = async (): Promise<ChatPrefs> => {
  const [sendKey, notifications, sound] = await Promise.all([readSetting('chat.sendKey'), readSetting('chat.notifications'), readSetting('chat.sound')]);
  return {
    sendKey: sendKey === 'mod-enter' ? 'mod-enter' : 'enter',
    notifications: notifications !== 'off',
    sound: sound !== 'off',
  };
};

export const writeSendKey = (value: SendKey): Promise<unknown> => writeSetting('chat.sendKey', value);
export const writeNotifications = (on: boolean): Promise<unknown> => writeSetting('chat.notifications', on ? 'on' : 'off');
export const writeSound = (on: boolean): Promise<unknown> => writeSetting('chat.sound', on ? 'on' : 'off');
