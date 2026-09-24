// Copied from .refs/polkadot-chat-agents/bot-core/lib/buttons-block.mjs (branch
// desktop/rfc-0003, commit 2acd215) on 2026-09-23; changes: TypeScript
// types, `unknown` inputs narrowed, the `BlockAction` / `ButtonsBlock` types
// named, `toButtonWire` added (the desktop codec's action shape). The rules are
// unchanged: keep the two files in step.
// M12e (2026-09-24): `extractButtonsBlock` ported from the same file at pca
// commit a0e0497 (spec 0006 "Host parsing leniency"); changes: TypeScript
// types. pca's `validateButtons` also takes a `tx` action; this one does not
// (the Assistant is not offered `tx`), so a `tx` button stays invalid here.
//
// Spec 0006 buttons from a brain's plain-text reply. A brain (an LLM) cannot
// build a SCALE message, so it ends its reply with a fenced block:
//
//   ```buttons
//   { "rows": [[{ "label": "Yes", "action": { "command": "yes" } },
//               { "label": "More", "action": { "callback": "page-2" } }],
//              [{ "label": "Docs", "action": { "url": "https://polkadot.com" } }]],
//     "oneShot": true }
//   ```
//
// Actions: { "command": string } (the client sends it as the user's text),
// { "callback": string } (UTF-8 bytes echoed in a buttonPress; a
// "base64:" prefix gives raw bytes instead), { "url": string } (https:// or
// polkadotapp:// only). `tx` is not offered to brains (RFC 0007).
//
// Pure functions, no Node APIs. Any rule broken -> the block is invalid and
// the reply stays plain text.

export const MAX_ROWS = 8;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_LABEL_CHARS = 40;
export const MAX_CALLBACK_BYTES = 256;

const OPEN_FENCE = '```buttons';
const URL_SCHEMES = ['https://', 'polkadotapp://'];

export type BlockAction = { command: string } | { callback: Uint8Array } | { url: string };
export type BlockButton = { label: string; action: BlockAction };
export type ButtonsBlock = { text: string; rows: BlockButton[][]; oneShot: boolean };

const decodeBase64 = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  } catch {
    return null;
  }
};

// { command } | { callback } | { url } from the JSON -> the action shape
// (callback as bytes), or null.
const toAction = (action: unknown): BlockAction | null => {
  if (action == null || typeof action !== 'object' || Array.isArray(action)) return null;
  const keys = Object.keys(action);
  if (keys.length !== 1) return null;
  const [key] = keys as [string];
  const value = (action as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  if (key === 'command') return { command: value };
  if (key === 'url') return URL_SCHEMES.some(s => value.startsWith(s)) && value.length > 8 ? { url: value } : null;
  if (key === 'callback') {
    const bytes = value.startsWith('base64:') ? decodeBase64(value.slice(7)) : new TextEncoder().encode(value);
    return bytes && bytes.length > 0 && bytes.length <= MAX_CALLBACK_BYTES ? { callback: bytes } : null;
  }
  return null;
};

// The parsed JSON -> { rows, oneShot }, or null.
export const validateButtons = (spec: unknown): Omit<ButtonsBlock, 'text'> | null => {
  if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const { rows, oneShot } = spec as { rows?: unknown; oneShot?: unknown };
  if (oneShot !== undefined && typeof oneShot !== 'boolean') return null;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return null;
  const out: BlockButton[][] = [];
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row) || row.length === 0 || row.length > MAX_BUTTONS_PER_ROW) return null;
    const buttons: BlockButton[] = [];
    for (const button of row as unknown[]) {
      const entry = button as { label?: unknown; action?: unknown } | null;
      const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
      if (label.length === 0 || [...label].length > MAX_LABEL_CHARS) return null;
      const action = toAction(entry?.action);
      if (!action) return null;
      buttons.push({ label, action });
    }
    out.push(buttons);
  }
  return { rows: out, oneShot: oneShot === true };
};

// Spec 0006 "Long labels" (2026-09-24): the lenient paths (a fenced block
// found by extractButtonsBlock, a send_buttons tool call) fix labels before
// the rules run, so one wordy label does not drop the whole keyboard. A label
// over MAX_LABEL_CHARS code points becomes its first MAX_LABEL_CHARS - 1 plus
// "…"; a missing or blank label becomes "Option N" (N counts buttons in row
// order from 1). Anything else is left for validateButtons. The strict parser
// and the wire encoder still refuse a label over the limit.
export const fitLabel = (label: unknown, n: number): unknown => {
  if (label === undefined || (typeof label === 'string' && label.trim() === '')) return `Option ${n}`;
  if (typeof label !== 'string') return label;
  const chars = [...label.trim()];
  return chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join('')}…` : label;
};

// { rows: [[button]] } -> the same with each button's label fitted. Any
// other shape is returned as it is.
export const fitLabels = (spec: unknown): unknown => {
  if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const { rows } = spec as { rows?: unknown };
  if (!Array.isArray(rows)) return spec;
  let n = 0;
  const fitted = rows.map(row =>
    Array.isArray(row)
      ? row.map(button => {
          n += 1;
          return button != null && typeof button === 'object' && !Array.isArray(button)
            ? { ...button, label: fitLabel((button as { label?: unknown }).label, n) }
            : button;
        })
      : row,
  );
  return { ...spec, rows: fitted };
};

// A reply that ENDS with a ```buttons block -> { text, rows, oneShot }, where
// text is the reply without the block. No block, or an invalid one -> null.
export const parseButtonsBlock = (reply: unknown): ButtonsBlock | null => {
  if (typeof reply !== 'string') return null;
  const body = reply.trimEnd();
  if (!body.endsWith('```')) return null;
  const start = body.lastIndexOf(OPEN_FENCE);
  if (start < 0 || (start > 0 && body[start - 1] !== '\n')) return null;
  const afterTag = body.indexOf('\n', start);
  if (afterTag < 0 || body.slice(start + OPEN_FENCE.length, afterTag).trim() !== '') return null;
  const json = body.slice(afterTag + 1, body.length - 3);
  if (json.includes('```')) return null;
  let spec: unknown;
  try {
    spec = JSON.parse(json);
  } catch {
    return null;
  }
  const buttons = validateButtons(spec);
  if (!buttons) return null;
  return { text: body.slice(0, start).trimEnd(), ...buttons };
};

