import { extractButtonsBlock as botCoreExtract } from 'polkadot-chat-agents/lib/buttons-block.mjs';
import { describe, expect, it } from 'vitest';

import { MAX_BUTTONS_PER_ROW, MAX_LABEL_CHARS, MAX_ROWS, extractButtonsBlock } from './buttonsBlock';
import { BUTTONS_TOOL, TX_TOOL, type ToolCall, directiveFromToolCalls, directiveTools, withDirectiveBlock } from './directives';
import { txIntentFromJson } from './txIntent';

const buttonsCall = (args: unknown): ToolCall => ({ name: BUTTONS_TOOL, arguments: JSON.stringify(args) });
const rows = [[{ label: 'Red', action: { command: 'red' } }, { label: 'Blue', action: { command: 'blue' } }], [{ label: 'Docs', action: { url: 'https://docs.polkadot.com' } }]];

const tx = {
  chainId: `0x${'d6'.repeat(32)}`,
  calls: [{ kind: 0, data: '0x0a03', value: '10000000000' }],
  display: { title: 'Top up', description: 'Adds 1 PAS', amount: '1', asset: 'PAS' },
  expiresAt: 1_900_000_000_000,
};

describe('the directive tools (M13)', () => {
  // A schema looser than the parser would let a model build buttons that the
  // parser then drops; tighter would refuse buttons a fenced block may carry.
  it('take their limits from the same constants the fenced-block parser checks', () => {
    const [buttons] = directiveTools(['buttons']);
    const params = buttons?.function.parameters as { properties: { rows: { maxItems: number; items: { maxItems: number; items: { properties: { label: { maxLength: number } } } } } } };
    expect(params.properties.rows.maxItems).toBe(MAX_ROWS);
    expect(params.properties.rows.items.maxItems).toBe(MAX_BUTTONS_PER_ROW);
    expect(params.properties.rows.items.items.properties.label.maxLength).toBe(MAX_LABEL_CHARS);
    expect(directiveTools(['buttons', 'tx']).map(tool => tool.function.name)).toEqual([BUTTONS_TOOL, TX_TOOL]);
  });

  it('turn a valid send_buttons call into the fenced block\'s JSON', () => {
    const { directive, invalid } = directiveFromToolCalls([buttonsCall({ rows, oneShot: true })], ['buttons']);
    expect(invalid).toEqual([]);
    expect(directive).toEqual({ rows, oneShot: true });
  });

  // The person must never see JSON, and a broken call must not become half a keyboard.
  it('drop a call that breaks the buttons rules and say why', () => {
    const tooMany = Array.from({ length: MAX_ROWS + 1 }, () => [{ label: 'x', action: { command: 'x' } }]);
    const { directive, invalid } = directiveFromToolCalls([buttonsCall({ rows: tooMany })], ['buttons']);
    expect(directive).toBeNull();
    expect(invalid[0]).toContain(BUTTONS_TOOL);
    expect(directiveFromToolCalls([{ name: BUTTONS_TOOL, arguments: '{"rows": [[' }], ['buttons']).directive).toBeNull();
  });

  // The Assistant room has no peer to sign for; a tx tool it was not offered is refused.
  it('refuse a tool the turn was not offered', () => {
    const call: ToolCall = { name: TX_TOOL, arguments: JSON.stringify({ label: 'Top up 1 PAS', ...tx }) };
    expect(directiveFromToolCalls([call], ['buttons'])).toEqual({ directive: null, invalid: [`unknown tool ${TX_TOOL}`] });
    const offered = directiveFromToolCalls([call], ['buttons', 'tx']);
    expect(offered.directive?.rows).toEqual([[{ label: 'Top up 1 PAS', action: { tx } }]]);
    expect(txIntentFromJson(tx)?.dryRunRequired).toBe(true);
  });

  it('checks a propose_transaction intent with the spec 0007 rules (no signing without a dry-run)', () => {
    const noDryRun: ToolCall = { name: TX_TOOL, arguments: JSON.stringify({ label: 'Pay', ...tx, dryRunRequired: false }) };
    expect(directiveFromToolCalls([noDryRun], ['tx']).directive).toBeNull();
  });

  // The published agent hands the directive to bot-core as text. Wire format
  // unchanged means: bot-core's own parser reads back exactly what the tool
  // produced, so bot-core encodes the same spec 0006 message a fenced block
  // would have given.
  it('write a block that bot-core\'s parser and this app\'s parser both read back unchanged', () => {
    const { directive } = directiveFromToolCalls(
      [buttonsCall({ rows }), { name: TX_TOOL, arguments: JSON.stringify({ label: 'Top up 1 PAS', ...tx }) }],
      ['buttons', 'tx'],
    );
    const reply = withDirectiveBlock('Pick one.', directive);
    const pca = botCoreExtract(reply);
    expect(pca?.invalid).toEqual([]);
    expect(pca?.text).toBe('Pick one.');
    expect(pca?.rows?.length).toBe(3);
    expect(pca?.rows?.[2]).toMatchObject([{ label: 'Top up 1 PAS', action: { tx: { chainId: tx.chainId, dryRunRequired: true } } }]);
    const own = extractButtonsBlock(withDirectiveBlock('Pick one.', { rows, oneShot: false }));
    expect(own?.text).toBe('Pick one.');
    expect(own?.rows?.map(row => row.map(button => button.label))).toEqual([['Red', 'Blue'], ['Docs']]);
  });

  // Seen live on 2026-09-24: the proxy's default model sends buttons as bare
  // strings, one flat row, or rows as a JSON string. The intent is plain, and
  // the fenced block already accepts a flat row; a person must get the buttons.
  it('reads the shapes small models send: bare strings, a flat row, rows as a string', () => {
    const flat = directiveFromToolCalls([buttonsCall({ rows: [{ label: 'Red', action: { command: 'red' } }, { label: 'Blue', action: { command: 'blue' } }] })], ['buttons']);
    expect(flat.directive?.rows).toEqual([[{ label: 'Red', action: { command: 'red' } }, { label: 'Blue', action: { command: 'blue' } }]]);
    const strings = directiveFromToolCalls([buttonsCall({ rows: [['Ocean Blue', 'Forest Green']], oneShot: true })], ['buttons']);
    expect(strings.directive).toEqual({ rows: [[{ label: 'Ocean Blue', action: { command: 'Ocean Blue' } }, { label: 'Forest Green', action: { command: 'Forest Green' } }]], oneShot: true });
    const text = directiveFromToolCalls([buttonsCall({ rows: JSON.stringify([['Yes', 'No']]) })], ['buttons']);
    expect(text.directive?.rows.flat().map(button => button.label)).toEqual(['Yes', 'No']);
    // Code in a string is not JSON: refused, with the arguments in the reason for the log.
    const code = directiveFromToolCalls([buttonsCall({ rows: '[["Red"]].map(r => r)' })], ['buttons']);
    expect(code.directive).toBeNull();
    expect(code.invalid[0]).toContain('map(');
  });

  // Spec 0006 "Long labels": the tool path shortens like the fenced path, so
  // a wordy quiz still reaches the person as four buttons, and bot-core's
  // strict wire rule (40) accepts the block the agent writes.
  it('shortens sentence-long labels to 39 characters plus an ellipsis; a normal call is untouched', () => {
    const answers = [
      'The relay chain validates parachain blocks for shared security',
      'Parachains each run their own separate validator set 🙂',
      'Collators finalise every block on the relay chain directly',
      'Nominators produce the blocks and validators only watch them',
    ];
    const quiz = directiveFromToolCalls([buttonsCall({ rows: [answers.map((label, i) => ({ label, action: { command: 'ABCD'[i] } }))] })], ['buttons']);
    expect(quiz.invalid).toEqual([]);
    const labels = quiz.directive?.rows.flat().map(button => button.label) ?? [];
    expect(labels).toEqual(answers.map(answer => `${[...answer].slice(0, MAX_LABEL_CHARS - 1).join('')}…`));
    expect(labels.every(label => [...label].length === MAX_LABEL_CHARS)).toBe(true);
    expect(botCoreExtract(withDirectiveBlock('Which is true?', quiz.directive))?.rows?.flat()).toHaveLength(4);
    // Bare strings: the label is shortened, the command keeps the whole answer.
    const strings = directiveFromToolCalls([buttonsCall({ rows: [[answers[0]]] })], ['buttons']);
    expect(strings.directive?.rows[0]?.[0]?.action).toEqual({ command: answers[0] });
    const blank = directiveFromToolCalls([buttonsCall({ rows: [[{ label: '', action: { command: 'a' } }]] })], ['buttons']);
    expect(blank.directive?.rows[0]?.[0]?.label).toBe('Option 1');
    expect(directiveFromToolCalls([buttonsCall({ rows })], ['buttons']).directive?.rows).toEqual(rows);
  });
});
