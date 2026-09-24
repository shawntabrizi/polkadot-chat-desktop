// M15b (review M15a): the e2e's bot step must prove the bot described the
// image it was sent. M15a accepted any bot text with "dot" in it, and the
// guide bot's greeting ("…your friendly Polkadot support guide") passed.
// Now only the bot's texts AFTER the attachment message count (repliesAfter),
// and one of them must say what the image shows or its size
// (describesImage). The words "image" or "photo" alone are not enough: the
// fleet guide bot answered "I can't see images—tools are disabled", which
// names images without describing one.

/** Progress frames a pca bot shows while it works (⏳ working, 🤔 thinking, ✓ done). */
const PROGRESS = /^(?:⏳|🤔|✓) /u;
/** What the e2e test image shows: a red circle on grey noise. */
const CONTENT_WORDS = ['red', 'circle', 'circles', 'circular', 'round', 'disc', 'disk', 'ball', 'sphere', 'grey', 'gray', 'noise', 'noisy', 'static', 'grain', 'grainy', 'speckled'];
/** A bot saying it cannot look. */
const REFUSAL = /\b(?:can(?:'|’)?t|cannot|can not|unable to|not able to|don(?:'|’)?t have|no access)\b[^.!?]*\b(?:see|view|read|open|look|access|process|analy[sz]e)\b|tools are disabled/i;

/** Whether the bot says it cannot look at the image: no later text is waited for. */
export const refusesToLook = (text) => REFUSAL.test(String(text));

/**
 * Whether `text` describes the test image: it names what the image shows
 * (red, a circle, grey noise…) or its size (`width`×`height`, or both
 * numbers), and it is not a refusal to look.
 */
export function describesImage(text, { width, height }) {
  const lower = String(text).toLowerCase();
  if (REFUSAL.test(lower)) return false;
  if (CONTENT_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(lower))) return true;
  if (new RegExp(`\\b${width}\\s*(?:x|×|by)\\s*${height}\\b`).test(lower)) return true;
  return new RegExp(`\\b${width}\\b`).test(lower) && new RegExp(`\\b${height}\\b`).test(lower);
}

/**
 * The bot's texts after the attachment: incoming text or reply rows that
 * were not there before the attachment went out (`before`, a set of message
 * ids), without progress frames, in the order the room lists them.
 */
export function repliesAfter(rows, before) {
  return rows.filter(
    (row) =>
      row.direction === 'incoming' && !before.has(row.messageId) && (row.content.type === 'text' || row.content.type === 'reply') && !PROGRESS.test(row.content.text),
  );
}
