/**
 * What a streaming reply shows before it ends (owner-reported bug, M12): a
 * fenced block tagged with a client directive (```buttons) is not text to
 * read, so its raw JSON must never flash in a code block while it arrives.
 *
 * - An open directive fence: the text up to the fence, and a placeholder in
 *   place of the block.
 * - A closed, valid block: its keyboard (as the finished reply will show).
 * - A closed, malformed block: plain text, as at the end.
 * - A trailing partial fence (one or two backticks, or the start of a
 *   directive tag such as "```butt") is held back, so it does not flicker.
 * Ordinary code fences keep rendering as code.
 */

import { type ButtonsBlock, parseButtonsBlock } from '../../shared/buttonsBlock';

/** Fence tags the client acts on instead of showing. Only `buttons` today. */
export const CLIENT_DIRECTIVES: readonly string[] = ['buttons'];

export type StreamingView = { text: string; placeholder: boolean; block: ButtonsBlock | null };

/** The last line, when it is a fence still being typed: backticks only, or a prefix of a directive fence. */
const partialFence = (text: string): number | null => {
  const start = text.lastIndexOf('\n') + 1;
  const line = text.slice(start);
  if (/^`{1,2}$/.test(line)) return start;
  // A bare fence after an odd number of fence lines closes a block: it is not a partial opening.
  const fencesBefore = text.slice(0, start).split('\n').filter(entry => entry.startsWith('```')).length;
  if (line === '```' && fencesBefore % 2 === 1) return null;
  if (line.startsWith('```') && CLIENT_DIRECTIVES.some(tag => `\`\`\`${tag}`.startsWith(line) && line.length < tag.length + 3)) return start;
  return null;
};

/** The start of an open directive fence (a line "```buttons" with no closing fence after it), or null. */
const openDirective = (text: string): number | null => {
  for (const tag of CLIENT_DIRECTIVES) {
    const fence = `\`\`\`${tag}`;
    let at = text.lastIndexOf(fence);
    while (at >= 0 && at > 0 && text[at - 1] !== '\n') at = text.lastIndexOf(fence, at - 1);
    if (at < 0) continue;
    const lineEnd = text.indexOf('\n', at);
    const tagLine = text.slice(at + fence.length, lineEnd < 0 ? undefined : lineEnd);
    if (tagLine.trim() !== '') continue;
    const rest = lineEnd < 0 ? '' : text.slice(lineEnd + 1);
    // Closed (valid or not) is not open: the caller shows the keyboard or the plain text.
    if (!/(^|\n)```/.test(rest)) return at;
  }
  return null;
};

export const streamingView = (raw: string): StreamingView => {
  const block = parseButtonsBlock(raw);
  if (block) return { text: block.text, placeholder: false, block };
  const open = openDirective(raw);
  if (open !== null) return { text: raw.slice(0, open).trimEnd(), placeholder: true, block: null };
  const partial = partialFence(raw);
  return { text: partial === null ? raw : raw.slice(0, partial).trimEnd(), placeholder: false, block: null };
};
