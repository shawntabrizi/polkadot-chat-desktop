import { describe, expect, it } from 'vitest';

import { BUTTONS_HINT } from 'polkadot-chat-agents/lib/agent-context.mjs';

import { BUTTON_LABELS_HINT, SYSTEM_PROMPT, withToolsHint } from '../../shared/assistantPrompt';
import { extractButtonsBlock } from '../../shared/buttonsBlock';
import type { EngineRunResult } from '../assistant/engines/types';

import { type AgentEngineInfo, type AgentTurn, EMPTY_OPENER_PROMPT, FAILED_TEXT, createAgentBrain } from './brain';

const proxy: AgentEngineInfo = { id: 'proxy', label: 'Proxy', model: 'auto/test', tools: true };
const cli: AgentEngineInfo = { id: 'claude', label: 'Claude Code', model: null, tools: false };

const brainWith = (engine: AgentEngineInfo, run: (turn: AgentTurn) => Promise<EngineRunResult>) =>
  createAgentBrain({ username: () => 'shawnbot.01', owner: () => 'shawn.42', engine: () => engine, run });

describe('the published agent\'s brain (M13)', () => {
  // Commands cost no engine turn: a stranger typing /help must not spend tokens.
  it('answers /help and /about itself and never calls the engine for them', async () => {
    const turns: AgentTurn[] = [];
    const brain = brainWith(proxy, async turn => (turns.push(turn), { text: 'x' }));
    expect((await brain.answer('p', '/help'))?.text).toContain('/about');
    expect((await brain.answer('p', '/about'))?.text).toContain('shawn.42');
    expect((await brain.answer('p', '/nope'))?.text).toContain('/help');
    expect(turns).toHaveLength(0);
  });

  // Strangers can type /about or ask the model: neither may learn which model the owner pays for.
  it('never names the model to a peer: /about says the engine kind, the prompt hides the model', async () => {
    const turns: AgentTurn[] = [];
    const brain = brainWith(proxy, async turn => (turns.push(turn), { text: 'x' }));
    const about = (await brain.answer('p', '/about'))?.text ?? '';
    expect(about).toContain('an AI assistant run from a Polkadot Chat desktop');
    expect(about).not.toContain('auto/test');
    await brain.answer('p', 'hello');
    expect(turns[0]?.systemPrompt).not.toContain('auto/test');
  });

  it('greets an empty chat request through the engine, in its persona', async () => {
    const turns: AgentTurn[] = [];
    const brain = brainWith(proxy, async turn => (turns.push(turn), { text: 'Hello there!' }));
    expect(await brain.answer('p', '')).toEqual({ text: 'Hello there!', engine: true });
    expect(turns[0]?.prompt).toBe(EMPTY_OPENER_PROMPT);
    expect(turns[0]?.systemPrompt).toContain('You are the Assistant inside Polkadot Chat');
    expect(turns[0]?.systemPrompt).toContain('shawnbot.01');
  });

  // The proxy gets buttons as a tool and bot-core only reads text: the
  // directive must come back as the canonical block, or no keyboard is sent.
  it('offers the proxy the directive tools and writes their result as a fenced block', async () => {
    const brain = brainWith(proxy, async turn => {
      expect(turn.directives).toEqual(['buttons', 'tx']);
      // With tools the fenced wording would contradict them.
      expect(turn.systemPrompt).not.toContain(BUTTONS_HINT);
      // Spec 0006 "Long labels": short labels, the full text in the message.
      expect(turn.systemPrompt).toContain(BUTTON_LABELS_HINT);
      return { text: 'Pick one.', directive: { rows: [[{ label: 'Red', action: { command: 'red' } }]], oneShot: false } };
    });
    const reply = await brain.answer('p', 'give me a choice');
    const block = extractButtonsBlock(reply?.text);
    expect(block?.text).toBe('Pick one.');
    expect(block?.rows?.[0]?.[0]?.label).toBe('Red');
  });

  // A CLI engine has no tools: it must get pca's buttons MUST wording instead.
  it('gives a text-only engine the operator context with the buttons MUST wording and no tools', async () => {
    const brain = brainWith(cli, async turn => {
      expect(turn.directives).toEqual([]);
      expect(turn.systemPrompt).toContain(BUTTONS_HINT);
      expect(turn.systemPrompt).toContain(BUTTON_LABELS_HINT);
      return { text: 'ok' };
    });
    expect((await brain.answer('p', 'hi'))?.text).toBe('ok');
  });

  // The Assistant room says the same, with the fenced wording or the tool wording.
  it('the Assistant prompt keeps the short-labels line with or without tools', () => {
    expect(SYSTEM_PROMPT).toContain(BUTTON_LABELS_HINT);
    expect(withToolsHint(SYSTEM_PROMPT)).toContain(BUTTON_LABELS_HINT);
    expect(BUTTON_LABELS_HINT).toBe('Labels are at most 40 characters: a few words, never a sentence; put the full text in the message and use short labels like A, B, C or the key words.');
  });

  it('keeps each peer\'s earlier turns apart', async () => {
    const seen: AgentTurn[] = [];
    const brain = brainWith(proxy, async turn => (seen.push(turn), { text: `re: ${turn.prompt}` }));
    await brain.answer('alice', 'one');
    await brain.answer('bob', 'two');
    await brain.answer('alice', 'three');
    expect(seen[2]?.history).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 're: one' },
    ]);
  });

  // /stop is the peer's lever on a long turn: the turn ends with no reply.
  it('/stop aborts the running turn, which then sends nothing', async () => {
    const brain = brainWith(proxy, turn => new Promise((_, fail) => turn.signal.addEventListener('abort', () => fail(new Error('aborted')))));
    const pending = brain.answer('p', 'a long question');
    await Promise.resolve();
    expect(brain.isCommand(' /STOP ', 'stop')).toBe(true);
    expect(brain.stop('p')).toBe(true);
    expect(await pending).toBeNull();
    expect(brain.stop('p')).toBe(false);
  });

  it('answers with a short apology when the engine fails, never with the error text', async () => {
    const brain = brainWith(proxy, async () => {
      throw new Error('HTTP 500 secret-ish detail');
    });
    expect(await brain.answer('p', 'hi')).toEqual({ text: FAILED_TEXT, engine: false });
  });
});
