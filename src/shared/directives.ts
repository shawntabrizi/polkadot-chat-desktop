/**
 * M13 structured directives: the `send_buttons` and `propose_transaction`
 * tools an engine with tool calling (the LLM proxy) is offered instead of the
 * fenced ```buttons block. One schema module: the tool parameters are built
 * from the limits of `buttonsBlock.ts` and `txIntent.ts`, and a tool call is
 * checked with the same `validateButtons` / `txIntentFromJson` the fenced
 * block goes through. A valid call becomes a `Directive`, which is exactly
 * the JSON a fenced block holds, so both paths meet in one place:
 * - the Assistant room renders it with `replyContent(text, directive)`;
 * - the published agent writes it back as a canonical fenced block
 *   (`directiveBlock`) for bot-core, which encodes the spec 0006 message.
 * The wire format does not change. Browser-safe: no Node imports.
 */

import { MAX_BUTTONS_PER_ROW, MAX_CALLBACK_BYTES, MAX_LABEL_CHARS, MAX_ROWS, fitLabels, validateButtons } from './buttonsBlock';
import { MAX_CALL_DATA, MAX_DESCRIPTION, MAX_TITLE, MAX_TX_CALLS, txIntentFromJson } from './txIntent';

export const BUTTONS_TOOL = 'send_buttons';
export const TX_TOOL = 'propose_transaction';

/** Which directives an engine turn may produce: buttons (both rooms), a transaction button (the published agent only). */
export type DirectiveKind = 'buttons' | 'tx';

/** One button as the fenced block's JSON writes it. `tx` holds spec 0007 intent JSON. */
export type DirectiveButton = { label: string; action: { command: string } | { callback: string } | { url: string } | { tx: Record<string, unknown> } };
/** The fenced block's JSON: `{ "rows": [[…]], "oneShot": false }`. */
export type Directive = { rows: DirectiveButton[][]; oneShot: boolean };

/** A tool call as an OpenAI-style stream closes it: the name and the arguments JSON text. */
export type ToolCall = { name: string; arguments: string };

/** An OpenAI-style function tool. */
export type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

const labelSchema = { type: 'string', minLength: 1, maxLength: MAX_LABEL_CHARS, description: `The button text, at most ${MAX_LABEL_CHARS} characters.` };

const actionSchema = {
  type: 'object',
  description: 'Exactly one of: command (text sent back to you as the user\'s next message), callback (a string echoed back to you), url (an https:// link the user may open).',
  properties: {
    command: { type: 'string', minLength: 1 },
    callback: { type: 'string', minLength: 1, description: `At most ${MAX_CALLBACK_BYTES} bytes.` },
    url: { type: 'string', pattern: '^(https|polkadotapp)://' },
  },
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: false,
};

const BUTTONS_PARAMETERS = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_ROWS,
      description: `Rows of buttons, at most ${MAX_ROWS} rows of ${MAX_BUTTONS_PER_ROW}.`,
      items: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BUTTONS_PER_ROW,
        items: { type: 'object', properties: { label: labelSchema, action: actionSchema }, required: ['label', 'action'], additionalProperties: false },
      },
    },
    oneShot: { type: 'boolean', description: 'True: the buttons go away after one press.' },
  },
  required: ['rows'],
  additionalProperties: false,
};

const hex = (description: string) => ({ type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', description });
const decimal = (description: string) => ({ type: 'string', pattern: '^\\d{1,40}$', description });

const TX_PARAMETERS = {
  type: 'object',
  properties: {
    label: labelSchema,
    chainId: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', description: 'The genesis hash of the chain the call runs on.' },
    calls: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TX_CALLS,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'integer', enum: [0, 1], description: '0: raw extrinsic call data; 1: a Revive contract call.' },
          to: hex('Kind 1 only: the 20-byte contract address.'),
          data: { ...hex(`The call data, at most ${MAX_CALL_DATA} bytes.`) },
          value: decimal('Native units sent with the call (planck), as a decimal string.'),
        },
        required: ['kind', 'data'],
        additionalProperties: false,
      },
    },
    display: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE },
        description: { type: 'string', maxLength: MAX_DESCRIPTION },
        amount: { type: 'string', maxLength: 64 },
        asset: { type: 'string', maxLength: 64 },
      },
      required: ['title'],
      additionalProperties: false,
    },
    expiresAt: { type: 'integer', minimum: 0, description: 'Unix time in milliseconds after which the button is disabled; 0 = never expires (a fixed call that cannot go stale).' },
  },
  required: ['label', 'chainId', 'calls', 'display', 'expiresAt'],
  additionalProperties: false,
};

