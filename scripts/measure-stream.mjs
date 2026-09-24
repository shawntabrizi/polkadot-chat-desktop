#!/usr/bin/env node
// M12d step 4: how smoothly a streamed Assistant reply paints.
//   node scripts/measure-stream.mjs [--identity pcdbenchcold] [--no-build] [--cpu-throttle 4]
// A local fake LLM proxy (this script) streams a ~1500-character markdown
// reply that ends in a ```buttons block, 50 deltas per second, into the
// Assistant room of a throwaway profile that already holds 60 messages. The
// engine code is not changed: the profile's assistant.json points the proxy
// engine at 127.0.0.1, with a dummy key (never the real LLM_PROXY_KEY).
// In the renderer (CDP) it counts:
//   LONG_TASKS   Performance API `longtask` entries (> 50 ms) from Send to
//                2.5 s after the stream ended (the reveal is 2 s at most);
//   SLOW_FRAMES  gaps between animation frames over 50 ms, same window;
//   SHRINKS      frames where the reply's painted text got more than 10
//                characters shorter than the frame before (a reveal that
//                restarted at completion); markdown marks that close
//                ("**bold" → "bold") shorten it by a few, which is not one.
// --cpu-throttle N slows the renderer's CPU N times (CDP
// Emulation.setCPUThrottlingRate), for a machine slower than this one.
// Headless (PCD_HEADLESS=1), PCD_USER_DATA_DIR in the temp folder: the
// owner's profiles are never touched. Prints no secret.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { debugPort } from './lib/app.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronBin = join(root, 'node_modules/.bin/electron');
const DELTAS_PER_SECOND = 50;
const ROOM_MESSAGES = 60;
const SHRINK_SLACK = 10;
const arg = name => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const identityName = arg('--identity') ?? 'pcdbenchcold';
const cpuThrottle = Number(arg('--cpu-throttle') ?? 1);
const identitySource = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const t0 = Date.now();
const log = (...parts) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...parts);

if (!existsSync(identitySource)) {
  console.error(`no test identity at ${identitySource}`);
  process.exit(2);
}

// ── The reply: ~1500 characters of markdown, then a buttons block ─────────

const PARAGRAPH =
  'Polkadot runs many chains side by side. The **relay chain** gives them shared security, and each parachain keeps its own logic. ' +
  'Messages move between chains with `XCM`, so an asset can leave one chain and arrive on another without a bridge.';
const REPLY = [
  'Here is a short overview.',
  '',
  PARAGRAPH,
  '',
  '- **People chain**: usernames and identities',
  '- **Asset Hub**: balances, assets and contracts',
  '- **Bulletin**: short-lived data for apps',
  '',
  PARAGRAPH,
  '',
  '```ts',
  "const api = client.getTypedApi(dot);",
  "const account = await api.query.System.Account.getValue(address, { at: 'best' });",
  '```',
  '',
  PARAGRAPH,
  '',
  PARAGRAPH,
  '',
  'Do you want more detail?',
  '',
  '```buttons',
  '{"rows":[[{"label":"Yes","action":{"command":"yes"}},{"label":"No","action":{"command":"no"}}]]}',
  '```',
].join('\n');

// Deltas of 4 to 6 characters, as a proxy streams tokens.
const deltas = [];
for (let at = 0, n = 0; at < REPLY.length; n++) {
  const size = 4 + (n % 3);
  deltas.push(REPLY.slice(at, at + size));
  at += size;
}

let streamStartedAt = 0;
let streamEndedAt = 0;
const server = createServer((request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/v1/chat/completions')) {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  streamStartedAt = Date.now();
  let index = 0;
  const timer = setInterval(() => {
    if (index < deltas.length) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: deltas[index++] } }] })}\n\n`);
      return;
    }
    clearInterval(timer);
    response.write('data: [DONE]\n\n');
    response.end();
    streamEndedAt = Date.now();
  }, 1000 / DELTAS_PER_SECOND);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const proxyUrl = `http://127.0.0.1:${server.address().port}`;
