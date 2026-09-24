/**
 * Spec 0006 `url` action: only `https://` and `polkadotapp://` links open,
 * and never without the user seeing where they go. Used by the renderer (to
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
 * M16b (spec 0011 ruling 9): a group invite link, `polkadotapp://g#<InviteLink
 * base64url>`. The app opens it itself (the join view); its fragment never
 * goes to a server or to another app.
 */
export const isGroupInviteUrl = (value: string): boolean => /^polkadotapp:\/\/g#[A-Za-z0-9_-]+$/i.test(value.trim()) && value.length <= MAX_URL_CHARS;

export const openableUrl = (value: string): OpenableUrl | null => {
  if (value.length > MAX_URL_CHARS) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!OPENABLE.has(url.protocol)) return null;
  if (url.protocol === 'https:') return url.host ? { href: url.href, display: url.host } : null;
  return { href: url.href, display: url.host ? `polkadotapp://${url.host}` : url.href };
};