// Spec 0006 "host parsing leniency" (revision 2026-09-24). Small models write
// a bare or ```json fence, a flat array of buttons instead of {"rows": [[…]]},
// or text after the block. This accepts a fence tagged buttons, json or
// untagged, anywhere in the reply, holding the rows object or a flat array
// (one row). The content rules are validateButtons' rules. The last fence that
// validates gives the rows. A fence that looks like buttons (tagged buttons,
// or JSON with `label` keys) but fails the rules is stripped too, and its
// reason goes in `invalid`, so a person never sees the raw JSON. Any other
// fence (ordinary code) stays in the text.
// -> null when no fence looks like buttons, else
//    { text, rows, oneShot, invalid: [reason] } (rows null when none validated).
export type ExtractedButtons = { text: string; rows: BlockButton[][] | null; oneShot: boolean; invalid: string[] };

const FENCE = /(^|\n)[ \t]*```([^\n`]*)\n([\s\S]*?)\n?[ \t]*```[ \t]*(?=\n|$)/g;
const LENIENT_TAGS = new Set(['buttons', 'json', '']);
const isObject = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value);
const hasLabel = (value: unknown): boolean => isObject(value) && 'label' in value;
const looksLikeButtons = (tag: string, spec: unknown): boolean =>
  tag === 'buttons' ||
  (Array.isArray(spec) && spec.some(hasLabel)) ||
  (isObject(spec) && Array.isArray(spec.rows) && (spec.rows as unknown[]).some(row => Array.isArray(row) && row.some(hasLabel)));

// Why a buttons-like spec fails validateButtons (a short reason for the log).
const invalidReason = (spec: unknown): string => {
  if (!isObject(spec)) return 'not a rows object or a flat array of buttons';
  if (spec.oneShot !== undefined && typeof spec.oneShot !== 'boolean') return 'oneShot is not a boolean';
  const { rows } = spec;
  if (!Array.isArray(rows) || rows.length === 0) return 'no rows';
  if (rows.length > MAX_ROWS) return `${rows.length} rows (max ${MAX_ROWS})`;
  for (const [r, row] of (rows as unknown[]).entries()) {
    if (!Array.isArray(row) || row.length === 0) return `row ${r + 1} is empty or not an array`;
    if (row.length > MAX_BUTTONS_PER_ROW) return `row ${r + 1} has ${row.length} buttons (max ${MAX_BUTTONS_PER_ROW})`;
    for (const [b, button] of (row as unknown[]).entries()) {
      if (!validateButtons({ rows: [[button]] })) return `row ${r + 1} button ${b + 1}: bad label (1-${MAX_LABEL_CHARS} characters) or action`;
    }
  }
  return 'invalid';
};

export const extractButtonsBlock = (reply: unknown): ExtractedButtons | null => {
  if (typeof reply !== 'string') return null;
  const pieces: string[] = [];
  const invalid: string[] = [];
  let found = false;
  let best: Omit<ButtonsBlock, 'text'> | null = null;
  let last = 0;
  for (const match of reply.matchAll(FENCE)) {
    const lead = match[1] ?? '';
    const tag = (match[2] ?? '').trim().toLowerCase();
    if (!LENIENT_TAGS.has(tag)) continue;
    let spec: unknown;
    try {
      spec = JSON.parse(match[3] ?? '');
    } catch {
      spec = undefined;
    }
    if (spec === undefined ? tag !== 'buttons' : !looksLikeButtons(tag, spec)) continue;
    found = true;
    const start = match.index + lead.length;
    pieces.push(reply.slice(last, start));
    last = match.index + match[0].length;
    const shaped = fitLabels(Array.isArray(spec) ? { rows: [spec] } : spec);
    const buttons = spec === undefined ? null : validateButtons(shaped);
    if (buttons) best = buttons;
    else invalid.push(spec === undefined ? 'not JSON' : invalidReason(shaped));
  }
  if (!found) return null;
  pieces.push(reply.slice(last));
  const text = pieces
    .map(piece => piece.trim())
    .filter(Boolean)
    .join('\n\n');
  return { text, rows: best?.rows ?? null, oneShot: best?.oneShot ?? false, invalid };
};

// Spec 0006 fallback for a peer without the extension: the text, then the
// labels as a numbered list, in row order.
// Only the labels are read, so a stored keyboard (M12e forward) takes it too.
export const buttonsFallbackText = (text: string, rows: readonly (readonly { label: string }[])[]): string => {
  const labels = rows.flat().map((button, i) => `${i + 1}. ${button.label}`);
  return [text, labels.join('\n')].filter(Boolean).join('\n\n');
};

/** Desktop only: a block button in the codec's wire shape (`ButtonWire`). */
export const toButtonWire = (
  button: BlockButton,
): { label: string; action: { tag: 'command'; value: string } | { tag: 'callback'; value: Uint8Array } | { tag: 'url'; value: string } } => {
  const action = button.action;
  if ('command' in action) return { label: button.label, action: { tag: 'command', value: action.command } };
  if ('callback' in action) return { label: button.label, action: { tag: 'callback', value: action.callback } };
  return { label: button.label, action: { tag: 'url', value: action.url } };
};
