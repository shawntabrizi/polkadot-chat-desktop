/**
 * M13: runs the published agent. pca bot-core (`polkadot-chat-agents`,
 * pinned at 675f948) runs as a child process in bridge mode and owns the
 * chat protocol: requests and the allowlist, accept + botInfo in one
 * statement, the identifier-key retry for new senders, seen riding the reply,
 * no typing, per-peer outbound lanes, the buttons block → spec 0006. This
 * module is the harness on the other side of its HTTP bridge: it takes each
 * message, applies the guard rails (guard.ts), asks the brain (brain.ts),
 * posts the answer, and acknowledges the delivery. It also turns bot-core's
 * JSON log lines into the Settings › Agent log and counts submissions.
 * No `electron` import: the process is spawned through `deps.spawn`.
 */

import type { AgentLogEntry, AgentStatus } from '../../shared/desktop-api';

import type { AgentBrain } from './brain';
import { type AgentLimits, type AgentUsage, countReply, decide } from './guard';

export type { AgentLogEntry };

export const LOG_CAP = 100;

/** The running child: its stdout lines, its end, and a way to stop it. */
export type BotProcess = {
  onLine: (listener: (line: string) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  kill: () => void;
};

export type AgentRuntimeState = AgentStatus['state'];

/** What the e2e and Settings read: replies and bot-core submissions, per peer too. */
export type AgentStats = AgentStatus['stats'];

export type AgentRuntimeDeps = {
  spawn: (env: Record<string, string>) => BotProcess;
  brain: AgentBrain;
  limits: () => AgentLimits;
  usage: { get: () => AgentUsage; set: (usage: AgentUsage) => void };
  /** Every change of the log, the state or the stats. */
  onChange?: () => void;
  fetch?: typeof fetch;
  now?: () => number;
  randomToken?: () => string;
};

export type AgentRuntime = {
  /** Starts bot-core with `env` (seed, username, network, state dir, allowlist). */
  start: (env: Record<string, string>) => void;
  /** Stops it. `kill`: the kill switch; running engine turns are aborted too. */
  stop: (options?: { kill?: boolean; reason?: string }) => void;
  state: () => AgentRuntimeState;
  log: () => AgentLogEntry[];
  stats: () => AgentStats;
  note: (kind: AgentLogEntry['kind'], text: string) => void;
};

/** An inbound delivery from bot-core's bridge (GET /inbound). */
type Delivery = { delivery_id: string; lease_id: string; chat_id: string; text?: string; kind?: string };

const POLL_WAIT_S = 25;
const RETRY_MS = 2_000;

export const shortPeer = (hex: string): string => {
  const clean = hex.replace(/^0x/, '');
  return `0x${clean.slice(0, 6)}…${clean.slice(-4)}`;
};

/** bot-core's JSON log line → a Settings log line, or null for the ones a person does not need. */
export const logLineOf = (event: Record<string, unknown>): Pick<AgentLogEntry, 'kind' | 'text'> | null => {
  const peer = (key: string): string => (typeof event[key] === 'string' ? shortPeer(event[key] as string) : 'someone');
  switch (event.event) {
    case 'BOT_STARTING':
      return { kind: 'info', text: `Starting as ${String(event.username ?? '')}` };
    case 'BOT_BRIDGE_LISTENING':
      return { kind: 'info', text: 'Running' };
    case 'BOT_RECEIVED_OPENER':
      return { kind: 'in', text: `Accepted a chat request from ${peer('from')}` };
    case 'BOT_REJECTED_UNLISTED':
      return { kind: 'refused', text: `Refused a chat request from ${peer('from')}: not a contact` };
    case 'BOT_OPENER_WAITING_IDENTIFIER':
      return { kind: 'info', text: `Waiting for the key of ${peer('from')} on chain` };
    case 'BOT_SENT_BOTINFO':
      return { kind: 'out', text: `Sent the bot info to ${peer('to')} (${String(event.on ?? '')})` };
    case 'BOT_OUTBOUND_SUBMITTED':
    case 'BOT_OUTBOUND_EXTENDED':
      return { kind: 'out', text: `Submitted 1 statement to ${peer('to')} (${String(event.messages ?? 1)} message${event.messages === 1 ? '' : 's'})` };
    case 'BOT_BUTTONS_INVALID':
      return { kind: 'error', text: `Dropped invalid buttons for ${peer('to')}` };
    default:
      return typeof event.event === 'string' && /FAILED|ERROR/.test(event.event) ? { kind: 'error', text: `${event.event}${typeof event.error === 'string' ? `: ${event.error}` : ''}` } : null;
  }
};

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(done => {
    if (signal.aborted) return done();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true });
  });

