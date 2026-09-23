/**
 * Native notifications for new incoming messages and chat requests (M6
 * step 7). Rows are watched as Dexie creates them (after the write commits),
 * so a replayed statement, whose row already exists, never notifies twice.
 * Never for own messages, system rows or the Assistant; never for a muted
 * room; never while that room is open in the focused window.
 */

import { useEffect, useRef } from 'react';

import { readChatPrefs } from '../app/chatPrefs';
import { type MessageRow, type PeerId, type RequestRow, db } from '../app/database';
import { isAssistantPeer } from '../domain/assistant/assistant';
import { previewOf } from '../domain/chat/content';

import type { DesktopAppApi } from '../../shared/desktop-api';

/** A statement older than this is history arriving late, not news. */
const STALE_MS = 24 * 60 * 60 * 1000;

const BODY_CHARS = 140;

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > BODY_CHARS ? `${line.slice(0, BODY_CHARS - 1)}…` : line;
};

/** Pure rule, for the spec: should this new row raise a notification? */
export const shouldNotify = ({
  row,
  selectedPeer,
  windowFocused,
  muted,
  enabled,
  now,
}: {
  row: Pick<MessageRow, 'direction' | 'peerAccountId' | 'timestamp'>;
  selectedPeer: PeerId | null;
  windowFocused: boolean;
  muted: boolean;
  enabled: boolean;
  now: number;
}): boolean => {
  if (!enabled || muted) return false;
  if (row.direction !== 'incoming' || isAssistantPeer(row.peerAccountId)) return false;
  if (now - row.timestamp > STALE_MS) return false;
  return !windowFocused || selectedPeer !== row.peerAccountId;
};

export const useNotifications = (app: DesktopAppApi | null, selectedPeer: PeerId | null): void => {
  const selected = useRef(selectedPeer);
  useEffect(() => {
    selected.current = selectedPeer;
  }, [selectedPeer]);

  useEffect(() => {
    if (!app) return;
    const notifyMessage = async (row: MessageRow) => {
      const [prefs, room, contact] = await Promise.all([
        readChatPrefs(),
        db.rooms.get(row.peerAccountId),
        isAssistantPeer(row.peerAccountId) ? undefined : db.contacts.get(row.peerAccountId),
      ]);
      const ok = shouldNotify({
        row,
        selectedPeer: selected.current,
        windowFocused: document.hasFocus(),
        muted: room?.muted === true,
        enabled: prefs.notifications,
        now: Date.now(),
      });
      if (!ok || !contact) return;
      app.notify({ title: contact.username, body: oneLine(previewOf(row.content)), peerId: row.peerAccountId, sound: prefs.sound });
    };
    const notifyRequest = async (row: RequestRow) => {
      if (row.direction !== 'incoming' || row.status !== 'pending' || Date.now() - row.timestamp > STALE_MS) return;
      const [prefs, contact] = await Promise.all([readChatPrefs(), db.contacts.get(row.peerAccountId)]);
      if (!prefs.notifications || contact) return;
      app.notify({
        title: row.peerUsername,
        body: row.welcomeMessage ? oneLine(row.welcomeMessage) : 'Message request',
        peerId: row.peerAccountId,
        requestId: row.requestId,
        sound: prefs.sound,
      });
    };

    const onMessage = (_key: unknown, row: MessageRow, transaction: { on: (event: 'complete', listener: () => void) => void }) => {
      transaction.on('complete', () => void notifyMessage(row).catch(() => undefined));
    };
    const onRequest = (_key: unknown, row: RequestRow, transaction: { on: (event: 'complete', listener: () => void) => void }) => {
      transaction.on('complete', () => void notifyRequest(row).catch(() => undefined));
    };
    db.messages.hook('creating', onMessage);
    db.requests.hook('creating', onRequest);
    return () => {
      db.messages.hook('creating').unsubscribe(onMessage);
      db.requests.hook('creating').unsubscribe(onRequest);
    };
  }, [app]);
};