const TOOLS: Record<DirectiveKind, ToolDefinition> = {
  buttons: {
    type: 'function',
    function: {
      name: BUTTONS_TOOL,
      description:
        'Show real clickable buttons under your reply. Use it when the user asks for buttons or should pick from a few choices. ' +
        'Write your message as normal text in the same reply; this tool only adds the buttons. Call it at most once.',
      parameters: BUTTONS_PARAMETERS,
    },
  },
  tx: {
    type: 'function',
    function: {
      name: TX_TOOL,
      description:
        'Offer one transaction button: the user\'s app shows the effect and the fee, and the user signs it or not. ' +
        'You never sign anything. Write your message as normal text in the same reply.',
      parameters: TX_PARAMETERS,
    },
  },
};

/** The tools for a turn that may produce `kinds`. */
export const directiveTools = (kinds: readonly DirectiveKind[]): ToolDefinition[] => kinds.map(kind => TOOLS[kind]);

/** The system prompt line that goes with the tools (it replaces the fenced-block wording). */
export const directiveToolsHint = (kinds: readonly DirectiveKind[]): string =>
  [
    kinds.includes('buttons') ? `To show buttons, call the ${BUTTONS_TOOL} tool; never write a buttons block or button JSON in the text.` : '',
    kinds.includes('tx') ? `To ask the user to sign a transaction, call the ${TX_TOOL} tool.` : '',
  ]
    .filter(Boolean)
    .join(' ');

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value);

const parseArguments = (text: string): unknown => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return undefined;
  }
};

/**
 * `send_buttons` arguments as small models write them, in the canonical
 * shape (checked live with the proxy's default model on 2026-09-24): `rows`
 * as a JSON string, `rows` as one flat list of buttons (the fenced block's
 * leniency, spec 0006 revision 2026-09-24), and a bare string as a button
 * (its label is also its command). Anything else is left for the rules to
 * refuse.
 */
export const shapeButtonsArguments = (args: Record<string, unknown>): Record<string, unknown> => {
  let rows: unknown = args.rows;
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows);
    } catch {
      return args;
    }
  }
  if (!Array.isArray(rows)) return { ...args, rows };
  const button = (entry: unknown): unknown => (typeof entry === 'string' && entry.trim() ? { label: entry.trim(), action: { command: entry.trim() } } : entry);
  const nested = rows.every(row => Array.isArray(row)) ? (rows as unknown[][]) : [rows as unknown[]];
  return { ...args, rows: nested.map(row => row.map(button)) };
};

/**
 * The tool calls of one turn → the directive, or null. The same rules as a
 * fenced block: the last valid `send_buttons` gives the rows (a model that
 * calls it twice corrected itself); each valid `propose_transaction` adds a
 * row with its button. An invalid call is dropped and its reason goes in
 * `invalid`, so it is logged, never shown to a person.
 */
export const directiveFromToolCalls = (calls: readonly ToolCall[], kinds: readonly DirectiveKind[]): { directive: Directive | null; invalid: string[] } => {
  const invalid: string[] = [];
  let buttons: Directive | null = null;
  const txRows: DirectiveButton[][] = [];
  for (const call of calls) {
    const args = parseArguments(call.arguments);
    if (call.name === BUTTONS_TOOL && kinds.includes('buttons')) {
      const shaped = isRecord(args) ? (fitLabels(shapeButtonsArguments(args)) as Record<string, unknown>) : null;
      if (!shaped || !validateButtons(shaped)) {
        invalid.push(`${BUTTONS_TOOL}: arguments break the buttons rules (${call.arguments.slice(0, 120)})`);
        continue;
      }
      buttons = { rows: shaped.rows as DirectiveButton[][], oneShot: shaped.oneShot === true };
    } else if (call.name === TX_TOOL && kinds.includes('tx')) {
      if (!isRecord(args)) {
        invalid.push(`${TX_TOOL}: arguments are not an object`);
        continue;
      }
      const { label, ...tx } = args;
      const labelOk = typeof label === 'string' && label.trim().length > 0 && [...label.trim()].length <= MAX_LABEL_CHARS;
      if (!labelOk || !txIntentFromJson(tx)) {
        invalid.push(`${TX_TOOL}: bad label or transaction intent`);
        continue;
      }
      txRows.push([{ label: label.trim(), action: { tx } }]);
    } else {
      invalid.push(`unknown tool ${call.name}`);
    }
  }
  const rows = [...(buttons?.rows ?? []), ...txRows];
  if (rows.length === 0) return { directive: null, invalid };
  if (rows.length > MAX_ROWS) return { directive: null, invalid: [...invalid, `${rows.length} rows (max ${MAX_ROWS})`] };
  return { directive: { rows, oneShot: buttons?.oneShot ?? false }, invalid };
};

/** The canonical fenced block of a directive (spec 0006 "Fenced-block authoring"). */
export const directiveBlock = (directive: Directive): string => `\`\`\`buttons\n${JSON.stringify(directive)}\n\`\`\``;

/** A reply's text with the directive as its trailing block: what bot-core's parser reads. */
export const withDirectiveBlock = (text: string, directive: Directive | null): string => {
  if (!directive) return text;
  const body = text.trimEnd();
  return body ? `${body}\n\n${directiveBlock(directive)}` : directiveBlock(directive);
};
