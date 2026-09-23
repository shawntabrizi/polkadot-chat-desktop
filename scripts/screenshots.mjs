#!/usr/bin/env node
// M5 screenshots: builds the app, drives it over the Chrome DevTools protocol
// against throwaway profiles, and saves 1280×800 PNGs of every screen in
// Berlin Day and Berlin Night to .agent-runs/screens/<theme>/:
//   signup.png                         a fresh profile
//   room.png assistant.png chats.png   a seeded identity (PCD_SCREENSHOT_IDENTITY)
//   requests.png settings.png keyboard.png
//
// M6: the seeded profile's Assistant runs on PCD_SCREENSHOT_ENGINE (default
// `claude`, tools off; `proxy` for the LLM proxy), so assistant.png shows the
// engine in the header. room.png mutes the room (the list shows the icon);
// chats.png shows a "Draft:" preview left in the Assistant room (cleared
// again afterwards); settings.png shows the Chat and Assistant sections after
// "Detect installed"; keyboard.png the Keyboard section.
//
//   PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots
//
// The seeded identity is a plain identity.json from the Node scripts; a tiny
// Electron script encrypts its mnemonic with safeStorage into the throwaway
// profile, as the app would have. room.png chats with the echo bot pcdpeer.47
// (a request the first time, then "hello" and its echo). requests.png needs an
// incoming request: `e2e-chat.mjs` sends one from PCD_SCREENSHOT_REQUESTER
// (default pcdtestggji). assistant.png needs LLM_PROXY_KEY in the environment.
// PCD_SCREENSHOT_ROOM_WITH=<identity name> takes room.png with that test
// identity instead of the bot (for when the bot is down): `e2e-chat.mjs` sends
// its request, the app accepts it, the script's "ping" arrives, and the app
// answers "hello".
// What cannot be captured is reported and the exit code is 1. Prints no secret.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronBin = join(root, 'node_modules/.bin/electron');
const outDir = join(root, '.agent-runs/screens');
const THEMES = ['berlin-day', 'berlin-night'];
const WIDTH = 1280;
const HEIGHT = 800;
const PORT = 9335;
const BOT = 'pcdpeer.47';
const identitySource = process.env.PCD_SCREENSHOT_IDENTITY;
const requester = process.env.PCD_SCREENSHOT_REQUESTER ?? 'pcdtestggji';
const roomWith = process.env.PCD_SCREENSHOT_ROOM_WITH ?? null;
const engine = process.env.PCD_SCREENSHOT_ENGINE ?? 'claude';
const DRAFT = 'Ask about the People chain later';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const t0 = Date.now();
const log = (...parts) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...parts);
const missing = [];
const saved = [];

// ── Build ────────────────────────────────────────────────────────────────

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (build.status !== 0) {
  console.error('build failed');
  process.exit(1);
}
log('built');

// ── One app run over CDP ─────────────────────────────────────────────────

const launch = async profile => {
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: root,
    env: { ...process.env, PCD_USER_DATA_DIR: profile },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
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
      await sleep(250);
    }
    return false;
  };
  const exists = selector => `!!document.querySelector(${JSON.stringify(selector)})`;
  const click = selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const clickText = (selector, text) =>
    evaluate(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`,
    );
  const type = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await send('Input.insertText', { text });
  };
  const settle = async () => {
    await evaluate('document.fonts.ready.then(() => true)');
    await sleep(600);
  };
  const capture = async (theme, name) => {
    await settle();
    // Park the pointer in a corner so no hover state is caught by accident.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: HEIGHT - 1 });
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, theme, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    saved.push(file);
    log('saved', `${theme}/${name}.png`);
  };
  const key = async (keyName, code, extra = {}) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, ...extra });
  };
  /** Empties a React-controlled field the way a person would: select all, delete. */
  const clearField = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key('a', 'KeyA', { modifiers: 4, commands: ['selectAll'] });
    await key('Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
  };
  const setTheme = async theme => {
    // What theme.ts setTheme does (the key and the attribute), then a reload
    // so the anti-flash script applies it before the first paint.
    await evaluate(`localStorage.setItem('pds-theme', ${JSON.stringify(theme)}); location.reload(); true`);
    await sleep(1000);
    await waitFor(`document.readyState === 'complete' && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 20_000);
  };
  const quit = async () => {
    ws.close();
    child.kill('SIGTERM');
    await new Promise(done => child.once('exit', done));
    await sleep(500);
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  return { evaluate, waitFor, exists, click, clickText, type, capture, setTheme, quit, send, key, clearField };
};

