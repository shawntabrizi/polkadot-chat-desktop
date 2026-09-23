// Copied from .refs/polkadot-chat-agents/bot-core/lib/buttons-block.mjs (branch
// desktop/rfc-0003, commit 2acd215) on 2026-09-23; changes: TypeScript
// types, `unknown` inputs narrowed, the `BlockAction` / `ButtonsBlock` types
// named, `toButtonWire` added (the desktop codec's action shape). The rules are
// unchanged: keep the two files in step.
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

// Spec 0006 fallback for a peer without the extension: the text, then the
// labels as a numbered list, in row order.
export const buttonsFallbackText = (text: string, rows: readonly BlockButton[][]): string => {
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
