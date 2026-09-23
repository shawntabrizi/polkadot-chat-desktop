/**
 * Native notifications (M6 step 7): shown by main for the renderer; a click
 * brings the window back and tells the renderer which room to open. Electron
 * is passed in, so the click path runs in a spec without a display.
 */

import { IPC, type NotifyOpen, type NotifyRequest } from '../shared/desktop-api';

type NotificationLike = {
  on(event: 'click' | 'close', listener: () => void): unknown;
  show(): void;
};

type WindowLike = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { send(channel: string, payload: NotifyOpen): void };
};

export type NotifyDeps = {
  isSupported: () => boolean;
  create: (options: { title: string; body: string; silent: boolean }) => NotificationLike;
  /** The system sound (`shell.beep()`); no audio file is bundled. */
  beep: () => void;
  getWindow: () => WindowLike | null;
};

/** Notifications must stay referenced until clicked or closed, or the click is lost. */
const live = new Set<NotificationLike>();

export const showNotification = (request: NotifyRequest, deps: NotifyDeps): void => {
  if (request.sound) deps.beep();
  if (!deps.isSupported()) return;
  // Silent: the sound is the switch's business, not the OS default's.
  const notification = deps.create({ title: request.title, body: request.body, silent: true });
  live.add(notification);
  notification.on('click', () => {
    live.delete(notification);
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(IPC.notifyOpen, { peerId: request.peerId, ...(request.requestId ? { requestId: request.requestId } : {}) });
  });
  notification.on('close', () => live.delete(notification));
  notification.show();
};