log('fake proxy', proxyUrl, `${deltas.length} deltas, ${REPLY.length} chars`);

// ── Build, profile, identity ─────────────────────────────────────────────

if (!process.argv.includes('--no-build')) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (build.status !== 0) {
    console.error('build failed');
    process.exit(1);
  }
  log('built');
}

const userDataRoot = mkdtempSync(join(tmpdir(), 'pcd-measure-'));
// M19: seed the default profile's folder; the app lists it at its first start.
const profile = join(userDataRoot, 'profiles', 'default');
mkdirSync(profile, { recursive: true, mode: 0o700 });
const headlessEnv = { PCD_HEADLESS: '1' };
// As scripts/screenshots.mjs seeds its identity: encrypted as the app's store does.
const seedScript = join(profile, 'seed.mjs');
writeFileSync(
  seedScript,
  `import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
app.setName('polkadot-chat-desktop');
app.setPath('userData', process.env.SEED_PROFILE);
if (process.env.PCD_HEADLESS === '1') app.dock?.hide();
app.whenReady().then(() => {
  const src = JSON.parse(readFileSync(process.env.SEED_SOURCE, 'utf8'));
  const file = { version: 1, username: src.username, accountHex: src.accountHex, profile: src.profile,
    mnemonicEncrypted: safeStorage.encryptString(src.mnemonic).toString('base64') };
  writeFileSync(join(process.env.SEED_PROFILE, 'identity.json'), JSON.stringify(file, null, 2) + '\\n', { mode: 0o600 });
  app.exit(0);
});
`,
);
const seeded = spawnSync(electronBin, [seedScript], {
  env: { ...process.env, ...headlessEnv, SEED_PROFILE: profile, SEED_SOURCE: identitySource },
  stdio: 'ignore',
});
rmSync(seedScript);
if (seeded.status !== 0 || !existsSync(join(profile, 'identity.json'))) {
  console.error('seeding the identity failed');
  process.exit(1);
}
writeFileSync(
  join(profile, 'assistant.json'),
  `${JSON.stringify({ version: 1, model: 'fake', baseUrl: proxyUrl, keyEncrypted: null, engine: 'proxy', tools: [] }, null, 2)}\n`,
  { mode: 0o600 },
);
log('seeded', JSON.parse(readFileSync(identitySource, 'utf8')).username);

// ── The app over CDP ─────────────────────────────────────────────────────

const env = { ...process.env, ...headlessEnv, PCD_USER_DATA_DIR: userDataRoot, LLM_PROXY_KEY: 'local-fake-proxy' };
// A free port: a fixed one (9337) once drove another agent's app.
const PORT = await debugPort();
const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'] });
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(entry => entry.type === 'page');
  } catch {
    // not listening yet
  }
}
if (!target) throw new Error('no CDP target');
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
    await sleep(100);
  }
  return false;
};

