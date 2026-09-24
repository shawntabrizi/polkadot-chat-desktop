/**
 * What a streaming reply shows before it ends (owner-reported bug, M12): a
 * fenced block tagged with a client directive (```buttons) is not text to
 * read, so its raw JSON must never flash in a code block while it arrives.
 *
 * - An open directive fence: the text up to the fence, and a placeholder in
 *   place of the block. Since M12e (spec 0006 "Host parsing leniency") an
 *   open untagged or ```json fence whose first non-space character is `[` or
 *   `{` counts as one too; while it has no character yet it is held back.
 * - Closed blocks go through the same lenient extraction as the finished
 *   reply (`extractButtonsBlock`): a valid one shows its keyboard, an invalid
 *   button-looking one is stripped, and the text around them stays.
 * - A trailing partial fence (one or two backticks, or the start of a
 *   directive tag such as "```butt") is held back, so it does not flicker.
 * Ordinary code fences keep rendering as code.
 */

import { type ButtonsBlock, extractButtonsBlock } from '../../shared/buttonsBlock';

/** Fence tags the client acts on instead of showing. Only `buttons` today. */
export const CLIENT_DIRECTIVES: readonly string[] = ['buttons'];
/** Fence tags that hide like a directive when their body starts as JSON (spec 0006 leniency). */
const LENIENT_TAGS: readonly string[] = ['json', ''];

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

/** A fence opened on a whole line and not closed yet: where its line starts, its tag, and its body so far. */
const openFence = (text: string): { start: number; tag: string; body: string } | null => {
  let open: { start: number; tag: string; bodyStart: number } | null = null;
  let offset = 0;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const complete = index < lines.length - 1;
    if (open) {
      if (/^[ \t]*```[ \t]*$/.test(line)) open = null;
    } else if (complete) {
      const tag = /^[ \t]*```([^`]*)$/.exec(line)?.[1];
      if (tag !== undefined) open = { start: offset, tag: tag.trim().toLowerCase(), bodyStart: offset + line.length + 1 };
    }
    offset += line.length + 1;
  });
  const found = open as { start: number; tag: string; bodyStart: number } | null;
  return found ? { start: found.start, tag: found.tag, body: text.slice(found.bodyStart) } : null;
};

export const streamingView = (raw: string): StreamingView => {
  let closed = raw;
  let placeholder = false;
  let hidden = false;
  const open = openFence(raw);
  if (open) {
    const first = open.body.trimStart()[0];
    const directive = CLIENT_DIRECTIVES.includes(open.tag) || (LENIENT_TAGS.includes(open.tag) && (first === '[' || first === '{'));
    // An empty untagged or json fence: its first character decides, so it is not shown yet.
    const undecided = LENIENT_TAGS.includes(open.tag) && first === undefined;
    if (directive || undecided) {
      closed = raw.slice(0, open.start);
      placeholder = directive;
      hidden = true;
    }
  }
  const extracted = extractButtonsBlock(closed);
  if (extracted) {
    const block = extracted.rows ? { text: extracted.text, rows: extracted.rows, oneShot: extracted.oneShot } : null;
    return { text: extracted.text, placeholder, block };
  }
  if (hidden) return { text: closed.trimEnd(), placeholder, block: null };
  const partial = partialFence(raw);
  return { text: partial === null ? raw : raw.slice(0, partial).trimEnd(), placeholder: false, block: null };
};
