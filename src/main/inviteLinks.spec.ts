import { beforeEach, describe, expect, it } from 'vitest';

import { IPC } from '../shared/desktop-api';
import { INVITE_SCHEME, isGroupInviteUrl, openableUrl } from '../shared/openUrl';

import { openInviteLink, setInviteLinkWindow, takePendingInviteLink } from './inviteLinks';

// Spec 0011 ruling 9 (amended after M16b): invite links are
// `polkadot-chat://g#…`, our own scheme, so the app never captures the phone
// app's `polkadotapp://` pairing links. The M16b form is still opened for one
// release (links already shared); any other link goes where the OS sends it.
describe('group invite links', () => {
  const link = 'polkadot-chat://g#AAECAwQ';
  let sent: [string, unknown][] = [];
  const window = (loading = false) =>
    ({ isVisible: () => false, focus: () => undefined, webContents: { isLoading: () => loading, send: (channel: string, payload: unknown) => sent.push([channel, payload]) } }) as never;

  beforeEach(() => {
    sent = [];
    takePendingInviteLink();
  });

  it('knows an invite link from any other polkadotapp or web link', () => {
    expect(isGroupInviteUrl(link)).toBe(true);
    expect(isGroupInviteUrl('polkadotapp://g#AAECAwQ')).toBe(true);
    expect(isGroupInviteUrl('POLKADOTAPP://g#AAECAwQ')).toBe(true);
    expect(isGroupInviteUrl('polkadot-chat://pair?handshake=00')).toBe(false);
    expect(isGroupInviteUrl('polkadotapp://pair?handshake=00')).toBe(false);
    expect(isGroupInviteUrl('https://example.org/g#AAECAwQ')).toBe(false);
    expect(isGroupInviteUrl('polkadotapp://g#AA EC')).toBe(false);
  });

  it('sends an invite link to the page, and lets every other link through', () => {
    setInviteLinkWindow(() => window());
    expect(openInviteLink(link)).toBe(true);
    expect(sent).toEqual([[IPC.appOpenLink, link]]);
    expect(openInviteLink('polkadotapp://pair?handshake=00')).toBe(false);
    expect(sent).toHaveLength(1);
  });

  // The URL button path (main's open:url): our scheme opens an invite only; nothing else under it leaves the app.
  it('lets a url button open an invite link of our scheme, and no other link of it', () => {
    expect(openableUrl(link)).toEqual({ href: link, display: 'polkadot-chat://g' });
    expect(openableUrl('polkadot-chat://settings')).toBeNull();
  });

  // Registering `polkadotapp` would make the desktop take the phone app's pairing links (review M16b ruling 1).
  it('registers its own scheme, never the phone app’s', () => {
    expect(INVITE_SCHEME).toBe('polkadot-chat');
  });

  it('keeps the link that launched the app until the page asks for it, once', () => {
    setInviteLinkWindow(() => window(true));
    expect(openInviteLink(link)).toBe(true);
    expect(sent).toEqual([]);
    expect(takePendingInviteLink()).toBe(link);
    expect(takePendingInviteLink()).toBeNull();
  });
});