const defaultToken = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

export const createAgentRuntime = (deps: AgentRuntimeDeps): AgentRuntime => {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const entries: AgentLogEntry[] = [];
  let state: AgentRuntimeState = 'stopped';
  let child: BotProcess | null = null;
  let session: AbortController | null = null;
  const stats: AgentStats = { replies: 0, submissions: 0, perPeer: {} };
  const lastReplyAt = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();

  const changed = () => deps.onChange?.();
  const note = (kind: AgentLogEntry['kind'], text: string) => {
    entries.push({ at: now(), kind, text });
    if (entries.length > LOG_CAP) entries.splice(0, entries.length - LOG_CAP);
    changed();
  };
  const peerStats = (peer: string) => (stats.perPeer[peer.toLowerCase().replace(/^0x/, '')] ??= { replies: 0, submissions: 0 });

  const onLine = (line: string, ready: (port: number) => void) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.event === 'BOT_BRIDGE_LISTENING' && typeof event.port === 'number') ready(event.port);
    if ((event.event === 'BOT_OUTBOUND_SUBMITTED' || event.event === 'BOT_OUTBOUND_EXTENDED') && typeof event.to === 'string') {
      stats.submissions += 1;
      peerStats(event.to).submissions += 1;
    }
    const entry = logLineOf(event);
    if (entry) note(entry.kind, entry.text);
    else changed();
  };

  const run = (env: Record<string, string>, signal: AbortSignal) => {
    const token = (deps.randomToken ?? defaultToken)();
    const proc = deps.spawn({ ...env, BOT_BRAIN: 'bridge', BOT_BRIDGE_HOST: '127.0.0.1', BOT_BRIDGE_PORT: '0', BOT_BRIDGE_TOKEN: token });
    child = proc;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let base = '';
    const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
      const response = await fetchImpl(`${base}${path}`, { ...init, headers, signal });
      if (!response.ok) throw new Error(`bot-core answered HTTP ${response.status} on ${path}`);
      return response.json();
    };
    const ack = (delivery: Delivery) =>
      call('/inbound/ack', { method: 'POST', body: JSON.stringify({ delivery_id: delivery.delivery_id, lease_id: delivery.lease_id }) }).catch((cause: unknown) =>
        note('error', `Acknowledge failed: ${cause instanceof Error ? cause.message : String(cause)}`),
      );
    const send = async (peer: string, text: string): Promise<void> => {
      await call('/send', { method: 'POST', body: JSON.stringify({ chat_id: peer, text }) });
      deps.usage.set(countReply(deps.usage.get(), now()));
      lastReplyAt.set(peer, now());
      stats.replies += 1;
      peerStats(peer).replies += 1;
    };

    const handle = async (delivery: Delivery): Promise<void> => {
      const peer = delivery.chat_id;
      const text = delivery.text ?? '';
      const decision = decide(peer, { limits: deps.limits(), usage: deps.usage.get(), lastReplyAt: lastReplyAt.get(peer), now: now() });
      if (!decision.reply) {
        note('refused', decision.reason === 'cap' ? `Daily cap reached: no reply to ${shortPeer(peer)}` : `No reply to ${shortPeer(peer)}: not a contact`);
        return void (await ack(delivery));
      }
      note('in', text.trim() ? `Message from ${shortPeer(peer)}` : `New chat from ${shortPeer(peer)}`);
      if (decision.waitMs > 0) {
        note('info', `Cooldown: waiting ${Math.ceil(decision.waitMs / 1000)} s for ${shortPeer(peer)}`);
        await delay(decision.waitMs, signal);
      }
      if (signal.aborted) return;
      const reply = await deps.brain.answer(peer, text);
      if (signal.aborted) return;
      if (reply) {
        try {
          await send(peer, reply.text);
          note('out', `Replied to ${shortPeer(peer)}${reply.engine ? '' : ' (from the app)'}`);
        } catch (cause) {
          note('error', `Reply to ${shortPeer(peer)} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      await ack(delivery);
    };

    const dispatch = (delivery: Delivery) => {
      const peer = delivery.chat_id;
      // `/stop` must not wait behind the turn it stops.
      if (deps.brain.isCommand(delivery.text ?? '', 'stop')) {
        const stopped = deps.brain.stop(peer);
        const decision = decide(peer, { limits: deps.limits(), usage: deps.usage.get(), lastReplyAt: undefined, now: now() });
        if (!decision.reply) {
          note('refused', `No reply to /stop from ${shortPeer(peer)}: ${decision.reason === 'cap' ? 'daily cap reached' : 'not a contact'}`);
          void ack(delivery);
          return;
        }
        void send(peer, stopped ? 'Stopped.' : 'Nothing is running.')
          .then(() => note('out', `Stopped the turn of ${shortPeer(peer)}`))
          .catch((cause: unknown) => note('error', `Reply to ${shortPeer(peer)} failed: ${cause instanceof Error ? cause.message : String(cause)}`))
          .then(() => ack(delivery));
        return;
      }
      const next = (queues.get(peer) ?? Promise.resolve()).then(() => handle(delivery)).catch((cause: unknown) => note('error', String(cause)));
      queues.set(peer, next);
      void next.then(() => {
        if (queues.get(peer) === next) queues.delete(peer);
      });
    };

    const poll = async () => {
      while (!signal.aborted) {
        try {
          const items = (await call(`/inbound?wait=${POLL_WAIT_S}`)) as Delivery[];
          for (const item of Array.isArray(items) ? items : []) if (typeof item?.chat_id === 'string' && typeof item.delivery_id === 'string') dispatch(item);
        } catch (cause) {
          if (signal.aborted) return;
          note('error', `Bridge: ${cause instanceof Error ? cause.message : String(cause)}`);
          await delay(RETRY_MS, signal);
        }
      }
    };

    proc.onLine(line =>
      onLine(line, port => {
        if (base) return;
        base = `http://127.0.0.1:${port}`;
        state = 'running';
        changed();
        void poll();
      }),
    );
    proc.onExit(code => {
      if (child !== proc) return;
      child = null;
      if (signal.aborted) return;
      session?.abort();
      state = 'failed';
      note('error', `The agent process ended (exit code ${code ?? 'none'}). Turn "Publish my agent" off and on to start it again.`);
    });
  };

  return {
    start: env => {
      if (state === 'starting' || state === 'running') return;
      session = new AbortController();
      state = 'starting';
      changed();
      run(env, session.signal);
    },
    stop: ({ kill = false, reason } = {}) => {
      session?.abort();
      session = null;
      if (kill) deps.brain.stopAll();
      const proc = child;
      child = null;
      proc?.kill();
      if (state !== 'stopped') {
        state = 'stopped';
        note('info', reason ?? (kill ? 'Stopped by the kill switch' : 'Stopped'));
      }
    },
    state: () => state,
    log: () => [...entries],
    stats: () => structuredClone(stats),
    note,
  };
};
