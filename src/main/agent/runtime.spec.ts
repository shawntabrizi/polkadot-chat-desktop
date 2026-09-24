import { describe, expect, it, vi } from 'vitest';

import { createAgentBrain } from './brain';
import type { AgentLimits, AgentUsage } from './guard';
import { type BotProcess, LOG_CAP, createAgentRuntime } from './runtime';

const friend = 'aa'.repeat(32);
const stranger = 'bb'.repeat(32);

/** bot-core's bridge, faked: queued deliveries, and a record of /send and /inbound/ack. */
const fakeBridge = () => {
  const queue: object[] = [];
  const sent: { chat_id: string; text: string }[] = [];
  const acked: string[] = [];
  let lines: ((line: string) => void) | null = null;
  let killed = false;
  const proc: BotProcess = {
    onLine: listener => (lines = listener),
    onExit: () => undefined,
    kill: () => (killed = true),
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === '/inbound') {
      const items = queue.splice(0);
      if (items.length === 0) await new Promise(done => setTimeout(done, 5));
      return Response.json(items);
    }
    if (path === '/send') sent.push(body);
    if (path === '/inbound/ack') acked.push(body.delivery_id);
    return Response.json({ success: true });
  }) as typeof fetch;
  let n = 0;
  return {
    proc,
    fetchImpl,
    sent,
    acked,
    killed: () => killed,
    emit: (event: object) => lines?.(JSON.stringify(event)),
    deliver: (chat_id: string, text: string) => queue.push({ delivery_id: `d${++n}`, lease_id: `l${n}`, chat_id, text }),
  };
};

const setup = (limits: Partial<AgentLimits> = {}, usage: AgentUsage = { day: '', replies: 0 }) => {
  const bridge = fakeBridge();
  let stored = usage;
  const engineCalls: string[] = [];
  const brain = createAgentBrain({
    username: () => 'shawnbot.01',
    owner: () => 'shawn.42',
    engine: () => ({ id: 'proxy', label: 'Proxy', model: 'm', tools: true }),
    run: async turn => (engineCalls.push(turn.prompt), { text: `answer to ${turn.prompt}` }),
  });
  const envs: Record<string, string>[] = [];
  const runtime = createAgentRuntime({
    spawn: env => (envs.push(env), bridge.proc),
    brain,
    limits: () => ({ audience: 'contacts', contacts: [friend], dailyCap: 200, cooldownMs: 0, ...limits }),
    usage: { get: () => stored, set: next => (stored = next) },
    fetch: bridge.fetchImpl,
    randomToken: () => 't'.repeat(64),
  });
  runtime.start({ BOT_USERNAME: 'shawnbot.01' });
  bridge.emit({ event: 'BOT_BRIDGE_LISTENING', port: 4242 });
  return { bridge, runtime, engineCalls, envs, usage: () => stored };
};

describe('the agent runtime (M13)', () => {
  it('starts bot-core as a bridge brain with a fresh token, and answers one message with one send', async () => {
    const { bridge, runtime, envs, engineCalls } = setup();
    expect(envs[0]).toMatchObject({ BOT_BRAIN: 'bridge', BOT_BRIDGE_HOST: '127.0.0.1', BOT_BRIDGE_PORT: '0', BOT_BRIDGE_TOKEN: 't'.repeat(64) });
    bridge.deliver(friend, 'hello');
    await vi.waitFor(() => expect(bridge.acked).toEqual(['d1']));
    expect(bridge.sent).toEqual([{ chat_id: friend, text: 'answer to hello' }]);
    expect(engineCalls).toEqual(['hello']);
    expect(runtime.stats().replies).toBe(1);
    runtime.stop();
  });

  // The cap is the owner's spending limit: over it, nothing goes out and no
  // engine runs, but the delivery is acknowledged so bot-core does not resend it.
  it('the daily cap stops replies', async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const { bridge, runtime, engineCalls } = setup({ dailyCap: 1 }, { day, replies: 1 });
    bridge.deliver(friend, 'one more?');
    await vi.waitFor(() => expect(bridge.acked).toEqual(['d1']));
    expect(bridge.sent).toEqual([]);
    expect(engineCalls).toEqual([]);
    expect(runtime.log().at(-1)?.text).toContain('Daily cap reached');
    runtime.stop();
  });

  it('the allowlist refuses strangers even when a message reaches the bridge', async () => {
    const { bridge, runtime, engineCalls } = setup();
    bridge.deliver(stranger, 'hi');
    await vi.waitFor(() => expect(bridge.acked).toEqual(['d1']));
    expect(bridge.sent).toEqual([]);
    expect(engineCalls).toEqual([]);
    runtime.stop();
  });

  it('counts bot-core\'s submissions per peer from its log', () => {
    const { bridge, runtime } = setup();
    bridge.emit({ event: 'BOT_OUTBOUND_SUBMITTED', to: friend, messages: 2 });
    bridge.emit({ event: 'BOT_OUTBOUND_EXTENDED', to: friend, messages: 3 });
    expect(runtime.stats().perPeer[friend]).toEqual({ replies: 0, submissions: 2 });
    runtime.stop();
  });

  it('keeps only the last 100 log lines', () => {
    const { runtime } = setup();
    for (let i = 0; i < LOG_CAP + 20; i++) runtime.note('info', `line ${i}`);
    expect(runtime.log()).toHaveLength(LOG_CAP);
    expect(runtime.log().at(-1)?.text).toBe(`line ${LOG_CAP + 19}`);
    runtime.stop();
  });

  // The kill switch must end the process, not only the polling.
  it('the kill switch kills bot-core', () => {
    const { bridge, runtime } = setup();
    runtime.stop({ kill: true });
    expect(bridge.killed()).toBe(true);
    expect(runtime.state()).toBe('stopped');
    expect(runtime.log().at(-1)?.text).toBe('Stopped by the kill switch');
  });
});
