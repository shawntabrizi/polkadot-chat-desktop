#!/usr/bin/env node
// M5 screenshots: builds the app, drives it over the Chrome DevTools protocol
// against throwaway profiles, and saves 1280×800 PNGs of every screen in
// Berlin Day and Berlin Night to .agent-runs/screens/<theme>/:
//   signup.png                         a fresh profile
//   room.png assistant.png chats.png   a seeded identity (PCD_SCREENSHOT_IDENTITY)
//   requests.png settings.png keyboard.png
//   search.png search-jump.png search-empty.png search-no-results.png
//
// M6: the seeded profile's Assistant runs on PCD_SCREENSHOT_ENGINE (default
// `claude`, tools off; `proxy` for the LLM proxy), so assistant.png shows the
// engine in the header. room.png mutes the room (the list shows the icon);
// chats.png shows a "Draft:" preview left in the Assistant room (cleared
// again afterwards); settings.png shows the Chat and Assistant sections after
// "Detect installed"; keyboard.png the Keyboard section.
//
// M7: room-deleted.png is the same room with a tombstone and a live frame.
// The app deletes one of its own messages through the message menu ("Delete
// for everyone", then the 6 s Undo time). The live frame is a real message
// from the room peer: with PCD_SCREENSHOT_ROOM_WITH its `e2e-chat.mjs` run
// gets `--live-frame` and sends a pca-shaped `⏳ working · …` text after its
// ping is answered. The echo bot sends no live frames, so without
// PCD_SCREENSHOT_ROOM_WITH the live frame is reported missing.
//
// M7b: search.png is the unified search for "pcdp" with its three sections:
// the pirate bot pcdpirate.81 under "Chats and contacts" (a request sent the
// first time through a global search hit and the draft room), the echo bot
// pcdpeer.47 under "Global search", and a message that names the pirate bot
// (sent once in the room) under "Messages"; ↓ twice highlights the first
// global row. search-jump.png: a message hit opened, its room scrolled to it
// and the message highlighted (the 1.5 s highlight must then end). search-empty.png is "+" with the empty field (placeholder
// "Type username", the Recent section); search-no-results.png a query that
// finds nothing.
//
// M8: room-buttons.png is the room with a spec 0006 keyboard (two rows: a
// callback, a command, a url and a reserved tx button) from the room peer
// (`e2e-chat.mjs --buttons`, so it needs PCD_SCREENSHOT_ROOM_WITH). The shot
// presses the callback button (spinner) and then the url button, whose
// confirm strip shows the host under the bubble.
//
// M9 (spec 0005, both need PCD_SCREENSHOT_ROOM_WITH; the peer's
// `e2e-chat.mjs` gets `--seen --typing` and stays): room-seen.png sends a
// message, waits for the peer's `seen` (the tick turns to the seen colour),
// and hovers the tick so its "Seen <time>" tooltip shows. room-typing.png
// sends "Are you working on it?", which starts a 20 s agent turn on the peer
// (`typing{working}` every 4 s): the header shows "working…" with the pulse.
//
// M10 (spec 0008): room-bot.png is the room with the room peer after its
// `e2e-chat.mjs --botinfo` described it as an AI agent: the badge after the
// name, the description under it, the greeting row, and the command menu
// open over the composer ("/" typed). faucet.png is the built-in Faucet with
// its keyboard and the confirm strip of "Get test funds" (never opened, and
// "Copy my address" is never pressed: it would write the machine's
// clipboard). search-bots.png searches "test": the Faucet (by its
// description) and the room peer (by its username) under "Bots".
//
// M11 (spec 0007, needs PCD_SCREENSHOT_ROOM_WITH; the peer's `e2e-chat.mjs`
// gets `--tx`): the room peer sends a keyboard with a `tx` button (0.01 PAS
// from the app's account to itself on devnet Asset Hub) and lists a
// `balance` command. room-tx.png presses it: the signing strip after the
// dry-run (amount, fee, signer, outcome; Sign enabled). room-tx-done.png
// presses Sign: the app signs with the identity key, the reference bubble
// goes submitted → in block → finalized (the shot waits for the finalized
// tick), and the header shows the Meter balance line. The seeded identity
// must hold PAS (the faucet drip of `npm run e2e:meter`).
//
// M11b: pocket.png is the Pocket (the footer's balance chip clicked): the
// Asset Hub and People chain balances, the address with Copy and its QR
// code, and "Get test funds". room-flip.png is the room with the coin-flip
// bot pcdflip.NN (found by search; a request the first time): its "Stake
// 0.5 PAS" tx button pressed and the signing strip after the dry-run.
// room-flip-done.png signs it (first theme only; the second theme shows the
// same room): once the app's stake is in a best block, a second person
// (`e2e-flip.mjs --role b` with PCD_SCREENSHOT_FLIP_WITH, default pcdeceb,
// started at the beginning so its drip and accept are done) stakes too, and
// the shot shows the bot's "Flip settled: … won 1 PAS" reference.
//
// M12 (spec 0009): a group of three: the app, a second test identity
// (PCD_SCREENSHOT_GROUP_WITH, default pcdbenchfina, driven through
// `e2e-group.mjs --role b`) and the bot pcdguide.70. The first theme makes
// both contacts (the helper's request, accepted in the app; the app's request
// to the bot, from a global search hit). group-create.png is "+" → New group
// with the name typed and both checked; the first theme then presses Create
// (the second leaves the view). room-group.png: the app's "hello all", the
// helper's answer and, when the bot runs group-aware code, the bot's reply
// (three senders; a missing bot reply is reported). group-members.png opens
// the members panel and hovers the helper's row, so the admin's Remove shows.
//
// M12 owner rulings: faucet.png presses "Get 1 PAS" in the first theme: the
// embedded Faucet's pending row with its shimmer and the busy button, then the
// in-app devnet transfer's reference ("Dripped 1 PAS from //Alice") and
// "Balance now …". chats.png shows the footer's account block.
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
// Headless by default: the app runs with PCD_HEADLESS=1 (hidden window, no
// dock icon, no focus), so a run does not bring the app to the front. The
// CDP captures work on the hidden window. `--visible` shows the window:
//   npm run screenshots -- --visible
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
const flipWith = process.env.PCD_SCREENSHOT_FLIP_WITH ?? 'pcdeceb';
const FLIP_BOT = 'pcdflip';
const groupWith = process.env.PCD_SCREENSHOT_GROUP_WITH ?? 'pcdbenchfina';
const GROUP_BOT = 'pcdguide.70';
const GROUP_NAME = 'Weekend crew';
const DRAFT = 'Ask about the People chain later';
const headlessEnv = process.argv.includes('--visible') ? {} : { PCD_HEADLESS: '1' };

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
    env: { ...process.env, ...headlessEnv, PCD_USER_DATA_DIR: profile },
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
  const capture = async (theme, name, { now = false } = {}) => {
    if (!now) {
      await settle();
      // Park the pointer in a corner so no hover state is caught by accident.
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: HEIGHT - 1 });
      await sleep(200);
    }
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
  return { evaluate, waitFor, exists, click, clickText, type, capture, setTheme, quit, send, key, clearField, settle };
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
  for (const theme of THEMES) for (const name of ['chats', 'room', 'room-seen', 'room-typing', 'room-bot', 'room-tx', 'room-tx-done', 'pocket', 'group-create', 'room-group', 'group-members', 'room-flip', 'room-flip-done', 'faucet', 'search-bots', 'assistant', 'settings', 'keyboard', 'requests', 'search', 'search-jump', 'search-empty', 'search-no-results']) missing.push(`${theme}/${name}.png (PCD_SCREENSHOT_IDENTITY not set)`);
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
    env: { ...process.env, ...headlessEnv, SEED_PROFILE: profile, SEED_SOURCE: resolve(identitySource) },
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
    ? spawn('node', ['scripts/e2e-chat.mjs', source.username, '--identity', roomWith, '--live-frame', '--buttons', '--botinfo', '--tx', '--seen', '--typing'], { cwd: root, stdio: ['ignore', roomLog, roomLog] })
    : null;

  // The second coin-flip player: drips, accepts pcdflip and waits for STAKE on its stdin.
  writeFileSync(join(outDir, 'flip-peer.log'), '');
  const flipErr = openSync(join(outDir, 'flip-peer.err.log'), 'w');
  const flipPeer = spawn('node', ['scripts/e2e-flip.mjs', '--role', 'b', '--identity', flipWith], { cwd: root, stdio: ['pipe', 'pipe', flipErr] });
  const flipLines = [];
  flipPeer.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      flipLines.push(line);
      writeFileSync(join(outDir, 'flip-peer.log'), `${line}\n`, { flag: 'a' });
    }
  });
  let flipSettled = false;

  // The second group member: waits for commands on its stdin (e2e-group.mjs child protocol).
  const groupErr = openSync(join(outDir, 'group-peer.err.log'), 'w');
  writeFileSync(join(outDir, 'group-peer.log'), '');
  const groupPeer = spawn('node', ['scripts/e2e-group.mjs', '--role', 'b', '--identity', groupWith, '--other', source.accountHex, '--bot', GROUP_BOT], {
    cwd: root,
    stdio: ['pipe', 'pipe', groupErr],
  });
  const groupLines = [];
  groupPeer.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      groupLines.push(line);
      writeFileSync(join(outDir, 'group-peer.log'), `${line}\n`, { flag: 'a' });
    }
  });
  /** Sends a command to the group member; its first answer line matching `pattern`, or null. */
  const groupAsk = async (command, pattern, ms) => {
    const from = groupLines.length;
    groupPeer.stdin.write(`${command}\n`);
    for (const until = Date.now() + ms; Date.now() < until; await sleep(250)) {
      const hit = groupLines.slice(from).find(line => pattern.test(line));
      if (hit) return hit;
    }
    return null;
  };
  const groupPeerName = JSON.parse(readFileSync(join(root, '.agent-runs', `identity-${groupWith}`, 'identity.json'), 'utf8')).username;
  let groupCreated = false;

  for (const theme of THEMES) {
    const app = await launch(profile);
    const shot = async (name, run, options) => {
      try {
        await run();
        await app.capture(theme, name, options);
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
          await app.type('[aria-label=Search]', BOT);
          if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=search-global-row]')].some(b => b.textContent.includes(${JSON.stringify(BOT)}))`, 90_000))) {
            throw new Error(`${BOT} not found by search`);
          }
          await app.clickText('[data-testid=search-global-row]', BOT);
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

      await shot('room-deleted', async () => {
        if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
        const tombstone = `document.querySelector('[data-testid=message-outgoing] [data-testid=message-deleted]') != null`;
        if (!(await app.evaluate(tombstone))) {
          // Once: the profile is shared by both themes.
          const text = 'This one was for another chat';
          await app.type('textarea[aria-label=Message]', text);
          await app.click('[aria-label=Send]');
          const last = `[...document.querySelectorAll('[data-testid=message-outgoing]')].pop()`;
          await app.waitFor(`${last}?.textContent.includes(${JSON.stringify(text)}) && ${last}.querySelector('[aria-label=Delivered],[aria-label=Sent]') != null`, 30_000);
          // Right click opens the message menu.
          await app.evaluate(`${last}.querySelector('[data-testid=bubble]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); true`);
          if (!(await app.waitFor(app.exists('[data-testid=delete-message]'), 10_000))) throw new Error('no Delete for everyone in the message menu');
          await app.click('[data-testid=delete-message]');
          if (!(await app.waitFor(`${last}?.textContent.includes('Deleting…')`, 5_000))) throw new Error('the bubble did not show Deleting…');
          if (!(await app.waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some(t => t.textContent.includes('This asks their device to delete it.'))`, 5_000))) {
            throw new Error('no Undo toast');
          }
          log('deleting, the toast shows');
          if (!(await app.waitFor(tombstone, 20_000))) throw new Error('no tombstone after the Undo time');
          log('tombstone shown');
        }
        if (!(await app.waitFor(app.exists('[data-testid=live-frame]'), roomWith ? 120_000 : 1_000))) {
          throw new Error(roomWith ? `no live frame from ${roomPeer} (see .agent-runs/screens/room-peer.log)` : 'no live frame: the echo bot sends none; set PCD_SCREENSHOT_ROOM_WITH');
        }
      });

      await shot('room-buttons', async () => {
        if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
        // The M8 keyboard (a callback among its buttons), not a later one such as M11's tx keyboard.
        const keyboard = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=keyboard]')].filter(k => k.querySelector('[data-action=callback]')).pop()`;
        if (!(await app.waitFor(`${keyboard} != null`, roomWith ? 120_000 : 1_000))) {
          throw new Error(roomWith ? `no keyboard from ${roomPeer} (see .agent-runs/screens/room-peer.log)` : 'no keyboard: set PCD_SCREENSHOT_ROOM_WITH');
        }
        await app.evaluate(`${keyboard}.scrollIntoView({ block: 'end' }); true`);
        await app.evaluate(`${keyboard}.querySelector('[data-action=callback]').click(); true`);
        if (!(await app.waitFor(`${keyboard}.querySelector('[data-action=callback][aria-busy=true]') != null`, 10_000))) throw new Error('the callback button shows no spinner');
        log('callback pressed, spinner on');
        await app.evaluate(`${keyboard}.querySelector('[data-action=url]').click(); true`);
        if (!(await app.waitFor(app.exists('[data-testid=url-confirm]'), 5_000))) throw new Error('no confirm strip for the url button');
        const strip = await app.evaluate(`document.querySelector('[data-testid=url-confirm]').textContent`);
        log('url strip:', JSON.stringify(strip));
        const disabled = await app.evaluate(`${keyboard}.querySelectorAll('[data-testid=keyboard-disabled]').length`);
        log('disabled buttons:', disabled);
      });

      const needsPeer = what => {
        if (!roomWith) throw new Error(`no ${what}: set PCD_SCREENSHOT_ROOM_WITH`);
      };

      // Before room-typing: a "working…" hint takes the header line for 20 s.
      await shot('room-bot', async () => {
        needsPeer('botInfo');
        if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
        if (!(await app.waitFor(`${app.exists('header [data-testid=bot-badge]')} && ${app.exists('[data-testid=bot-description]')} && ${app.exists('[data-testid=bot-greeting]')}`, 120_000))) {
          throw new Error(`no botInfo from ${roomPeer} (see .agent-runs/screens/room-peer.log)`);
        }
        log('header:', JSON.stringify(await app.evaluate(`document.querySelector('header [data-testid=bot-description]').textContent`)));
        await app.type('textarea[aria-label=Message]', '/');
        if (!(await app.waitFor(`document.querySelectorAll('[data-testid=command-option]').length > 0`, 5_000))) throw new Error('"/" opened no command menu');
        // The greeting at the top of the list, above the menu.
        await app.evaluate(`document.querySelector('[data-testid=bot-greeting]').scrollIntoView({ block: 'start' }); true`);
        log('command menu:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=command-option]')].map(o => o.textContent)`)));
        await app.settle();
      });
      // The menu goes with the "/" (Esc, then the field is emptied), so the next shots start clean.
      await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
      if (await app.evaluate(app.exists('[data-testid=command-menu]'))) missing.push(`${theme}: Esc did not close the command menu`);
      await app.clearField('textarea[aria-label=Message]');

      await shot(
        'room-seen',
        async () => {
          needsPeer('seen');
          if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
          const text = `Did you see this? ${theme}`;
          await app.type('textarea[aria-label=Message]', text);
          await app.click('[aria-label=Send]');
          const last = `[...document.querySelectorAll('[data-testid=message-outgoing]')].pop()`;
          if (!(await app.waitFor(`${last}?.textContent.includes(${JSON.stringify(text)}) && ${last}.querySelector('[data-testid=seen-tick]') != null`, 60_000))) {
            throw new Error(`no seen from ${roomPeer} (see .agent-runs/screens/room-peer.log)`);
          }
          log('seen tick shown');
          // Hover the tick: its tooltip says when. The list may still scroll
          // when the tick turns, so measure again and retry.
          const tooltip = `[...document.querySelectorAll('[data-slot=tooltip-content],[role=tooltip]')].some(t => t.textContent.startsWith('Seen '))`;
          let shown = false;
          for (let attempt = 0; attempt < 4 && !shown; attempt++) {
            await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
            // room-buttons scrolled the keyboard into view, so the list may not follow the new message.
            await app.evaluate(`${last}.scrollIntoView({ block: 'end' }); true`);
            await sleep(400);
            const box = await app.evaluate(
              `(() => { const r = ${last}.querySelector('[data-testid=seen-tick]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
            );
            await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y) });
            shown = await app.waitFor(tooltip, 3_000);
            if (!shown) log(`no tooltip yet, tick at ${Math.round(box.x)},${Math.round(box.y)}`);
          }
          if (!shown) throw new Error('no "Seen" tooltip on hover');
          const tip = await app.evaluate(`[...document.querySelectorAll('[data-slot=tooltip-content],[role=tooltip]')].find(t => t.textContent.startsWith('Seen ')).textContent`);
          log('tooltip:', JSON.stringify(tip));
          // Let the tooltip finish its fade-in; the pointer must stay on the tick.
          await app.evaluate('document.fonts.ready.then(() => true)');
          await sleep(600);
        },
        { now: true },
      );

      await shot('room-typing', async () => {
        needsPeer('typing');
        if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
        await app.type('textarea[aria-label=Message]', 'Are you working on it?');
        await app.click('[aria-label=Send]');
        if (!(await app.waitFor(app.exists('[data-testid=typing-indicator][data-kind=working]'), 60_000))) {
          throw new Error(`no working… from ${roomPeer} (see .agent-runs/screens/room-peer.log)`);
        }
        log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=typing-indicator]').textContent`)));
      });

      // M11: the signing strip of a tx button, then the reference after Sign.
      const txKeyboard = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=keyboard]')].filter(k => k.querySelector('[data-action=tx]:not([disabled])')).pop()`;
      await shot('room-tx', async () => {
        needsPeer('tx button');
        if (!(await app.evaluate(app.exists('textarea[aria-label=Message]')))) throw new Error('the room is not open');
        if (!(await app.waitFor(`${txKeyboard} != null`, 120_000))) throw new Error(`no tx button from ${roomPeer} (see .agent-runs/screens/room-peer.log)`);
        // room-buttons left its url strip open; Cancel it, so Sign is the one primary control on screen.
        await app.evaluate(`[...document.querySelectorAll('[data-testid=url-confirm] button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);
        await app.evaluate(`${txKeyboard}.querySelector('[data-action=tx]').click(); true`);
        if (!(await app.waitFor(`document.querySelector('[data-testid=tx-strip]')?.dataset.phase === 'ready' || document.querySelector('[data-testid=tx-strip]')?.dataset.phase === 'refused'`, 60_000))) {
          throw new Error('the signing strip did not finish its dry-run');
        }
        const strip = await app.evaluate(`document.querySelector('[data-testid=tx-strip]').innerText.replace(/\\s+/g, ' ')`);
        log('strip:', JSON.stringify(strip));
        if ((await app.evaluate(`document.querySelector('[data-testid=tx-strip]').dataset.phase`)) !== 'ready') throw new Error(`the dry-run refused it: ${strip}`);
        await app.evaluate(`document.querySelector('[data-testid=tx-strip]').scrollIntoView({ block: 'end' }); true`);
      });
      await shot('room-tx-done', async () => {
        needsPeer('tx button');
        if (!(await app.evaluate(`document.querySelector('[data-testid=tx-strip]')?.dataset.phase === 'ready'`))) throw new Error('no signing strip to sign');
        const before = await app.evaluate(`document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]').length`);
        await app.click('[data-testid=tx-sign]');
        const last = `[...document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]')][${before}]`;
        if (!(await app.waitFor(`${last} != null`, 60_000))) throw new Error('no reference bubble after Sign');
        log('reference:', JSON.stringify(await app.evaluate(`${last}.innerText`)));
        if (!(await app.waitFor(`${last}.dataset.status === 'inBlock' || ${last}.dataset.status === 'finalized'`, 90_000))) {
          throw new Error(`the transaction did not reach a block: ${await app.evaluate(`${last}.innerText`)}`);
        }
        log('in block:', JSON.stringify(await app.evaluate(`${last}.innerText`)));
        if (!(await app.waitFor(`${last}.dataset.status === 'finalized'`, 120_000))) throw new Error(`not finalized in 120 s: ${await app.evaluate(`${last}.innerText`)}`);
        log('finalized:', JSON.stringify(await app.evaluate(`${last}.innerText`)));
        if (!(await app.waitFor(app.exists('[data-testid=bot-balance]'), 60_000))) throw new Error('no balance line (spec 0008 hint) in the header');
        log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=bot-balance]').textContent`)));
        // Centred: at the very end the composer's edge clips the last bubble.
        await app.evaluate(`${last}.scrollIntoView({ block: 'center' }); true`);
      });

      // M11b: the Pocket, from the footer chip.
      await shot('pocket', async () => {
        if (!(await app.waitFor(`/\\d PAS/.test(document.querySelector('[data-testid=balance-chip]')?.textContent ?? '')`, 60_000))) throw new Error('the balance chip shows no amount');
        log('chip:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=balance-chip]').textContent`)));
        await app.click('[data-testid=balance-chip]');
        const read = row => `/PAS|No balance needed/.test(document.querySelector('[data-testid=${row}]')?.textContent ?? '')`;
        if (!(await app.waitFor(`${read('pocket-asset-hub')} && ${read('pocket-people')} && ${app.exists('[data-testid=pocket] img')}`, 60_000))) {
          throw new Error(`the Pocket did not read both balances: ${await app.evaluate(`document.querySelector('[data-testid=pocket]')?.innerText ?? 'no pocket'`)}`);
        }
        log('pocket:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid^=pocket-]')].filter(e => e.dataset.testid !== 'pocket-address').map(e => e.innerText.replace(/\\s+/g, ' ')).join(' | ')`)));
      });

      // M12: a group of three. The first theme makes the two members contacts, once.
      const groupRow = `[...document.querySelectorAll('[data-testid=chat-row-group]')].find(r => r.textContent.includes(${JSON.stringify(GROUP_NAME)}))`;
      const contactRow = name => `[...document.querySelectorAll('[data-testid=chat-row],[data-testid=chat-row-outgoing]')].some(r => r.textContent.includes(${JSON.stringify(name)}))`;
      await shot('group-create', async () => {
        if (!(await app.evaluate(`!!${groupRow}`))) {
          for (let i = 0; i < 240 && !groupLines.some(line => /^READY /.test(line)); i++) await sleep(500);
          if (!groupLines.some(line => /^READY /.test(line))) throw new Error('the group member never got ready (see .agent-runs/screens/group-peer.log)');
          if (!(await app.evaluate(contactRow(groupPeerName)))) {
            const botLine = await groupAsk('OPEN_BOT', /^BOT_CONTACT |_FAILED /, 150_000);
            if (!botLine || /_FAILED/.test(botLine)) throw new Error(`the group member could not open ${GROUP_BOT}: ${botLine}`);
            const sent = await groupAsk('REQUEST_OTHER', /^REQUEST_SENT |_FAILED /, 60_000);
            if (!sent || /_FAILED/.test(sent)) throw new Error(`the group member's request did not go out: ${sent}`);
            if (!(await app.waitFor(app.exists('[data-testid=new-requests]'), 120_000))) throw new Error(`no request from ${groupPeerName} arrived`);
            await app.click('[data-testid=new-requests]');
            const row = `[...document.querySelectorAll('[data-testid=incoming-request]')].find(r => r.textContent.includes(${JSON.stringify(groupPeerName)}))`;
            if (!(await app.waitFor(`!!${row}`, 120_000))) throw new Error(`no request from ${groupPeerName} in the list`);
            await app.evaluate(`${row}.click()`);
            await app.waitFor(app.exists('[data-testid=request-banner]'), 10_000);
            await app.clickText('[data-testid=request-banner] button', 'Accept');
            if (!(await groupAsk('WAIT_CONTACT', /^CONTACT /, 120_000))) throw new Error(`${groupPeerName} never saw the accept`);
            log('contact with', groupPeerName);
            await app.click('[aria-label="Back to chats"]');
          }
          if (!(await app.evaluate(contactRow(GROUP_BOT)))) {
            await app.click('[aria-label="New chat"]');
            await app.type('[aria-label=Search]', GROUP_BOT.split('.')[0]);
            const hit = `[...document.querySelectorAll('[data-testid=search-global-row]')].find(b => b.textContent.includes(${JSON.stringify(GROUP_BOT)}))`;
            if (!(await app.waitFor(`!!${hit}`, 90_000))) throw new Error(`${GROUP_BOT} not found by search`);
            await app.evaluate(`${hit}.click()`);
            await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
            await app.clickText('button', 'Send Request');
            if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(GROUP_BOT)} && ${app.exists('[aria-label=Send]')}`, 150_000))) {
              throw new Error(`${GROUP_BOT} did not accept the request`);
            }
            log('contact with', GROUP_BOT);
            await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
          }
        }
        await app.click('[aria-label="New chat"]');
        if (!(await app.waitFor(app.exists('[data-testid=new-group]'), 5_000))) throw new Error('no "New group" in the New chat panel');
        await app.click('[data-testid=new-group]');
        if (!(await app.waitFor(app.exists('[aria-label="Group name"]'), 5_000))) throw new Error('the New group view did not open');
        await app.type('[aria-label="Group name"]', GROUP_NAME);
        for (const name of [groupPeerName, GROUP_BOT]) {
          const box = `[...document.querySelectorAll('[data-testid=group-candidate]')].find(r => r.textContent.includes(${JSON.stringify(name)}))?.querySelector('[role=checkbox]')`;
          if (!(await app.evaluate(`!!${box}`))) throw new Error(`${name} is not among the contacts to pick`);
          await app.evaluate(`${box}.click(); true`);
        }
        if (!(await app.waitFor(`document.querySelectorAll('[data-testid=group-candidate] [role=checkbox][data-state=checked]').length === 2 && !document.querySelector('[data-testid=group-create]').disabled`, 5_000))) {
          throw new Error('the two members are not checked');
        }
      });
      await shot('room-group', async () => {
        if (!groupCreated) {
          if (!(await app.evaluate(app.exists('[data-testid=group-create]:not([disabled])')))) throw new Error('nothing to create');
          await app.click('[data-testid=group-create]');
          if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(GROUP_NAME)} && ${app.exists('[data-testid=group-status]')}`, 30_000))) throw new Error('the group room did not open');
          groupCreated = true;
          const joined = await groupAsk('WAIT_GROUP any', /^JOINED /, 120_000);
          if (!joined) throw new Error(`${groupPeerName} did not receive the roster (see .agent-runs/screens/group-peer.log)`);
          log('member joined:', joined);
          await app.type('textarea[aria-label=Message]', 'hello all');
          await app.click('[aria-label=Send]');
          await sleep(4_000);
          const said = await groupAsk(`SEND Hi! ${groupPeerName} here, ready for Saturday.`, /^SENT |_FAILED /, 60_000);
          if (!said || /_FAILED/.test(said)) throw new Error(`${groupPeerName} could not post: ${said}`);
        } else {
          // Leave "+" (Esc in the search field), then the New group view (Esc in the window).
          await app.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
          await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
          await app.evaluate(`document.activeElement?.blur(); true`);
          await app.key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
          if (!(await app.waitFor(`!!${groupRow}`, 10_000))) throw new Error('no group row in the chat list');
          await app.evaluate(`${groupRow}.click()`);
        }
        const peerText = `[...document.querySelectorAll('[data-testid=message-incoming]')].some(m => m.textContent.includes(${JSON.stringify(groupPeerName)}))`;
        if (!(await app.waitFor(peerText, 60_000))) throw new Error(`no message from ${groupPeerName} with its sender name`);
        // The bot's reply, if it runs group-aware code: a third sender name.
        const botText = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=sender-name]')].some(n => n.textContent === ${JSON.stringify(GROUP_BOT)}) && !document.querySelector('[data-testid=live-frame]')`;
        if (!(await app.waitFor(botText, theme === THEMES[0] ? 180_000 : 20_000))) missing.push(`${theme}/room-group.png: no reply from ${GROUP_BOT} (the bot may not run group-aware code yet); taken with two senders`);
        log('group senders:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=sender-name]')].map(n => n.textContent)`)));
        log('group header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=group-status]').textContent`)));
      });
      await shot(
        'group-members',
        async () => {
          if (!(await app.evaluate(app.exists('[data-testid=group-status]')))) throw new Error('the group room is not open');
          if (!(await app.evaluate(app.exists('[data-testid=members-panel]')))) await app.click('[data-testid=members-toggle]');
          if (!(await app.waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 10_000))) throw new Error('the members panel does not list three members');
          log('members:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=member-row]')].map(r => r.innerText.replace(/\\s+/g, ' '))`)));
          await app.settle();
          // Hover the member's row: the admin's Remove shows (design system §10).
          const box = await app.evaluate(
            `(() => { const r = [...document.querySelectorAll('[data-testid=member-row]')].find(e => e.textContent.includes(${JSON.stringify(groupPeerName)})).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          );
          await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y) });
          await sleep(500);
        },
        { now: true },
      );
      await app.evaluate(`document.querySelector('[aria-label="Close members"]')?.click(); true`);

      // M11b: the coin flip. The stake button and its strip; then the settlement.
      const flipTitle = `/^${FLIP_BOT}\\.\\d{2}$/.test(document.querySelector('[data-testid=room-title]')?.textContent ?? '')`;
      const stakeKeyboard = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=keyboard]')].filter(k => [...k.querySelectorAll('[data-action=tx]:not([disabled])')].some(b => b.textContent.includes('Stake'))).pop()`;
      const settledRef = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=tx-reference]')].filter(r => r.textContent.includes('Flip settled')).pop()`;
      await shot('room-flip', async () => {
        const flipRow = `[...document.querySelectorAll('[data-testid=chat-row]')].find(r => /${FLIP_BOT}\\.\\d{2}/.test(r.textContent))`;
        if (await app.evaluate(`!!${flipRow}`)) {
          await app.evaluate(`${flipRow}.click()`);
        } else {
          await app.click('[aria-label="New chat"]');
          await app.type('[aria-label=Search]', FLIP_BOT);
          if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=search-global-row]')].some(b => /${FLIP_BOT}\\.\\d{2}/.test(b.textContent))`, 90_000))) throw new Error(`${FLIP_BOT} not found by search`);
          await app.evaluate(`[...document.querySelectorAll('[data-testid=search-global-row]')].find(b => /${FLIP_BOT}\\.\\d{2}/.test(b.textContent)).click()`);
          await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
          await app.type('textarea[aria-label=Message]', 'Hi, I want to flip');
          await app.clickText('button', 'Send Request');
          log('request sent to', FLIP_BOT);
        }
        if (!(await app.waitFor(`${flipTitle} && ${app.exists('[aria-label=Send]')}`, 150_000))) throw new Error(`${FLIP_BOT} did not accept the request`);
        if (!(await app.waitFor(`${stakeKeyboard} != null`, 90_000))) {
          await app.type('textarea[aria-label=Message]', '/stake');
          await app.click('[aria-label=Send]');
          if (!(await app.waitFor(`${stakeKeyboard} != null`, 90_000))) throw new Error(`no Stake button from ${FLIP_BOT}`);
        }
        await app.evaluate(`${stakeKeyboard}.querySelector('[data-action=tx]').click(); true`);
        if (!(await app.waitFor(`['ready', 'refused'].includes(document.querySelector('[data-testid=tx-strip]')?.dataset.phase)`, 60_000))) throw new Error('the stake strip did not finish its dry-run');
        const strip = await app.evaluate(`document.querySelector('[data-testid=tx-strip]').innerText.replace(/\\s+/g, ' ')`);
        log('flip strip:', JSON.stringify(strip));
        if ((await app.evaluate(`document.querySelector('[data-testid=tx-strip]').dataset.phase`)) !== 'ready') throw new Error(`the dry-run refused the stake: ${strip}`);
        await app.evaluate(`document.querySelector('[data-testid=tx-strip]').scrollIntoView({ block: 'end' }); true`);
      });
      await shot('room-flip-done', async () => {
        if (!(await app.evaluate(flipTitle))) throw new Error('the flip room is not open');
        if (!flipSettled) {
          if (!(await app.evaluate(`document.querySelector('[data-testid=tx-strip]')?.dataset.phase === 'ready'`))) throw new Error('no stake strip to sign');
          const before = await app.evaluate(`document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]').length`);
          await app.click('[data-testid=tx-sign]');
          const own = `[...document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]')][${before}]`;
          if (!(await app.waitFor(`${own} != null && ['inBlock', 'finalized'].includes(${own}.dataset.status)`, 90_000))) throw new Error('the stake did not reach a block');
          log('stake:', JSON.stringify(await app.evaluate(`${own}.innerText`)));
          if (await app.waitFor(app.exists('[data-testid=bot-balance]'), 20_000)) log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=bot-balance]').textContent`)));
          // A stake already waiting (someone else's) settles with ours; else the second player stakes.
          if (!(await app.waitFor(`${settledRef} != null`, 15_000))) {
            const ready = await (async () => {
              for (let i = 0; i < 480 && !flipLines.some(line => /^READY /.test(line)); i++) await sleep(500);
              return flipLines.some(line => /^READY /.test(line));
            })();
            if (!ready) throw new Error('the second player never got ready (see .agent-runs/screens/flip-peer.log)');
            flipPeer.stdin.write('STAKE\n');
            log('second player stakes');
          }
          if (!(await app.waitFor(`${settledRef} != null`, 180_000))) throw new Error('no "Flip settled" reference from the bot (see .agent-runs/screens/flip-peer.log)');
          flipSettled = true;
        } else {
          // The second theme: the room as the first left it.
          await app.evaluate(`[...document.querySelectorAll('[data-testid=tx-strip] button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);
          if (!(await app.waitFor(`${settledRef} != null`, 30_000))) throw new Error('the settlement reference is gone');
        }
        log('settled:', JSON.stringify(await app.evaluate(`${settledRef}.innerText`)));
        await app.evaluate(`${settledRef}.scrollIntoView({ block: 'center' }); true`);
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

      // ── M7b: the unified search.
      const PIRATE = 'pcdpirate.81';
      const QUERY = 'pcdp';
      const ESC = ['Escape', 'Escape', { windowsVirtualKeyCode: 27 }];
      await shot('search', async () => {
        const pirateRow = `[...document.querySelectorAll('[data-testid=chat-row],[data-testid=chat-row-outgoing]')].some(r => r.textContent.includes(${JSON.stringify(PIRATE)}))`;
        if (!(await app.evaluate(pirateRow))) {
          // Once: a request to the pirate bot, sent from a global search hit.
          await app.click('[aria-label="New chat"]');
          await app.type('[aria-label=Search]', 'pcdpirate');
          const hit = `[...document.querySelectorAll('[data-testid=search-global-row]')].some(r => r.textContent.includes(${JSON.stringify(PIRATE)}))`;
          if (!(await app.waitFor(hit, 60_000))) {
            const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
            throw new Error(`${PIRATE} not found by the global search: ${JSON.stringify(seen)}`);
          }
          await app.clickText('[data-testid=search-global-row]', PIRATE);
          if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(PIRATE)} && ${app.exists('textarea[aria-label=Message]')}`, 10_000))) {
            throw new Error('the global hit did not open the draft room');
          }
          await app.type('textarea[aria-label=Message]', 'Ahoy from the desktop app');
          await app.clickText('button', 'Send Request');
          if (!(await app.waitFor(pirateRow, 60_000))) throw new Error(`the request to ${PIRATE} did not go out`);
          log('request sent to', PIRATE, 'from a global search hit');
        }
        // Once: a message that contains the query, in the room with the room peer.
        const peerRow = `[...document.querySelectorAll('[data-testid=chat-row]')].find(r => r.textContent.includes(${JSON.stringify(roomPeer)}))`;
        if (!(await app.evaluate(`!!${peerRow}`))) throw new Error(`no room with ${roomPeer}`);
        await app.evaluate(`${peerRow}.click()`);
        await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
        // The room's own "hello" first, so a message sent in the first theme is seen.
        await app.waitFor(`document.querySelectorAll('[data-testid=message-outgoing]').length > 0`, 10_000);
        const said = `[...document.querySelectorAll('[data-testid=message-outgoing]')].some(m => m.textContent.includes(${JSON.stringify(PIRATE)}))`;
        if (!(await app.evaluate(said))) {
          await app.type('textarea[aria-label=Message]', `Ask ${PIRATE} for a pirate joke`);
          await app.click('[aria-label=Send]');
          await app.waitFor(said, 10_000);
        }
        await app.key(...ESC);
        await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);
        await app.type('[aria-label=Search]', QUERY);
        // M10: a bot that sent botInfo (the pirate bot does since pca 70d8a87) is under Bots, not Chats.
        const ready = `(${app.exists('[data-testid=search-chats]')} || ${app.exists('[data-testid=search-bots]')}) && ${app.exists('[data-testid=search-messages]')} && [...document.querySelectorAll('[data-testid=search-global-row]')].some(r => r.textContent.includes(${JSON.stringify(BOT)})) && !document.querySelector('[data-testid=search-results]').textContent.includes('Searching…')`;
        if (!(await app.waitFor(ready, 60_000))) {
          const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
          throw new Error(`the three sections did not fill: ${JSON.stringify(seen)}`);
        }
        // ↓ twice: from the pirate row (Chats, or Bots since M10) into the first global row.
        await app.key('ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
        await app.key('ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
        if (!(await app.waitFor(`document.querySelector('[data-highlighted=true]')?.dataset && document.querySelector('[data-highlighted=true] [data-testid=search-global-row]') != null`, 5_000))) {
          throw new Error('↓↓ did not highlight the first global row');
        }
      });

      // A message hit opens its room at that message and highlights it for
      // 1.5 s; search-jump.png is taken inside that time.
      await shot('search-jump', async () => {
        await app.click('[data-testid=search-message]');
        if (!(await app.waitFor(app.exists('[data-message-id].bg-selection-container-active'), 10_000))) throw new Error('no highlighted message after the jump');
        const text = await app.evaluate(`document.querySelector('[data-message-id].bg-selection-container-active').textContent`);
        log('jumped to the message hit, highlighted:', JSON.stringify(text.slice(0, 60)));
      }, { now: true }); // at once: the highlight lasts 1.5 s
      if (await app.waitFor(`!document.querySelector('[data-message-id].bg-selection-container-active')`, 5_000)) log('the highlight ended');
      else missing.push(`${theme}: the message highlight did not end`);

      // "Show more" fetches the next page of the global search (first theme only: the backend rate-limits).
      await app.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
      await app.key(...ESC);
      if (theme === THEMES[0]) {
        try {
          await app.type('[aria-label=Search]', 'pcd');
          if (!(await app.waitFor(app.exists('[data-testid=search-show-more]'), 60_000))) throw new Error('no Show more for "pcd"');
          const before = await app.evaluate(`document.querySelectorAll('[data-testid=search-global-row]').length`);
          await app.click('[data-testid=search-show-more]');
          if (!(await app.waitFor(`document.querySelectorAll('[data-testid=search-global-row]').length > ${before}`, 60_000))) {
            const seen = await app.evaluate(`document.querySelector('[data-testid=search-global]')?.innerText ?? 'no global section'`);
            throw new Error(`Show more added no rows: ${JSON.stringify(seen)}`);
          }
          const after = await app.evaluate(`document.querySelectorAll('[data-testid=search-global-row]').length`);
          log(`global search "pcd": ${before} rows, ${after} after Show more`);
        } catch (error) {
          missing.push(`${theme}: Show more (${error.message})`);
        }
        await app.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
        await app.key(...ESC);
      }

      await shot('search-empty', async () => {
        // The search is clear; Esc in the field now closes the room.
        await app.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
        await app.key(...ESC);
        await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);
        await app.click('[aria-label="New chat"]');
        if (!(await app.waitFor(`document.querySelector('[aria-label=Search]').placeholder === 'Type username' && document.activeElement === document.querySelector('[aria-label=Search]') && ${app.exists('[data-testid=search-results]')}`, 5_000))) {
          throw new Error('"+" did not focus the search field');
        }
      });

      await shot('search-no-results', async () => {
        await app.type('[aria-label=Search]', 'qxzqxzq');
        if (!(await app.waitFor(app.exists('[data-testid=search-no-results]'), 30_000))) {
          const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
          throw new Error(`no "No results" line: ${JSON.stringify(seen)}`);
        }
      });
      await app.key(...ESC);

      await shot('search-bots', async () => {
        await app.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
        await app.type('[aria-label=Search]', 'test');
        const both = `[...document.querySelectorAll('[data-testid=search-bot-row]')].length >= 2`;
        if (!(await app.waitFor(`${both} && !document.querySelector('[data-testid=search-results]').textContent.includes('Searching…')`, 60_000))) {
          const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
          throw new Error(`the Bots section did not show both bots: ${JSON.stringify(seen)}`);
        }
        log('bots:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=search-bot-row]')].map(r => r.innerText.replace(/\\s+/g, ' '))`)));
        log('sections:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=search-results] section')].map(s => s.getAttribute('aria-label'))`)));
      });
      await app.key(...ESC);

      await shot('faucet', async () => {
        await app.key(...ESC);
        if (!(await app.waitFor(app.exists('[data-testid=chat-row-faucet]'), 10_000)) || !(await app.click('[data-testid=chat-row-faucet]'))) {
          const pane = await app.evaluate(`document.querySelector('aside')?.innerText.slice(0, 300) ?? 'no left pane'`);
          throw new Error(`no Faucet row in the chat list: ${JSON.stringify(pane)}`);
        }
        if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === 'Faucet' && ${app.exists('[data-testid=keyboard]')}`, 10_000))) {
          throw new Error('the Faucet room did not open with its keyboard');
        }
        // M12: "Get 1 PAS" is the embedded Faucet's own transfer: pending row, reference, balance (first theme only: one drip per run).
        if (theme === THEMES[0]) {
          const dripButton = `[...document.querySelectorAll('[data-testid=keyboard] [data-action=command]')].find(b => b.textContent.includes('Get 1 PAS'))`;
          await app.evaluate(`${dripButton}.click(); true`);
          if (!(await app.waitFor(`${app.exists('[data-testid=live-frame]')} && ${dripButton}.getAttribute('aria-busy') === 'true'`, 10_000))) throw new Error('"Get 1 PAS" shows no pending row or spinner');
          await app.evaluate(`${dripButton}.click(); true`);
          await sleep(500);
          if ((await app.evaluate(`document.querySelectorAll('[data-testid=live-frame]').length`)) !== 1) missing.push(`${theme}: a second "Get 1 PAS" press stacked a row`);
          const ended = `[...document.querySelectorAll('[data-testid=message-system]')].some(r => /Balance now|did not answer|empty|Try again|devnet/.test(r.textContent))`;
          if (!(await app.waitFor(ended, 120_000))) throw new Error('the Faucet room shows no outcome of "Get 1 PAS"');
          if (!(await app.evaluate(`[...document.querySelectorAll('[data-testid=message-system]')].some(r => /Balance now/.test(r.textContent))`))) {
            missing.push(`${theme}/faucet.png: "Get 1 PAS" did not end with a balance`);
          }
          log('faucet room:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=messages]').innerText.replace(/\\s+/g, ' ').slice(-240)`)));
        }
        await app.evaluate(`document.querySelector('[data-testid=keyboard] [data-action=url]').click(); true`);
        if (!(await app.waitFor(app.exists('[data-testid=url-confirm]'), 5_000))) throw new Error('no confirm strip for "Get test funds"');
        log('faucet strip:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=url-confirm]').textContent`)));
      });
      // Leave the strip unanswered: Open would start the browser.
      await app.key(...ESC);
      await app.waitFor(app.exists('[data-testid=new-requests]'), 5_000);

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
  flipPeer.stdin.write('EXIT\n');
  flipPeer.kill('SIGTERM');
  groupPeer.stdin.write('EXIT\n');
  groupPeer.kill('SIGTERM');
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
