/**
 * M13 "Publish my agent": the Electron side. It keeps the agent's own
 * identity (a second identity of this app, its mnemonic encrypted with
 * `safeStorage` in `<userData>/agent/identity.json`, never the person's key),
 * its settings (`<userData>/agent/settings.json`), and runs bot-core in an
 * Electron utility process while the toggle is on.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { app, utilityProcess } from 'electron';

import type { AgentStatus, AgentSettingsUpdate, ClaimAgentRequest, CreateIdentityResponse } from '../../shared/desktop-api';
import type { NetworkProfileId } from '../../shared/network';
import { ENGINES } from '../assistant/engines';
import { assistantConfig } from '../assistant/settings';
import { createToolPolicy } from '../assistant/toolPolicy';
import { type PeopleDirectory, openPeopleDirectory } from '../identity/directory';
import { bytesToHex } from '../identity/keys';
import { createIdentity } from '../identity/service';
import { loadIdentity, loadIdentityAt, saveIdentityAt } from '../identity/store';

import { createAttestationGate } from './attestation';
import { AGENT_COMMANDS, createAgentBrain } from './brain';
import { type AgentAudience, type AgentUsage, DEFAULT_COOLDOWN_MS, DEFAULT_DAILY_CAP, allowedPeersEnv, clampLimits, repliesLeft } from './guard';
import { type BotProcess, createAgentRuntime } from './runtime';

type SettingsFile = {
  version: 1;
  enabled: boolean;
  audience: AgentAudience;
  dailyCap: number;
  cooldownMs: number;
  /** The person's contacts (0x-hex accounts) as the renderer last reported them. */
  contacts: string[];
  usage: AgentUsage;
};

const DEFAULTS: SettingsFile = { version: 1, enabled: false, audience: 'contacts', dailyCap: DEFAULT_DAILY_CAP, cooldownMs: DEFAULT_COOLDOWN_MS, contacts: [], usage: { day: '', replies: 0 } };

const agentDir = (): string => {
  const dir = join(app.getPath('userData'), 'agent');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};
/** M18: bot-core's state (journal, lanes, sessions) lives in this profile's folder, so two profiles' agents never share it. */
export const agentStateDir = (): string => join(agentDir(), 'bot-core');
const identityPath = (): string => join(agentDir(), 'identity.json');
const settingsPath = (): string => join(agentDir(), 'settings.json');

const readSettings = (): SettingsFile => {
  if (!existsSync(settingsPath())) return DEFAULTS;
  try {
    const value = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<SettingsFile>;
    const limits = clampLimits(value);
    return {
      version: 1,
      enabled: value.enabled === true,
      audience: value.audience === 'anyone' ? 'anyone' : 'contacts',
      ...limits,
      contacts: Array.isArray(value.contacts) ? value.contacts.filter((entry): entry is string => typeof entry === 'string') : [],
      usage: typeof value.usage?.day === 'string' && typeof value.usage.replies === 'number' ? value.usage : DEFAULTS.usage,
    };
  } catch {
    return DEFAULTS;
  }
};

