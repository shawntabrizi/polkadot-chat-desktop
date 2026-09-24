/**
 * M13: the published agent's brain, in the main process. bot-core (run as a
 * child, see runtime.ts) owns the chat protocol and hands each message over
 * its bridge; this module decides the answer:
 * - `/help`, `/about` and `/stop` are answered here, never by the engine;
 * - an empty chat request (the opener) gets a greeting in the Assistant's
 *   persona, as pca's direct brains do;
 * - anything else goes to the engine chosen in Settings › Assistant, with the
 *   Assistant's persona plus the operator context pca gives its bots, and the
 *   peer's earlier turns (memory only).
 * An engine with tool calling (the proxy) gets `send_buttons` and
 * `propose_transaction` as tools; its directive is written back as the
 * canonical fenced block, which bot-core encodes as spec 0006 buttons. A
 * text-only engine (a CLI) writes the fenced block itself, as before.
 * No `electron` import: the unit tests drive it with a fake engine.
 */

import { buildOperatorContext } from 'polkadot-chat-agents/lib/agent-context.mjs';

import { ASSISTANT_PERSONA, BUTTON_LABELS_HINT } from '../../shared/assistantPrompt';
import { type DirectiveKind, withDirectiveBlock } from '../../shared/directives';
import type { EngineRunResult, Turn } from '../assistant/engines/types';

/** The commands the agent answers itself; also its botInfo command menu. */
export const AGENT_COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'help', description: 'List these commands' },
  { name: 'about', description: 'Who I am and who runs me' },
  { name: 'stop', description: 'Stop what I am working on' },
];

// The same prompt pca's agent-runtime gives a brain for an empty opener
// (.refs/polkadot-chat-agents/bot-core/lib/agent-runtime.mjs EMPTY_OPENER_PROMPT, 675f948).
export const EMPTY_OPENER_PROMPT = 'A new contact just opened a chat with you and said nothing yet. Greet them in one or two sentences in your persona.';

/** pca's command shape (lib/commands.mjs COMMAND_RE): `/word` and at most one argument. */
const COMMAND_RE = /^\/([a-z][a-z0-9_-]*)(?:\s+(\S+))?\s*$/i;

/** The text of a buttons message that came with no words of its own. */
export const EMPTY_BUTTONS_TEXT = 'Choose one:';
/** What the operator context says for the model: strangers talk to this agent. */
export const UNDISCLOSED_MODEL = 'not disclosed';
export const NO_ANSWER_TEXT = '(no answer)';
export const FAILED_TEXT = 'Sorry, I could not answer just now. Please try again in a moment.';

/** Turns kept per peer (user and agent messages), and peers kept. */
export const HISTORY_TURNS = 20;
export const HISTORY_PEERS = 200;

export type AgentEngineInfo = { id: string; label: string; model: string | null; tools: boolean };

export type AgentTurn = {
  prompt: string;
  history: Turn[];
  systemPrompt: string;
  directives: readonly DirectiveKind[];
  sessionId?: string;
  signal: AbortSignal;
};

export type AgentBrainDeps = {
  /** The agent's own username (`shawnbot.01`). */
  username: () => string;
  /** The person's username, when this app has one. */
  owner: () => string | null;
  engine: () => AgentEngineInfo;
  run: (turn: AgentTurn) => Promise<EngineRunResult>;
  log?: (kind: string, text: string) => void;
};

export type AgentReply = { text: string; engine: boolean };

export type AgentBrain = {
  /** The reply to one message from `peer`, or null when a `/stop` ended the turn. */
  answer: (peer: string, text: string) => Promise<AgentReply | null>;
  /** `/stop`: aborts `peer`'s running turn. True when one was running. */
  stop: (peer: string) => boolean;
  /** Aborts every running turn (the kill switch). */
  stopAll: () => void;
  isCommand: (text: string, name: string) => boolean;
};