let exitCode = 0;
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (!(await waitFor(`!!document.querySelector('[data-testid=chat-row-assistant]')`, 60_000))) throw new Error('the chat screen did not open');

  // 60 earlier messages in the Assistant room, written straight into IndexedDB.
  const seededRows = await evaluate(`new Promise((done, fail) => {
    const open = indexedDB.open('polkadot-chat-web');
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const start = Date.now() - ${ROOM_MESSAGES} * 60_000;
      for (let i = 0; i < ${ROOM_MESSAGES}; i++) {
        const incoming = i % 2 === 1;
        store.put({
          messageId: 'seed-' + i,
          peerAccountId: 'local:assistant',
          timestamp: start + i * 60_000,
          direction: incoming ? 'incoming' : 'outgoing',
          status: incoming ? 'received' : 'sent',
          content: { type: 'text', text: incoming ? ${JSON.stringify(PARAGRAPH + '\n\n- one **point**\n- `two`')} + ' #' + i : 'Question number ' + i + '?' },
          reactions: [],
          editedAt: null,
        });
      }
      tx.oncomplete = () => { open.result.close(); done(${ROOM_MESSAGES}); };
      tx.onerror = () => fail(tx.error);
    };
  })`);
  log('seeded rows', seededRows);

  await evaluate(`document.querySelector('[data-testid=chat-row-assistant]').click(); true`);
  if (!(await waitFor(`document.querySelectorAll('[data-testid=bubble]').length >= ${ROOM_MESSAGES}`, 20_000))) throw new Error('the room did not show the seeded rows');
  await sleep(1500);
  if (cpuThrottle > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });

  // Collectors: long tasks, frame gaps, and the painted length of the reply.
  await evaluate(`(() => {
    window.__m = { longTasks: [], frames: [], lengths: [], on: true };
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (window.__m.on) window.__m.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
    let last = performance.now();
    const frame = now => {
      if (!window.__m.on) return;
      window.__m.frames.push(now - last);
      last = now;
      const bubbles = document.querySelectorAll('[data-testid=message-incoming] [data-testid=bubble]');
      const reply = bubbles[bubbles.length - 1];
      // Only the reply, once its first words are on screen (not the rows before it, not "Thinking…").
      const text = reply ? reply.textContent : '';
      if (text.startsWith(${JSON.stringify(REPLY.slice(0, 4))})) window.__m.lengths.push(text.length);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return true;
  })()`);

  const textarea = 'textarea[aria-label=Message]';
  await evaluate(`document.querySelector(${JSON.stringify(textarea)}).focus()`);
  await send('Input.insertText', { text: 'Tell me about Polkadot.' });
  await sleep(300);
  await evaluate(`document.querySelector('[aria-label=Send]').click(); true`);
  log('sent');
  for (let i = 0; i < 600 && !streamEndedAt; i++) await sleep(100);
  if (!streamEndedAt) throw new Error('the fake proxy was never asked');
  await sleep(2500);
  const result = await evaluate(`(() => { window.__m.on = false; return window.__m; })()`);
  const keyboard = await evaluate(`!!document.querySelector('[data-testid=keyboard]')`);
  const visibility = await evaluate('document.visibilityState');

  const longTasks = result.longTasks;
  const slowFrames = result.frames.filter(gap => gap > 50);
  let shrinks = 0;
  let deepest = 0;
  for (let i = 1; i < result.lengths.length; i++) {
    // Markdown eats its own marks as they close ("**People" → "People"): a few characters are not a restart.
    if (result.lengths[i] < result.lengths[i - 1] - SHRINK_SLACK) {
      shrinks++;
      deepest = Math.max(deepest, result.lengths[i - 1] - result.lengths[i]);
    }
  }
  console.log(`STREAM ${deltas.length} deltas in ${((streamEndedAt - streamStartedAt) / 1000).toFixed(1)} s, ${REPLY.length} chars, room of ${ROOM_MESSAGES}, CPU throttle ${cpuThrottle}x`);
  console.log(`LONG_TASKS ${longTasks.length} (total ${longTasks.reduce((a, b) => a + b, 0)} ms, max ${Math.max(0, ...longTasks)} ms)`);
  console.log(`SLOW_FRAMES ${slowFrames.length} of ${result.frames.length} (max gap ${Math.round(Math.max(0, ...result.frames))} ms)`);
  console.log(`SHRINKS ${shrinks} (largest ${deepest} chars)`);
  console.log(`KEYBOARD ${keyboard ? 'shown' : 'missing'}`);
  console.log(`VISIBILITY ${visibility} (the typing reveal runs only when visible)`);
} catch (error) {
  console.error('MEASURE_FAIL', error.message);
  exitCode = 1;
} finally {
  ws.close();
  child.kill('SIGTERM');
  await new Promise(done => child.once('exit', done));
  server.close();
  rmSync(userDataRoot, { recursive: true, force: true });
}
process.exit(exitCode);