const writeSettings = (file: SettingsFile): void => {
  const tmp = `${settingsPath()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, settingsPath());
};

const updateSettingsFile = (change: Partial<SettingsFile>): SettingsFile => {
  const next = { ...readSettings(), ...change };
  writeSettings(next);
  return next;
};

/** bot-core's entry file inside the installed `polkadot-chat-agents` package. */
const botCoreEntry = (): string => createRequire(import.meta.url).resolve('polkadot-chat-agents/index.mjs');

/**
 * bot-core in an Electron utility process: Node inside this app, no second
 * runtime to install. The entry is agent-host.js (host.ts), which gives
 * Electron's `node:crypto` the cipher bot-core needs before it loads it.
 */
const spawnBotCore = (env: Record<string, string>): BotProcess => {
  const child = utilityProcess.fork(join(import.meta.dirname, 'agent-host.js'), [], {
    env: { ...env, PCD_BOT_CORE_ENTRY: botCoreEntry() },
    stdio: 'pipe',
    serviceName: 'Polkadot Chat agent',
  });
  const lineListeners: ((line: string) => void)[] = [];
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) for (const listener of lineListeners) listener(line);
  });
  // bot-core writes its configuration errors to stderr; they go to the log as they are (no secret is printed there).
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      for (const listener of lineListeners) listener(JSON.stringify({ event: 'BOT_STDERR_ERROR', error: line.slice(0, 300) }));
    }
  });
  return {
    onLine: listener => lineListeners.push(listener),
    onExit: listener => child.once('exit', code => listener(code)),
    kill: () => child.kill(),
  };
};

const SELFTEST_MS = 30_000;

/**
 * `--agent-selftest` (smoke-packaged.sh): starts bot-core in the utility
 * process exactly as the agent does, with a throwaway random key and state
 * folder, and waits for its BOT_STARTING line. bot-core logs it after its
 * whole module graph (nested node_modules, inside app.asar when packaged)
 * has loaded and its settings and keys are read, and before any network
 * call. Resolves with the exit code; prints AGENT_SELFTEST_OK or _FAIL.
 */
export const runAgentSelftest = (): Promise<number> =>
  new Promise(done => {
    const dir = mkdtempSync(join(app.getPath('userData'), 'agent-selftest-'));
    const entry = botCoreEntry();
    let finished = false;
    const proc = spawnBotCore({
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      BOT_BRAIN: 'bridge',
      BOT_BRIDGE_HOST: '127.0.0.1',
      BOT_BRIDGE_PORT: '0',
      BOT_BRIDGE_TOKEN: randomBytes(32).toString('hex'),
      // A key made for this run only: nothing is registered or sent with it.
      BOT_SEED_HEX: randomBytes(32).toString('hex'),
      BOT_USERNAME: 'selftest',
      BOT_STATE_DIR: join(dir, 'bot-core'),
      BOT_AI_CONTEXT: '0',
      PCA_METADATA_CACHE_DIR: join(dir, 'metadata'),
      BOT_ALLOWED_PEERS: '00'.repeat(32),
    });
    const finish = (code: number, line: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.log(line);
      proc.kill();
      rmSync(dir, { recursive: true, force: true });
      done(code);
    };
    const timer = setTimeout(() => finish(1, 'AGENT_SELFTEST_FAIL no BOT_STARTING in 30 s'), SELFTEST_MS);
    proc.onLine(line => {
      if (line.includes('"BOT_STARTING"')) finish(0, `AGENT_SELFTEST_OK bot-core started from ${entry}`);
      else if (line.includes('"BOT_STDERR_ERROR"')) console.log(`agent stderr: ${line}`);
    });
    proc.onExit(code => finish(1, `AGENT_SELFTEST_FAIL the utility process ended (code ${code})`));
  });

export type AgentService = {
  status: () => AgentStatus;
  claim: (request: ClaimAgentRequest, onProgress: (line: string) => void) => Promise<CreateIdentityResponse>;
  update: (change: AgentSettingsUpdate) => AgentStatus;
  setContacts: (accounts: string[]) => void;
  kill: () => AgentStatus;
  /** Starts the runtime when the toggle was left on (app start). */
  resume: () => void;
  shutdown: () => void;
};

export const createAgentService = (onChange: (status: AgentStatus) => void): AgentService => {
  let claiming = false;
  const identity = () => loadIdentityAt(identityPath());
  let status: () => AgentStatus = () => {
    throw new Error('not ready');
  };

  const engineInfo = () => {
    const config = assistantConfig();
    const engine = ENGINES[config.engine];
    return { id: engine.id, label: engine.label, model: engine.id === 'proxy' ? config.model : null, tools: engine.id === 'proxy' };
  };

  const brain = createAgentBrain({
    username: () => identity()?.username ?? 'agent',
    owner: () => loadIdentity()?.username ?? null,
    engine: engineInfo,
    run: turn => {
      const config = assistantConfig();
      const engine = ENGINES[config.engine];
      // A CLI engine runs in the agent's own empty folder, never with tools: strangers talk to it.
      const workspace = join(agentDir(), 'engine-workspace');
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      return engine.run({
        ...turn,
        onDelta: () => undefined,
        onEvent: () => undefined,
        workspace: realpathSync(workspace),
        policy: createToolPolicy({ capabilities: [] }),
        model: config.model,
        baseUrl: config.baseUrl,
        key: config.key,
      });
    },
    log: (kind, text) => runtime.note(kind === 'error' ? 'error' : 'info', text),
  });

  const runtime = createAgentRuntime({
    spawn: spawnBotCore,
    brain,
    limits: () => {
      const file = readSettings();
      const own = loadIdentity()?.accountHex;
      return { audience: file.audience, contacts: own ? [...file.contacts, own] : file.contacts, dailyCap: file.dailyCap, cooldownMs: file.cooldownMs };
    },
    usage: { get: () => readSettings().usage, set: usage => void updateSettingsFile({ usage }) },
    onChange: () => onChange(status()),
  });

  /** The allowlist bot-core was started with, so a contact change restarts it only when the list changed. */
  let startedAllowlist: string | null | undefined;

  const launch = () => {
    const agent = identity();
    const file = readSettings();
    if (!agent || !file.enabled) return;
    const own = loadIdentity()?.accountHex;
    const allowlist = allowedPeersEnv({ audience: file.audience, contacts: own ? [...file.contacts, own] : file.contacts });
    const dir = agentDir();
    const stateDir = agentStateDir();
    const workspace = join(stateDir, 'workspace');
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    // Spec 0008: bot-core reads its botInfo from this file for every send.
    writeFileSync(
      join(workspace, 'botinfo.json'),
      `${JSON.stringify(
        {
          kind: 1,
          name: agent.username,
          description: `${loadIdentity()?.username ?? 'A person'}'s agent on Polkadot Chat Desktop`.slice(0, 280),
          greeting: 'Hi! Ask me anything, or type / for my commands.',
          commands: AGENT_COMMANDS,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const env: Record<string, string> = {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      BOT_SEED_HEX: bytesToHex(mnemonicToMiniSecret(agent.mnemonic)).slice(2),
      BOT_USERNAME: agent.username,
      BOT_NETWORK_PROFILE: agent.profile satisfies NetworkProfileId,
      BOT_STATE_DIR: stateDir,
      BOT_AI_WORKSPACE: workspace,
      // The greeting comes from the brain in the Assistant's persona, not a fixed "Connecting you…"
      // (an empty BOT_ACK_TEXT; host.ts sets it, a utility process drops empty values).
      PCD_EMPTY_ENV: 'BOT_ACK_TEXT',
      // This app writes the operator context itself (brain.ts), with its own commands.
      BOT_AI_CONTEXT: '0',
      PCA_METADATA_CACHE_DIR: join(dir, 'metadata'),
      ...(allowlist ? { BOT_ALLOWED_PEERS: allowlist } : {}),
    };
    startedAllowlist = allowlist;
    runtime.start(env);
  };

  // One People connection per wait, opened at the first check and closed when the wait ends.
  let directory: Promise<PeopleDirectory> | null = null;
  const closeDirectory = () => {
    const open = directory;
    directory = null;
    void open?.then(d => d.destroy()).catch(() => undefined);
  };
  /** An account seen attested in this app run: an attestation is not taken back, so a restart does not read again. */
  let attestedAccount: string | null = null;
  const gate = createAttestationGate({
    isAttested: async () => {
      const agent = identity();
      if (!agent) return false;
      directory ??= openPeopleDirectory(agent.profile);
      try {
        return (await (await directory).identifierKeyFor(agent.accountHex)) != null;
      } catch (cause) {
        closeDirectory();
        throw cause;
      }
    },
    onAttested: () => {
      attestedAccount = identity()?.accountHex ?? null;
      launch();
    },
    onIdle: closeDirectory,
    onChange: () => onChange(status()),
    note: (kind, text) => runtime.note(kind, text),
  });

  /** Starts bot-core once the agent's attestation is visible at the best block (docs/spec/efficiency.md "Allowance facts"). */
  const start = () => {
    const agent = identity();
    if (!agent || !readSettings().enabled) return;
    if (attestedAccount === agent.accountHex) return launch();
    if (runtime.state() === 'starting' || runtime.state() === 'running') return;
    gate.open();
  };

  status = () => {
    const agent = identity();
    const file = readSettings();
    return {
      identity: agent ? { username: agent.username, accountHex: agent.accountHex, profile: agent.profile } : null,
      enabled: file.enabled,
      audience: file.audience,
      dailyCap: file.dailyCap,
      cooldownSeconds: Math.round(file.cooldownMs / 1000),
      state: runtime.state(),
      attestation: gate.state(),
      repliesLeft: repliesLeft(file.usage, file.dailyCap, Date.now()),
      stats: runtime.stats(),
      log: runtime.log(),
    };
  };

  const restart = () => {
    gate.cancel();
    runtime.stop({ reason: 'Restarting with the new settings' });
    start();
  };

  return {
    status: () => status(),
    claim: async (request, onProgress) => {
      if (claiming) throw new Error('A claim is already running.');
      if (identity()) throw new Error('The agent already has a username.');
      const person = loadIdentity();
      claiming = true;
      try {
        const result = await createIdentity({
          ...request,
          profile: person?.profile ?? request.profile,
          store: { save: stored => saveIdentityAt(identityPath(), stored), load: () => loadIdentityAt(identityPath()) },
          onProgress,
        });
        // A fresh mnemonic cannot give the person's account; checked anyway, because reusing the chat key is the one thing this must never do.
        if (person && result.accountHex.toLowerCase() === person.accountHex.toLowerCase()) throw new Error('The agent key equals the person key.');
        updateSettingsFile({ enabled: true });
        start();
        onChange(status());
        return result;
      } finally {
        claiming = false;
      }
    },
    update: change => {
      const before = readSettings();
      const limits = clampLimits({ dailyCap: change.dailyCap ?? before.dailyCap, cooldownMs: change.cooldownSeconds !== undefined ? change.cooldownSeconds * 1000 : before.cooldownMs });
      const next = updateSettingsFile({ ...(change.enabled !== undefined ? { enabled: change.enabled } : {}), ...(change.audience ? { audience: change.audience } : {}), ...limits });
      if (!next.enabled) {
        gate.cancel();
        runtime.stop();
      }
      else if (!before.enabled || before.audience !== next.audience || runtime.state() === 'failed') restart();
      const current = status();
      onChange(current);
      return current;
    },
    setContacts: accounts => {
      const file = readSettings();
      const next = [...new Set(accounts.map(account => account.toLowerCase()))].sort();
      if (JSON.stringify(next) === JSON.stringify([...file.contacts].sort())) return;
      updateSettingsFile({ contacts: next });
      const own = loadIdentity()?.accountHex;
      const allowlist = allowedPeersEnv({ audience: file.audience, contacts: own ? [...next, own] : next });
      if (file.enabled && runtime.state() !== 'stopped' && allowlist !== startedAllowlist) restart();
    },
    kill: () => {
      updateSettingsFile({ enabled: false });
      gate.cancel();
      runtime.stop({ kill: true });
      const current = status();
      onChange(current);
      return current;
    },
    resume: () => {
      try {
        start();
      } catch (cause) {
        runtime.note('error', `The agent did not start: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    shutdown: () => {
      gate.cancel();
      runtime.stop({ reason: 'The app is closing' });
    },
  };
};