export const systemPromptFor = ({ username, owner, engine }: { username: string; owner: string | null; engine: AgentEngineInfo }): string =>
  [
    ASSISTANT_PERSONA,
    `You are also published on chain as ${username}${owner ? `, the agent of ${owner}` : ''}: people message you from their own Polkadot apps, and you answer them from this computer.`,
    buildOperatorContext({
      username,
      transport: 'polkadot-app',
      policy: { capabilities: [] },
      // Not the model's name: the model would repeat it to a stranger who asks (/about hides it too).
      model: UNDISCLOSED_MODEL,
      modelPolicy: [],
      commands: AGENT_COMMANDS.map(command => ({ command: `/${command.name}`, meaning: command.description })),
      // With tools the buttons come as a tool call; the fenced wording is for text-only engines.
      buttons: !engine.tools,
    }),
    BUTTON_LABELS_HINT,
  ].join('\n');

export const createAgentBrain = (deps: AgentBrainDeps): AgentBrain => {
  const log = deps.log ?? (() => undefined);
  const histories = new Map<string, Turn[]>();
  const sessions = new Map<string, { engine: string; sessionId: string }>();
  const running = new Map<string, AbortController>();

  const remember = (peer: string, turns: Turn[]) => {
    const kept = [...(histories.get(peer) ?? []), ...turns].slice(-HISTORY_TURNS);
    histories.delete(peer);
    histories.set(peer, kept);
    while (histories.size > HISTORY_PEERS) histories.delete(histories.keys().next().value as string);
  };

  const commandReply = (name: string): string => {
    const username = deps.username();
    const owner = deps.owner();
    switch (name) {
      case 'help':
        return ['Commands:', ...AGENT_COMMANDS.filter(c => c.name !== 'help').map(c => `/${c.name} — ${c.description.toLowerCase()}`)].join('\n');
      case 'about':
        // The engine kind only: strangers read this, and the model name is the owner's business.
        return `I am ${username}, ${owner ? `the agent of ${owner}` : 'an agent'}: an AI assistant run from a Polkadot Chat desktop while that app runs. I cannot act on chain for you: a transaction I offer is signed in your own app.`;
      case 'stop':
        return 'Nothing is running.';
      default:
        return `I don't know /${name}. Try /help to see what I can do.`;
    }
  };

  const runTurn = async (peer: string, prompt: string, opener: boolean): Promise<AgentReply | null> => {
    const engine = deps.engine();
    const controller = new AbortController();
    running.get(peer)?.abort();
    running.set(peer, controller);
    const session = sessions.get(peer);
    const directives: DirectiveKind[] = engine.tools ? ['buttons', 'tx'] : [];
    try {
      const result = await deps.run({
        prompt,
        history: histories.get(peer) ?? [],
        systemPrompt: systemPromptFor({ username: deps.username(), owner: deps.owner(), engine }),
        directives,
        ...(session && session.engine === engine.id ? { sessionId: session.sessionId } : {}),
        signal: controller.signal,
      });
      if (result.directiveInvalid?.length) log('tool', `dropped: ${result.directiveInvalid.join('; ')}`);
      if (result.sessionId) sessions.set(peer, { engine: engine.id, sessionId: result.sessionId });
      const words = result.text.trim();
      const directive = result.directive ?? null;
      const text = withDirectiveBlock(words || (directive ? EMPTY_BUTTONS_TEXT : NO_ANSWER_TEXT), directive);
      remember(peer, [...(opener ? [] : [{ role: 'user' as const, content: prompt }]), { role: 'assistant', content: words || text }]);
      return { text, engine: true };
    } catch (cause) {
      if (controller.signal.aborted) return null;
      log('error', cause instanceof Error ? cause.message : String(cause));
      return { text: FAILED_TEXT, engine: false };
    } finally {
      if (running.get(peer) === controller) running.delete(peer);
    }
  };

  return {
    answer: async (peer, text) => {
      const trimmed = text.trim();
      const command = COMMAND_RE.exec(trimmed);
      if (command) return { text: commandReply((command[1] as string).toLowerCase()), engine: false };
      if (!trimmed) return runTurn(peer, EMPTY_OPENER_PROMPT, true);
      return runTurn(peer, trimmed, false);
    },
    stop: peer => {
      const controller = running.get(peer);
      if (!controller) return false;
      controller.abort();
      running.delete(peer);
      return true;
    },
    stopAll: () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
    isCommand: (text, name) => {
      const command = COMMAND_RE.exec(text.trim());
      return command?.[1]?.toLowerCase() === name;
    },
  };
};
