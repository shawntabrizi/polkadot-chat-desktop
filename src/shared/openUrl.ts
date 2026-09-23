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
