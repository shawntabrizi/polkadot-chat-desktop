/**
 * Spec 0006 `url` action: only `https://` and `polkadotapp://` links open,
 * plus our own group invite links (`polkadot-chat://g#…`, M14), and never
 * without the user seeing where they go. Used by the renderer (to
 * render and confirm) and by the main process (the `open:url` IPC checks it
 * again: the renderer shows remote content and is not trusted).
 */

const OPENABLE = new Set(['https:', 'polkadotapp:']);
const MAX_URL_CHARS = 2048;

export type OpenableUrl = {
  /** The normalized link to open. */
  href: string;
  /** What the confirm strip shows: the host (https), or scheme and host (polkadotapp). */
  display: string;
};

/**
 * Spec 0011 ruling 9 (amended after M16b): invite links have their own
 * scheme, so registering it never captures the phone app's `polkadotapp://`
 * pairing links.
 */
export const INVITE_SCHEME = 'polkadot-chat';

/**
 * A group invite link, `polkadot-chat://g#<InviteLink base64url>`. The app
 * opens it itself (the join view); its fragment never goes to a server or to
 * another app. The M16b form `polkadotapp://g#…` is still taken for one
 * release (links already shared, pca bots not yet moved), never made.
 */
export const isGroupInviteUrl = (value: string): boolean => /^(?:polkadot-chat|polkadotapp):\/\/g#[A-Za-z0-9_-]+$/i.test(value.trim()) && value.length <= MAX_URL_CHARS;

export const openableUrl = (value: string): OpenableUrl | null => {
  if (value.length > MAX_URL_CHARS) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Our own scheme opens nothing but an invite link (main routes it to the join view).
  if (url.protocol === `${INVITE_SCHEME}:`) return isGroupInviteUrl(value) ? { href: value.trim(), display: `${INVITE_SCHEME}://g` } : null;
  if (!OPENABLE.has(url.protocol)) return null;
  if (url.protocol === 'https:') return url.host ? { href: url.href, display: url.host } : null;
  return { href: url.href, display: url.host ? `polkadotapp://${url.host}` : url.href };
};
