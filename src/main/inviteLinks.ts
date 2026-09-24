/**
 * Spec 0011 ruling 9 (amended, M14): `polkadot-chat://g#…` group invite
 * links open in this app (the M16b form `polkadotapp://g#…` too, for one
 * release, when it comes from our own window). macOS hands a clicked link to the app that registered the scheme
 * (`open-url`); a link clicked in a message or pressed as a button comes
 * from our own window. Either way the renderer gets it over IPC and shows
 * the join view; the link never leaves the app.
 *
 * The OS registration happens only in the packaged app and never when
 * headless: a dev or test run must not take the scheme over on the owner's
 * Mac (the scheme is also declared in electron-builder.yml, as macOS asks).
 */

import { type BrowserWindow, app } from 'electron';

import { IPC } from '../shared/desktop-api';
import { INVITE_SCHEME, isGroupInviteUrl } from '../shared/openUrl';

let pending: string | null = null;
let getWindow: () => BrowserWindow | null = () => null;

/** Sends an invite link to the page, or keeps it until the page asks (`takeOpenLink`). */
export const openInviteLink = (url: string): boolean => {
  if (!isGroupInviteUrl(url)) return false;
  const win = getWindow();
  if (!win || win.webContents.isLoading()) {
    pending = url.trim();
    return true;
  }
  if (win.isVisible()) win.focus();
  win.webContents.send(IPC.appOpenLink, url.trim());
  return true;
};

export const takePendingInviteLink = (): string | null => {
  const url = pending;
  pending = null;
  return url;
};

/** Before `ready`: macOS delivers the link that launched the app as an early `open-url`. */
export const installInviteLinks = (options: { headless: boolean }): void => {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openInviteLink(url);
  });
  if (app.isPackaged && !options.headless) app.setAsDefaultProtocolClient(INVITE_SCHEME);
};

export const setInviteLinkWindow = (next: () => BrowserWindow | null): void => {
  getWindow = next;
};
