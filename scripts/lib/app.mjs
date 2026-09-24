// M13: the app under test over the Chrome DevTools protocol, for the e2e
// scripts (the same steps screenshots.mjs takes inline). Every launch is
// headless (PCD_HEADLESS=1) with a throwaway profile (PCD_USER_DATA_DIR):
// the owner's profile is never opened. Prints no secret.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const electronBin = join(root, 'node_modules/.bin/electron');
const sleep = ms => new Promise(done => setTimeout(done, ms));

export const build = () => {
  const run = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (run.status !== 0) throw new Error('build failed');
};

/**
 * Writes `identity.json` into `profile` from a test identity file, the
 * mnemonic encrypted with safeStorage by a tiny Electron script under the dev
 * app name (the keychain entry the app itself uses).
 */
export const seedIdentity = (profile, identityFile) => {
  const seedScript = join(profile, 'seed.mjs');
  writeFileSync(
    seedScript,
    `import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
app.setName('polkadot-chat-desktop');
app.setPath('userData', process.env.SEED_PROFILE);
app.dock?.hide();
app.whenReady().then(() => {
  const src = JSON.parse(readFileSync(process.env.SEED_SOURCE, 'utf8'));
  const file = { version: 1, username: src.username, accountHex: src.accountHex, profile: src.profile,
    mnemonicEncrypted: safeStorage.encryptString(src.mnemonic).toString('base64') };
  writeFileSync(join(process.env.SEED_PROFILE, 'identity.json'), JSON.stringify(file, null, 2) + '\\n', { mode: 0o600 });
  app.exit(0);
});
`,
  );
  const seeded = spawnSync(electronBin, [seedScript], { env: { ...process.env, PCD_HEADLESS: '1', SEED_PROFILE: profile, SEED_SOURCE: resolve(identityFile) }, stdio: 'ignore' });
  rmSync(seedScript);
  if (seeded.status !== 0 || !existsSync(join(profile, 'identity.json'))) throw new Error('seeding the identity failed');
  return JSON.parse(readFileSync(identityFile, 'utf8')).username;
};

/** The Assistant's settings file as Settings writes it (no key stored; tools off). */
export const writeAssistantSettings = (profile, { engine = 'proxy', baseUrl = 'https://llm.substrate.dev', model = 'auto/deepseek-v4.1-flash' } = {}) =>
  writeFileSync(join(profile, 'assistant.json'), `${JSON.stringify({ version: 1, model, baseUrl, keyEncrypted: null, engine, tools: [] }, null, 2)}\n`, { mode: 0o600 });

/**
 * A debugging port no other process listens on. Other agents run their own
 * apps with fixed ports (9335–9337) on this machine; connecting to theirs
 * would drive the wrong app, so the port is picked free and checked again.
 */
const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

export const portAnswers = async port => {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
};

/** A free debugging port, checked again (nothing answers on it). The e2e scripts and screenshots.mjs use it. */
export const debugPort = async () => {
  const port = await freePort();
  if (await portAnswers(port)) throw new Error(`port ${port} is taken`);
  return port;
};

/** The packaged app's binary (npm run package). */
export const packagedBin = join(root, 'dist/mac-arm64/Polkadot Chat.app/Contents/MacOS/Polkadot Chat');

/**
 * Starts the app on `profile` and connects to its page. `env` adds to the
 * environment. `packaged` runs the packaged binary (dist/) instead of the
 * dev build (out/ through node_modules' Electron).
 */
export const launch = async (profile, { env = {}, log = null, packaged = false } = {}) => {
  const port = await debugPort();
  const [bin, args] = packaged ? [packagedBin, []] : [electronBin, ['.']];
  if (packaged && !existsSync(bin)) throw new Error(`no packaged app at ${bin} (run npm run package)`);
  const child = spawn(bin, [...args, `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, ...env, PCD_HEADLESS: '1', PCD_USER_DATA_DIR: profile },
    stdio: ['ignore', log ?? 'ignore', log ?? 'ignore'],
  });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(entry => entry.type === 'page');
    } catch {
      // not listening yet
    }
  }
  if (!target) {
    child.kill('SIGTERM');
    throw new Error('no CDP target');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise(done => {
      const n = ++id;
      pending.set(n, done);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async expression => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return reply.result?.result?.value;
  };
  const waitFor = async (expression, ms = 60_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await evaluate(expression).catch(() => false)) return true;
      await sleep(250);
    }
    return false;
  };
  const quit = async () => {
    ws.close();
    child.kill('SIGTERM');
    await new Promise(done => (child.exitCode !== null ? done() : child.once('exit', done)));
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  return { evaluate, waitFor, send, quit, child };
};