// ── Sign-up (a fresh profile per theme) ──────────────────────────────────

for (const theme of THEMES) {
  mkdirSync(join(outDir, theme), { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'pcd-shots-signup-'));
  const app = await launch(profile);
  try {
    await app.setTheme(theme);
    if (!(await app.waitFor(app.exists('#signup-username'), 30_000))) throw new Error('no sign-up screen');
    await app.type('#signup-username', 'polkadotfan');
    // The availability line answers from the identity backend.
    await app.waitFor(`!document.querySelector('[data-testid=availability]').textContent.includes('Checking')`, 20_000);
    await app.capture(theme, 'signup');
  } catch (error) {
    missing.push(`${theme}/signup.png (${error.message})`);
  } finally {
    await app.quit();
    rmSync(profile, { recursive: true, force: true });
  }
}

// ── The seeded identity ──────────────────────────────────────────────────

if (!identitySource || !existsSync(identitySource)) {
  for (const theme of THEMES) for (const name of ['chats', 'room', 'assistant', 'settings', 'keyboard', 'requests']) missing.push(`${theme}/${name}.png (PCD_SCREENSHOT_IDENTITY not set)`);
} else {
  const source = JSON.parse(readFileSync(identitySource, 'utf8'));
  const profile = mkdtempSync(join(tmpdir(), 'pcd-shots-seeded-'));
  // Encrypt the mnemonic as the app's identity store does. Same app name as a
  // dev run (src/main/index.ts), so safeStorage uses the same keychain entry;
  // the throwaway profile is the only directory written.
  const seedScript = join(profile, 'seed.mjs');
  writeFileSync(
    seedScript,
    `import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
app.setName('polkadot-chat-desktop');
app.setPath('userData', process.env.SEED_PROFILE);
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
    env: { ...process.env, SEED_PROFILE: profile, SEED_SOURCE: resolve(identitySource) },
    stdio: 'ignore',
  });
  rmSync(seedScript);
  if (seeded.status !== 0 || !existsSync(join(profile, 'identity.json'))) {
    console.error('seeding the identity failed');
    process.exit(1);
  }
  log('seeded', source.username);
  // The Assistant's engine, as Settings would write it (tools off).
  writeFileSync(
    join(profile, 'assistant.json'),
    `${JSON.stringify({ version: 1, model: 'auto/deepseek-v4.1-flash', baseUrl: 'https://llm.substrate.dev', keyEncrypted: null, engine, tools: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  log('assistant engine', engine);

  // An incoming request for requests.png, from another test identity. The
  // script waits for an accept that never comes and times out; it is stopped
  // once the screenshots are done.
  const requestLog = openSync(join(outDir, 'requester.log'), 'w');
  const requesterRun = spawn('node', ['scripts/e2e-chat.mjs', source.username, '--identity', requester], {
    cwd: root,
    stdio: ['ignore', requestLog, requestLog],
  });
  const roomPeer = roomWith ? JSON.parse(readFileSync(join(root, '.agent-runs', `identity-${roomWith}`, 'identity.json'), 'utf8')).username : BOT;
  const roomLog = roomWith ? openSync(join(outDir, 'room-peer.log'), 'w') : null;
  const roomPeerRun = roomWith
    ? spawn('node', ['scripts/e2e-chat.mjs', source.username, '--identity', roomWith], { cwd: root, stdio: ['ignore', roomLog, roomLog] })
    : null;

  for (const theme of THEMES) {
    const app = await launch(profile);
    const shot = async (name, run) => {
      try {
        await run();
        await app.capture(theme, name);
      } catch (error) {
        missing.push(`${theme}/${name}.png (${error.message})`);
        log('missed', `${theme}/${name}.png:`, error.message);
      }
    };
    try {
      await app.setTheme(theme);
      if (!(await app.waitFor(app.exists('[data-testid=username]'), 60_000))) throw new Error('the chat screen did not open');
      await app.waitFor(`document.querySelector('[data-testid=connection-status]').textContent === 'Connected'`, 60_000);

      await shot('room', async () => {
        if (roomWith) {
          const peerRow = `[...document.querySelectorAll('[data-testid=chat-row]')].find(r => r.textContent.includes(${JSON.stringify(roomPeer)}))`;
          if (await app.evaluate(`!!${peerRow}`)) {
            await app.evaluate(`${peerRow}.click()`);
          } else {
            // Accept the test identity's request; its script then sends "ping".
            if (!(await app.waitFor(app.exists('[data-testid=new-requests]'), 120_000))) throw new Error(`no request from ${roomPeer} arrived`);
            await app.click('[data-testid=new-requests]');
            const row = `[...document.querySelectorAll('[data-testid=incoming-request]')].find(r => r.textContent.includes(${JSON.stringify(roomPeer)}))`;
            if (!(await app.waitFor(`!!${row}`, 120_000))) throw new Error(`no request from ${roomPeer} arrived`);
            await app.evaluate(`${row}.click()`);
            await app.waitFor(app.exists('[data-testid=request-banner]'), 10_000);
            await app.clickText('[data-testid=request-banner] button', 'Accept');
            log('accepted the request of', roomPeer);
          }
          if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(roomPeer)} && ${app.exists('[aria-label=Send]')}`, 60_000))) {
            throw new Error(`the room with ${roomPeer} did not open`);
          }
          if (!(await app.waitFor(`document.querySelectorAll('[data-testid=message-incoming]').length > 0`, 120_000))) throw new Error(`no message from ${roomPeer}`);
          await app.type('textarea[aria-label=Message]', 'hello');
          await app.click('[aria-label=Send]');
          await app.waitFor(`[...document.querySelectorAll('[data-testid=message-outgoing]')].pop()?.querySelector('[aria-label=Delivered],[aria-label=Sent]') != null`, 30_000);
          return;
        }
        const botRow = `[...document.querySelectorAll('[data-testid=chat-row]')].find(r => r.textContent.includes(${JSON.stringify(BOT)}))`;
        if (!(await app.evaluate(`!!${botRow}`))) {
          // First run: find the bot and send it a request with "hello".
          await app.click('[aria-label="New chat"]');
          await app.waitFor(app.exists('[aria-label=Username]'), 10_000);
          await app.type('[aria-label=Username]', BOT);
          if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=search-results] button')].some(b => b.textContent.includes(${JSON.stringify(BOT)}))`, 90_000))) {
            throw new Error(`${BOT} not found by search`);
          }
          await app.clickText('[data-testid=search-results] button', BOT);
          await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
          await app.type('textarea[aria-label=Message]', 'hello');
          await app.clickText('button', 'Send Request');
          log('request sent to', BOT);
        } else {
          await app.evaluate(`${botRow}.click()`);
        }
        // The room (not the pending request) has the composer and the Send button.
        if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(BOT)} && ${app.exists('[aria-label=Send]')}`, 150_000))) {
          throw new Error(`${BOT} did not accept the request`);
        }
        const incoming = await app.evaluate(`document.querySelectorAll('[data-testid=message-incoming]').length`);
        await app.type('textarea[aria-label=Message]', 'hello');
        await app.click('[aria-label=Send]');
        if (!(await app.waitFor(`document.querySelectorAll('[data-testid=message-incoming]').length > ${incoming}`, 90_000))) {
          throw new Error(`${BOT} did not echo`);
        }
        // A reaction on the echo, so the chips show.
        await app.evaluate(`(() => { const rows = document.querySelectorAll('[data-testid=message-incoming]'); rows[rows.length - 1].querySelector('[aria-label="React with 👍"]')?.click(); return true; })()`);
        await app.waitFor(`document.querySelectorAll('[aria-pressed=true]').length > 0`, 20_000);
        // Mute the room (once: the profile is shared by both themes).
        await app.click('[data-testid=mute-toggle][aria-pressed=false]');
        await app.waitFor(app.exists('[data-testid=mute-toggle][aria-pressed=true]'), 10_000);
      });

      await shot('assistant', async () => {
        await app.click('[data-testid=chat-row-assistant]');
        await app.waitFor(app.exists('[aria-label=Send]'), 10_000);
        if ((await app.evaluate(`document.querySelectorAll('[data-testid=message-incoming]').length`)) === 0) {
          await app.type('textarea[aria-label=Message]', 'Give me a markdown list of three short facts about Polkadot, one **bold** word in each, then one line of `inline code`.');
          await app.click('[aria-label=Send]');
          await sleep(1000);
        }
        const done = `document.querySelectorAll('[data-testid=markdown]').length > 0 && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Stop')`;
        if (!(await app.waitFor(done, 180_000))) throw new Error(`no assistant reply from engine ${engine}`);
        await app.waitFor(app.exists('[data-testid=assistant-engine]'), 10_000);
      });

      // A reload clears the selection: the list with the empty right pane.
      await app.evaluate('location.reload(); true');
      await sleep(1000);
      await app.waitFor(app.exists('[data-testid=chat-row-assistant]'), 60_000);
      await app.waitFor(app.exists('[data-testid=new-requests]'), theme === THEMES[0] ? 120_000 : 15_000);
      await shot('chats', async () => {
        await app.waitFor(`document.querySelectorAll('[data-testid=chat-row]').length > 0`, 20_000);
        // A draft left in the Assistant room; Esc goes back to the list.
        await app.click('[data-testid=chat-row-assistant]');
        await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
        await app.type('textarea[aria-label=Message]', DRAFT);
        await sleep(800);
        await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
        if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=chat-row-assistant]')].some(r => r.textContent.includes('Draft: ${DRAFT}'))`, 10_000))) {
          throw new Error('no draft preview in the list');
        }
      });
      // The draft goes again, so the next theme's Assistant room starts empty.
      await app.click('[data-testid=chat-row-assistant]');
      await app.waitFor(`document.querySelector('textarea[aria-label=Message]')?.value === ${JSON.stringify(DRAFT)}`, 10_000);
      await app.clearField('textarea[aria-label=Message]');
      await sleep(800);
      await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
      await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);

      await shot('requests', async () => {
        if (!(await app.click('[data-testid=new-requests]'))) throw new Error(`no incoming request arrived (see .agent-runs/screens/requester.log)`);
        await app.waitFor(app.exists('[data-testid=incoming-request]'), 10_000);
        await app.click('[data-testid=incoming-request]');
        if (!(await app.waitFor(app.exists('[data-testid=request-banner]'), 10_000))) throw new Error('the request room did not open');
      });

      await shot('settings', async () => {
        await app.click('[aria-label="Back to chats"]');
        await app.click('[aria-label=Settings]');
        if (!(await app.waitFor(app.exists('[data-testid=assistant-key-state]'), 20_000))) throw new Error('settings did not load');
        await app.click('[data-testid=engine-detect]');
        if (!(await app.waitFor(app.exists('[data-testid=engine-status]'), 30_000))) throw new Error('engine detection did not answer');
        await app.evaluate(`document.querySelector('[data-testid=send-key-select]').closest('section').scrollIntoView({ block: 'start' }); true`);
      });

      await shot('keyboard', async () => {
        await app.evaluate(`document.querySelector('[data-testid=keyboard-shortcuts]').closest('section').scrollIntoView({ block: 'center' }); true`);
      });
    } catch (error) {
      missing.push(`${theme}: ${error.message}`);
    } finally {
      await app.quit();
    }
  }
  requesterRun.kill('SIGTERM');
  roomPeerRun?.kill('SIGTERM');
  rmSync(profile, { recursive: true, force: true });
  log('seeded profile removed:', !existsSync(profile));
}

console.log('\nPNGs:');
for (const file of saved) console.log(`  ${file.slice(root.length + 1)}`);
if (missing.length > 0) {
  console.log('\nNot captured:');
  for (const entry of missing) console.log(`  ${entry}`);
  console.log('SCREENSHOTS_PARTIAL');
  process.exit(1);
}
console.log('SCREENSHOTS_OK');
