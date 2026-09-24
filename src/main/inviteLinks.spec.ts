import { beforeEach, describe, expect, it } from 'vitest';

import { IPC } from '../shared/desktop-api';
import { isGroupInviteUrl } from '../shared/openUrl';

import { openInviteLink, setInviteLinkWindow, takePendingInviteLink } from './inviteLinks';

// M16b (spec 0011 ruling 9): the app opens `polkadotapp://g#…` itself, and
// only that: any other polkadotapp link (a pairing link) still goes to the app
// the OS picks, and a web link to the browser.
describe('group invite links', () => {
  const link = 'polkadotapp://g#AAECAwQ';
  let sent: [string, unknown][] = [];
  const window = (loading = false) =>
    ({ isVisible: () => false, focus: () => undefined, webContents: { isLoading: () => loading, send: (channel: string, payload: unknown) => sent.push([channel, payload]) } }) as never;

  beforeEach(() => {
    sent = [];
    takePendingInviteLink();
  });

  it('knows an invite link from any other polkadotapp or web link', () => {
    expect(isGroupInviteUrl(link)).toBe(true);
    expect(isGroupInviteUrl('POLKADOTAPP://g#AAECAwQ')).toBe(true);
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

  it('keeps the link that launched the app until the page asks for it, once', () => {
    setInviteLinkWindow(() => window(true));
    expect(openInviteLink(link)).toBe(true);
    expect(sent).toEqual([]);
    expect(takePendingInviteLink()).toBe(link);
    expect(takePendingInviteLink()).toBeNull();
  });
});
