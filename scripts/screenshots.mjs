#!/usr/bin/env node
// Screenshots: builds the app, drives it over the Chrome DevTools protocol
// against throwaway profiles, and saves 1280×800 PNGs of every screen in
// Berlin Day and Berlin Night to .agent-runs/screens/<theme>/<name>.png.
//
// M12h (owner ask 2026-09-24: a full pass under 3 minutes, one shot in
// seconds). Three rules:
//  1. Both themes from one state. Each state is reached once; the shot is
//     taken, the `data-theme` attribute switched (what theme.ts setTheme
//     does, no reload), and the shot taken again. No flow runs twice.
//  2. Fixtures for UI states. Rooms, keyboards, reference bubbles (failed,
//     finalized, in block, submitted), request and paid bubbles, the seen
//     tick, the tombstone, the live frame, the incoming request, the
//     Assistant's reply and the Diagnostics counts are rows written into the
//     throwaway profile (fictional contacts with made-up devices, never
//     contacted on the network) or counts given to the main process. No
//     chain, no bot. Chain reads that a shot shows stay live (dry-runs, the
//     Meter balance, the Pocket, the paid check).
//  3. Parallel live flows. Only shots that prove a live flow keep the
//     network: the coin flip and the Faucet drip, the group of three and the
//     local "working…" of a bot. They run at the same time as the fixture
//     shots, each in its own headless app with its own identity and profile:
//
//     worker  identity                          shots
//     signup  a fresh profile                   signup
//     main    PCD_SCREENSHOT_IDENTITY (path,    everything else
//             default .agent-runs/identity-pcde2e/identity.json)
//     flip    PCD_SCREENSHOT_FLIP_IDENTITY      faucet, room-flip, room-flip-done
//             (name, default pcdbenchzzlx) + the second player
//             PCD_SCREENSHOT_FLIP_WITH (default pcdeceb, e2e-flip.mjs --role b)
//     group   PCD_SCREENSHOT_GROUP_IDENTITY     group-create, room-group,
//             (name, default pcdbenchqmwk) +    group-members, room-typing
//             the member PCD_SCREENSHOT_GROUP_WITH (default pcdbenchfina,
//             e2e-group.mjs --role b) and the bot pcdguide.70
//
// The shots (main worker unless named above):
//   signup          the sign-up screen of a fresh profile, a username typed
//   chats           the list at rest with a "Draft:" left in the Assistant
//   room            the Staking Helper bot's room (fixture): an echo with a
//                   👍, the room muted (the list shows the icon)
//   room-deleted    a tombstone and the bot's live frame
//   room-buttons    a spec 0006 keyboard (callback, command, url, a reserved
//                   tx); the url button pressed: its confirm strip. The
//                   callback is not pressed: it would send to a fictional
//                   device (M12h, docs/decisions.md)
//   room-bot        badge, description, greeting, the "/" command menu
//   room-seen       the seen tick hovered: "Seen <time>"
//   room-tx         a tx button pressed: the signing strip after a real
//                   dry-run (0.01 PAS to yourself), Sign enabled; not signed
//   room-tx-done    the reference bubbles: failed, finalized with its action
//                   row, in block, submitted; the Meter balance in the header
//   room-typing     (group) the local "working…" after a message to pcdguide.70
//   pocket          the Pocket: both balances, the address, its QR
//   group-create    (group) "+" → New group, the name typed, both checked
//   room-group      (group) "hello all", the member's answer, the bot's reply
//   group-members   (group) the members panel, the member's row hovered
//   room-flip       (flip) the "Stake 0.5 PAS" signing strip after its dry-run
//   room-flip-done  (flip) signed; the second player stakes; "Flip settled"
//   faucet          (flip) "Get 1 PAS" ended with a balance; the url strip
//   assistant       the Assistant's room with a markdown reply (fixture)
//   search          "pcdp": Chats (the pirate bot, a request sent from a
//                   global hit, live), Global, Messages; ↓↓ on a global row
//   search-jump     a message hit opened and highlighted (1.5 s)
//   search-empty    "+" with the empty field; search-no-results; search-bots
//                   ("test": the Faucet and the fixture bot under Bots)
//   requests        an incoming request (fixture) opened: Accept, Decline
//   settings        Chat and Assistant sections after "Detect installed"
//   settings-diagnostics  the counts (fixture counts in the main process)
//   keyboard        the shortcuts section
//   chat-menu archived settings-privacy   M12e chat management (fixture)
//   room-meter      M12f the Meter header with its tooltip (live balance)
//   send-pas room-request room-request-paid   M12g payments (fixture; paid
//                   is checked on the chain from .agent-runs/pay-last.json)
//   demo-onboarding settings-demo   M12i demo bots (fixture requests)
//   room-group2     M16 a private group (spec 0011, fixture): epoch 2 and
//                   "one statement per message" in the header, the removal notice
//   group2-members  M16 its members panel: owner/admin/member, Remove hovered
//   group-invite    M16b the same panel scrolled to "Asking to join" (a join
//                   request by link: Approve, Reject), the invite link and settings
//   group-roles     M16b an admin's role and flags opened inline in the panel
//   room-pinned     M16b the pin bar at the top of the room
//   room-attachment M15a images on Bulletin (fixture): a received photo with a
//                   caption and Open / Save…, a sent one, one still
//                   downloading (blurhash), one of ours storing chunk 1 of 2
//   composer-attach M15a an image picked with the Paperclip: the attach row,
//                   its size, Remove, the first-attachment notice, a caption
//   room-file       M15b files (fixture): a received PDF not yet downloaded
//                   ("Download · 2.2 MB") and a sent ZIP with Open / Save…
//   room-album      M15b albums (fixture): a received album of 4 and a sent
//                   one of 3, one caption each, in grid bubbles
//   room-voice      M15b voice notes (fixture bytes recorded in the page by
//                   MediaRecorder, WebM/Opus): a received one playing
//                   (progress on the waveform) and a sent one
//   room-video      M15c videos (fixture bytes recorded in the page from a
//                   canvas by MediaRecorder, WebM/VP8): a received one not yet
//                   downloaded (poster, duration, Download) and a sent one in
//                   the inline player; an expired file with "Ask to resend";
//                   the peer's "Please resend" with our "Resend the photo"
//   settings-storage  M15c Settings › Storage: the Bulletin authorization
//                   left (live read on devnet), uploads today (fixture count)
//                   against the daily share, local copies, Free space
//   settings-agent  M13 Settings › Agent, published for real on devnet with
//                   PCD_SCREENSHOT_AGENT_IDENTITY (a path, default
//                   .agent-runs/identity-pcdbenchcold/identity.json) as the
//                   agent's own identity: the switch on, the username, the log
//
// Every variable is an optional override; with none set the workers use the
// defaults above (the identities live in .agent-runs/identity-<name>/):
//   PCD_SCREENSHOT_IDENTITY        main worker, a path to identity.json
//   PCD_SCREENSHOT_FLIP_IDENTITY   flip worker, a name (pcdbenchzzlx)
//   PCD_SCREENSHOT_FLIP_WITH       second flip player, a name (pcdeceb)
//   PCD_SCREENSHOT_GROUP_IDENTITY  group worker, a name (pcdbenchqmwk)
//   PCD_SCREENSHOT_GROUP_WITH      group member, a name (pcdbenchfina)
//   PCD_SCREENSHOT_ENGINE          the Assistant's engine in the profile (claude)
//   PCD_SCREENSHOT_AGENT_IDENTITY  settings-agent, a path to the agent's identity.json (pcdbenchcold)
//   PCD_SCREENSHOT_PORT            first CDP port (the workers use it and the three after it); unset: a free port per app
//
//   npm run screenshots
//   npm run screenshots -- --only room-tx-done,chat-menu
//
// `--only a,b` takes only those shots and starts only the workers they need.
// Headless by default (PCD_HEADLESS=1: hidden window, no dock icon, no
// focus) with a throwaway PCD_USER_DATA_DIR per app; `--visible` shows the
// windows. Each app gets a free debugging port, checked before launch (a fixed
// port once drove another agent's app); PCD_SCREENSHOT_PORT fixes them instead.
// What cannot be captured is reported and the exit code is 1. The time of the
// whole pass is printed with the result. Prints no secret.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { debugPort, portAnswers } from './lib/app.mjs';
import { drawScene, shrink } from './lib/testImage.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronBin = join(root, 'node_modules/.bin/electron');
const outDir = join(root, '.agent-runs/screens');
const THEMES = ['berlin-day', 'berlin-night'];
const WIDTH = 1280;
const HEIGHT = 800;
const BASE_PORT = process.env.PCD_SCREENSHOT_PORT ? Number(process.env.PCD_SCREENSHOT_PORT) : null;
/** Worker `n`'s debugging port: PCD_SCREENSHOT_PORT + n when set, else a free one. */
const portFor = async n => (BASE_PORT === null ? debugPort() : BASE_PORT + n);
// The check runs with no PCD_SCREENSHOT_* set: each worker has a default test identity.
const identitySource = process.env.PCD_SCREENSHOT_IDENTITY ?? join(root, '.agent-runs', 'identity-pcde2e', 'identity.json');
const engine = process.env.PCD_SCREENSHOT_ENGINE ?? 'claude';
const flipIdentity = process.env.PCD_SCREENSHOT_FLIP_IDENTITY ?? 'pcdbenchzzlx';
const flipWith = process.env.PCD_SCREENSHOT_FLIP_WITH ?? 'pcdeceb';
const groupIdentity = process.env.PCD_SCREENSHOT_GROUP_IDENTITY ?? 'pcdbenchqmwk';
const groupWith = process.env.PCD_SCREENSHOT_GROUP_WITH ?? 'pcdbenchfina';
// M13 settings-agent: a test identity published as the agent's own (never the seeded person's).
const agentIdentitySource = process.env.PCD_SCREENSHOT_AGENT_IDENTITY ?? join(root, '.agent-runs', 'identity-pcdbenchcold', 'identity.json');
const BOT = 'pcdpeer.47';
const FLIP_BOT = 'pcdflip';
const GROUP_BOT = 'pcdguide.70';
const GROUP_NAME = 'Weekend crew';
const DRAFT = 'Ask about the People chain later';
const headlessEnv = process.argv.includes('--visible') ? {} : { PCD_HEADLESS: '1' };

const WORKER_SHOTS = {
  signup: ['signup'],
  main: [
    'chats', 'room', 'room-deleted', 'room-buttons', 'room-bot', 'room-seen', 'room-tx', 'room-tx-done', 'pocket', 'assistant',
    'search', 'search-jump', 'search-empty', 'search-no-results', 'search-bots', 'requests', 'settings', 'settings-diagnostics', 'keyboard',
    'chat-menu', 'archived', 'settings-privacy', 'room-meter', 'room-request', 'send-pas', 'room-request-paid', 'room-group2', 'group2-members',
    'group-invite', 'group-roles', 'room-pinned',
    'settings-agent', 'demo-onboarding', 'settings-demo',
    'room-attachment', 'composer-attach', 'room-file', 'room-album', 'room-voice', 'room-video', 'settings-storage',
  ],
  flip: ['faucet', 'room-flip', 'room-flip-done'],
  group: ['group-create', 'room-group', 'group-members', 'room-typing'],
};
const ALL_SHOTS = Object.values(WORKER_SHOTS).flat();

// --only a,b (or --only=a,b): capture only these shots.
const onlyArg = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);
const only = onlyArg ? new Set(onlyArg.split(',').map(name => name.trim().replace(/\.png$/, '')).filter(Boolean)) : null;
const wanted = name => only === null || only.has(name);
if (only) {
  const unknown = [...only].filter(name => !ALL_SHOTS.includes(name));
  if (unknown.length > 0) {
    console.error(`unknown shot(s) for --only: ${unknown.join(', ')}`);
    process.exit(2);
  }
}
const needs = worker => WORKER_SHOTS[worker].some(wanted);

const sleep = ms => new Promise(done => setTimeout(done, ms));
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const logger = tag => (...parts) => console.log(elapsed(), `[${tag}]`, ...parts);
const missing = [];
const saved = [];
/** A shot that failed: both themes, since both come from the one state. */
const miss = (name, why) => {
  for (const theme of THEMES) missing.push(`${theme}/${name}.png (${why})`);
};

// ── Build ────────────────────────────────────────────────────────────────

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (build.status !== 0) {
  console.error('build failed');
  process.exit(1);
}
console.log(elapsed(), 'built');
for (const theme of THEMES) mkdirSync(join(outDir, theme), { recursive: true });

// ── One app run over CDP ─────────────────────────────────────────────────

const launch = async (profile, port, log) => {
  // Another app on this port would be driven instead of ours.
  if (await portAnswers(port)) throw new Error(`port ${port} is taken`);
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, ...headlessEnv, PCD_USER_DATA_DIR: profile },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(entry => entry.type === 'page');
    } catch {
      // not listening yet
    }
  }
  if (!target) {
    child.kill('SIGTERM');
    throw new Error(`no CDP target on port ${port}`);
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
      await sleep(150);
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
  const key = async (keyName, code, extra = {}) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, ...extra });
  };
  const esc = () => key('Escape', 'Escape', { windowsVirtualKeyCode: 27 });
  /** Empties a React-controlled field the way a person would: select all, delete. */
  const clearField = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key('a', 'KeyA', { modifiers: 4, commands: ['selectAll'] });
    await key('Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
  };
  const settle = async () => {
    await evaluate('document.fonts.ready.then(() => true)');
    await sleep(500);
  };
  /** What theme.ts setTheme does: the stored choice and the attribute. The page repaints in place. */
  const applyTheme = async theme => {
    await evaluate(`localStorage.setItem('pds-theme', ${JSON.stringify(theme)}); document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); true`);
    // One paint with the new colours (React re-renders the Toaster's tone).
    await sleep(120);
  };
  const reload = async ready => {
    await evaluate('location.reload(); true');
    await sleep(600);
    if (ready && !(await waitFor(ready, 60_000))) throw new Error('the app did not come back after a reload');
  };
  /**
   * Both themes of the current state (M12h rule 1). `hover`: the pointer is
   * part of the state (a tooltip), so it is not parked in the corner.
   */
  const captureBoth = async (name, { hover = false } = {}) => {
    if (!hover) {
      await settle();
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: HEIGHT - 1 });
      await sleep(150);
    }
    // Colour transitions would catch a button half-way between the themes: off while the attribute flips.
    await evaluate(`(() => { const style = document.createElement('style'); style.id = 'pcd-shots-still'; style.textContent = '*, *::before, *::after { transition: none !important; }'; document.head.append(style); return true; })()`);
    try {
      for (const theme of THEMES) {
        await applyTheme(theme);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(outDir, theme, `${name}.png`);
        writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
        saved.push(file);
      }
    } finally {
      await evaluate(`document.getElementById('pcd-shots-still')?.remove(); true`);
    }
    log('saved', name);
  };
  /** Runs `prepare`, then captures both themes; a failure is recorded and the worker goes on. */
  const shot = async (name, prepare, options) => {
    if (!wanted(name)) return;
    try {
      await prepare();
      await captureBoth(name, options);
    } catch (error) {
      miss(name, error.message);
      log('missed', `${name}:`, error.message);
    }
  };
  const hoverAt = async selector => {
    const box = await evaluate(`(() => { const r = ${selector}?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`);
    if (!box) throw new Error('nothing to hover');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 20, y: box.y });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  };
  /** Presses the mouse on an element (Radix menus open on pointer down, not on click()). */
  const pressOn = async selector => {
    const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (!rect) throw new Error(`nothing at ${selector}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };
  const quit = async () => {
    ws.close();
    child.kill('SIGTERM');
    await new Promise(done => (child.exitCode !== null ? done() : child.once('exit', done)));
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete'`, 30_000);
  await applyTheme(THEMES[0]);
  return { evaluate, waitFor, exists, click, clickText, type, key, esc, clearField, settle, reload, captureBoth, shot, hoverAt, pressOn, quit, send };
};

/** Opens the chat row whose text includes `name`; the room's title must then read `title` (default `name`). */
const openRow = async (app, name, title = name) => {
  const row = `[...document.querySelectorAll('[data-testid=chat-row]')].find(r => r.textContent.includes(${JSON.stringify(name)}))`;
  if (!(await app.waitFor(`!!${row}`, 30_000))) throw new Error(`${name} is not in the list`);
  await app.evaluate(`${row}.click(); true`);
  if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(title)}`, 20_000))) throw new Error(`the room with ${name} did not open`);
};

// ── Profiles with an identity ────────────────────────────────────────────

const identityFile = name => join(root, '.agent-runs', `identity-${name}`, 'identity.json');

/**
 * Writes `target` in `profile` from `source` (a plain identity.json), the
 * mnemonic encrypted with safeStorage by a tiny Electron script. M13: also
 * the agent's own identity file (`agent/identity.json`).
 */
const seedIdentityFile = async (profile, source, target) => {
  const seedScript = join(profile, 'seed.mjs');
  writeFileSync(
    seedScript,
    `import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
app.setName('polkadot-chat-desktop');
app.setPath('userData', process.env.SEED_PROFILE);
if (process.env.PCD_HEADLESS === '1') app.dock?.hide();
app.whenReady().then(() => {
  const src = JSON.parse(readFileSync(process.env.SEED_SOURCE, 'utf8'));
  const file = { version: 1, username: src.username, accountHex: src.accountHex, profile: src.profile,
    mnemonicEncrypted: safeStorage.encryptString(src.mnemonic).toString('base64') };
  writeFileSync(process.env.SEED_TARGET, JSON.stringify(file, null, 2) + '\\n', { mode: 0o600 });
  app.exit(0);
});
`,
  );
  const status = await new Promise(done => {
    const child = spawn(electronBin, [seedScript], {
      env: { ...process.env, ...headlessEnv, PCD_USER_DATA_DIR: profile, SEED_PROFILE: profile, SEED_SOURCE: resolve(source), SEED_TARGET: target },
      stdio: 'ignore',
    });
    child.once('exit', done);
  });
  rmSync(seedScript);
  if (status !== 0 || !existsSync(target)) throw new Error(`seeding ${source} failed`);
};

/**
 * A throwaway profile holding `source` (a plain identity.json from the Node
 * scripts). A tiny Electron script encrypts its mnemonic with safeStorage, as
 * the app would have. Same app name as a dev run (src/main/index.ts), so
 * safeStorage uses the same keychain entry; only the profile is written.
 */
const seededProfile = async source => {
  const profile = mkdtempSync(join(tmpdir(), 'pcd-shots-'));
  await seedIdentityFile(profile, source, join(profile, 'identity.json'));
  // The Assistant's engine, as Settings would write it (tools off).
  writeFileSync(
    join(profile, 'assistant.json'),
    `${JSON.stringify({ version: 1, model: 'auto/deepseek-v4.1-flash', baseUrl: 'https://llm.substrate.dev', keyEncrypted: null, engine, tools: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return profile;
};

/** A seeded app on the chat screen, connected. */
const openSeeded = async (source, port, log) => {
  const profile = await seededProfile(source);
  const app = await launch(profile, port, log);
  if (!(await app.waitFor(app.exists('[data-testid=username]'), 60_000))) {
    await app.quit();
    throw new Error('the chat screen did not open');
  }
  return { app, profile };
};

const connected = app => app.waitFor(`document.querySelector('[data-testid=connection-status]')?.textContent === 'Connected'`, 60_000);

// ── Fixture rows (M12h rule 2) ───────────────────────────────────────────

/**
 * Writes rows into the app's IndexedDB. Binary fields travel as
 * `{ $bytes: [..] }` or `{ $fill: [length, byte] }` and become Uint8Arrays
 * in the page. Dexie does not see writes made outside it: reload afterwards.
 */
const writeRows = (app, stores, remove = {}) =>
  app.evaluate(`new Promise((done, fail) => {
    const stores = ${JSON.stringify(stores)};
    const remove = ${JSON.stringify(remove)};
    const revive = value => {
      if (Array.isArray(value)) return value.map(revive);
      if (value && typeof value === 'object') {
        if (value.$bytes) return new Uint8Array(value.$bytes);
        if (value.$fill) return new Uint8Array(value.$fill[0]).fill(value.$fill[1]);
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
      }
      return value;
    };
    const names = [...new Set([...Object.keys(stores), ...Object.keys(remove)])];
    const open = indexedDB.open('polkadot-chat-web');
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(names, 'readwrite');
      for (const [name, rows] of Object.entries(stores)) for (const row of rows) tx.objectStore(name).put(revive(row));
      for (const [name, keys] of Object.entries(remove)) for (const key of keys) tx.objectStore(name).delete(key);
      tx.oncomplete = () => { open.result.close(); done(true); };
      tx.onerror = () => fail(tx.error);
    };
  })`);

const bytes = array => ({ $bytes: Array.from(array) });
const fill = (length, byte) => ({ $fill: [length, byte] });
const account = byte => `0x${byte.repeat(32)}`;
/** One made-up device: the header shows no "no device" warning. Nothing is ever sent to it. */
const madeUpDevices = [{ statementAccountId: fill(32, 8), encryptionPublicKey: fill(32, 9) }];
const contactRow = (p, devices = madeUpDevices) => ({
  accountId: p.account,
  username: p.username,
  ...(p.nickname ? { nickname: p.nickname } : {}),
  chatPublicKey: fill(32, 7),
  devices,
  createdAt: p.at,
  updatedAt: p.at,
});
// Unread 0 in every room a shot opens: opening it then sends no read receipt.
const roomRow = (p, preview, last, extra = {}) => ({ peerAccountId: p.account, unreadCount: 0, lastMessageAt: last, lastPreview: preview, createdAt: p.at, updatedAt: p.at, ...extra });
const messageRow = (id, p, at, direction, content, extra = {}) => ({
  messageId: id,
  peerAccountId: p.account,
  timestamp: at,
  direction,
  status: direction === 'outgoing' ? 'delivered' : 'received',
  content,
  reactions: [],
  editedAt: null,
  ...extra,
});

const GENESIS = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
const METER_HINT = {
  chainId: GENESIS,
  contract: '0x30b0c001431a1addb8c11a060ada4d6a7033cf21',
  selector: '0x70a08231',
  decimals: 18,
  unit: 'PAS',
  perReply: '100000000000000000',
  label: 'with Meter',
};

/** M12e chat management: fictional contacts with no device, a pending request, two blocked. */
const MANAGE = (() => {
  const day = 24 * 3_600_000;
  const now = Date.now();
  return {
    contacts: [
      { account: account('a1'), username: 'mayablue.12', nickname: 'Maya (design)', text: 'The new icons are in the shared folder.', at: now - 20 * 60_000, unread: 2 },
      { account: account('a2'), username: 'noahgreen.34', text: 'Lunch on Friday?', at: now - 3 * 3_600_000, pinnedAt: now - 2 * day },
      { account: account('a3'), username: 'ivyreed.56', text: 'Thanks, all sorted.', at: now - 2 * day, archived: true },
      { account: account('a4'), username: 'leoashby.78', text: 'See you at the meetup.', at: now - 4 * day, archived: true, unread: 1 },
    ],
    outgoing: { requestId: 'fixture-request-silentbot', account: account('a5'), username: 'silentbot.21', at: now - 3 * day - 3_600_000 },
    blocked: [
      { accountId: account('b1'), username: 'spamking.99', blockedAt: now - 3_600_000 },
      { accountId: account('b2'), username: 'promobot.11', blockedAt: now - 5 * day },
    ],
  };
})();

/** M12f: a meter bot whose botInfo carries the real Meter hint with 0.2 PAS pending. */
const METER = {
  account: account('c7'),
  username: 'meterbot.07',
  at: Date.now() - 5 * 60_000,
  info: {
    kind: 0,
    name: 'Meter bot',
    description: 'Pay per reply, 0.1 PAS each',
    greeting: 'Hi! Each answer costs 0.1 PAS from your balance with Meter.',
    commands: [{ name: 'balance', description: 'Your balance' }, { name: 'topup', description: 'Add 1 PAS' }],
    version: 2,
    balance: { ...METER_HINT, pending: '200000000000000000' },
  },
};

/**
 * The room peer of the room shots: a fictional bot (spec 0008 kind 1) with
 * the Meter hint, as `e2e-chat.mjs --botinfo --tx` used to describe itself.
 * Its username has "test" in it, so search-bots finds it.
 */
const HELPER = {
  account: account('e1'),
  username: 'testnetguide.42',
  at: Date.now() - 50 * 60_000,
  info: {
    kind: 1,
    name: 'Staking Helper',
    description: 'Answers staking questions and checks your rewards',
    greeting: 'Hi! I explain staking on Polkadot. Type / to see what I can do.',
    commands: [
      { name: 'staking', description: 'How staking works' },
      { name: 'rewards', description: 'Your rewards this era' },
      { name: 'validators', description: 'Pick validators to nominate' },
      { name: 'start', description: 'Start over' },
      { name: 'help', description: 'What I can do' },
    ],
    version: 3,
    balance: METER_HINT,
  },
};
const PIRATE = 'pcdpirate.81';
const SEEN_TEXT = 'Did you see this?';
const TX_NOTE = 'Send to yourself (0.01 PAS)';

/**
 * M16: a private group (spec 0011) in epoch 2 after the owner removed a
 * member. Fictional people; the key is a fixed fake, so nothing on its topic
 * ever opens. Fixture only: the live two-person-and-bot run is e2e:group2.
 */
const GROUP2 = {
  id: 'fixture-group2',
  name: 'Hiking club',
  at: Date.now() - 45 * 60_000,
  lena: { account: account('f1'), username: 'lenahart.31', at: Date.now() - 2 * 3_600_000 },
  tom: { account: account('f2'), username: 'tomfox.18' },
  // M16b: someone who opened the invite link and waits for approval.
  maya: { account: account('f3'), username: 'mayabrook.44' },
};
const group2Fixture = self => {
  const g = GROUP2;
  const t = step => g.at + step * 60_000;
  const peer = `group:${g.id}`;
  const entry = (who, role, permissions) => ({ account: who.account, role, permissions, posting: [], joinedAt: t(0) });
  const state = {
    groupId: g.id, epoch: 2, version: 5, name: g.name, defaultPermissions: 1, slowModeSecs: 0, joinPolicy: 1, historyShare: 100,
    members: [entry(self, 2, 0xff), entry(g.lena, 1, 0x13), entry(HELPER, 0, 0x01)],
    invites: [{ inviteId: fill(16, 0x21), secret: fill(16, 0x22), createdBy: self.account, expiresAt: 0, maxUses: 0, uses: 0 }],
    pinned: ['fixture-group2-plan'], createdAt: t(0),
  };
  const say = (id, step, who, text, extra = {}) => ({
    messageId: `fixture-group2-${id}`, peerAccountId: peer, groupId: g.id, timestamp: t(step), direction: who ? 'incoming' : 'outgoing',
    status: who ? 'received' : 'sent', content: { type: 'text', text }, reactions: [], editedAt: null, ...(who ? { senderAccountId: who.account } : {}), ...extra,
  });
  const event = (id, step, text) => ({ messageId: `fixture-group2-${id}`, peerAccountId: peer, groupId: g.id, timestamp: t(step), direction: 'system', status: 'received', content: { type: 'groupEvent', text }, reactions: [], editedAt: null });
  const messages = [
    event('created', 0, `You created ${g.name}`),
    say('plan', 1, g.lena, 'Saturday at 9 at the trailhead?'),
    say('ok', 2, null, 'Works for me. Who brings the map?', { reactions: [{ emoji: '👍', by: 'peer' }] }),
    say('bot', 3, HELPER, 'Sunrise is at 7:12 on Saturday and the forecast is dry.'),
    event('removed', 5, `You removed ${g.tom.username}`),
    event('pinned', 5.5, 'You pinned a message'),
    say('map', 6, null, 'I have the map.'),
    say('see', 7, g.lena, 'Great, see you there!'),
  ];
  return {
    group: {
      id: g.id, name: g.name, admin: self.account,
      members: [
        { account: self.account, username: self.username, joinedAt: t(0) },
        { account: g.lena.account, username: g.lena.username, joinedAt: t(0) },
        { account: HELPER.account, username: HELPER.username, joinedAt: t(0) },
      ],
      version: 3, createdAt: t(0), self: 'member', left: [], invites: [], nextSeq: 1, lastSeq: {}, gapNoted: false, updatedAt: t(7),
      v: 2, epoch: 2, state, stateBytes: fill(8, 0), stateSigner: self.account,
      keys: [{ epoch: 2, key: fill(32, 0x42), openedAt: t(5), erasesAt: null, signer: self.account }],
      carry: [], pendingWelcome: null, locked: false, seenIds: [], senders: [], lastSentAt: 0, rotateAt: null,
      joinRequests: [{ account: g.maya.account, username: g.maya.username, inviteId: fill(16, 0x21), note: '', at: t(7) }],
    },
    room: { peerAccountId: peer, groupId: g.id, unreadCount: 0, lastMessageAt: t(7), lastPreview: 'Great, see you there!', createdAt: t(0), updatedAt: t(7) },
    messages,
  };
};

/** An incoming request from a fictional person (requests.png). Never answered. */
const ASKER = { requestId: 'fixture-request-incoming', account: account('d7'), username: 'orbitfan.64', at: Date.now() - 12 * 60_000 };

/**
 * Every fixture row of the main worker, written once before the first shot.
 * `txIntent`: a real transfer of 0.01 PAS from the seeded identity to
 * itself, so the dry-run of room-tx passes (never signed).
 */
const mainFixture = ({ txIntent, pay, self }) => {
  const h = HELPER;
  const t = step => h.at + step * 60_000;
  const tx = byte => `0x${byte.repeat(32)}`;
  const reference = (status, hash, block, error = null) => ({ type: 'transactionReference', reference: { chainId: GENESIS, hash, status, block, note: TX_NOTE, intentMessageId: null, error } });
  const helperMessages = [
    { messageId: `bot-greeting:${h.account}`, peerAccountId: h.account, timestamp: t(0), direction: 'system', status: 'received', content: { type: 'botGreeting', text: h.info.greeting }, reactions: [], editedAt: null },
    messageRow('fixture-helper-hello', h, t(1), 'outgoing', { type: 'text', text: 'hello' }),
    messageRow('fixture-helper-echo', h, t(1) + 2_000, 'incoming', { type: 'text', text: 'hello' }, { reactions: [{ emoji: '👍', by: 'me' }] }),
    messageRow('fixture-helper-pirate', h, t(2), 'outgoing', { type: 'text', text: `Ask ${PIRATE} for a pirate joke` }),
    messageRow('fixture-helper-deleted', h, t(3), 'outgoing', { type: 'deleted' }),
    messageRow('fixture-helper-frame', h, t(4), 'incoming', { type: 'text', text: '⏳ working · 12s · step 2\n▸ Reading notes.md\n▸ Searching the People chain' }),
    messageRow('fixture-helper-buttons', h, t(5), 'incoming', {
      type: 'buttons',
      text: 'What would you like to do?',
      rows: [
        [
          { label: 'Show my balance', action: { kind: 'callback', payload: bytes(new TextEncoder().encode('balance')) } },
          { label: 'Staking', action: { kind: 'command', command: '/staking' } },
        ],
        [
          { label: 'Open the docs', action: { kind: 'url', url: 'https://docs.polkadot.com/' } },
          { label: 'Stake 10 DOT', action: { kind: 'unsupported' } },
        ],
      ],
      oneShot: false,
      pressed: null,
    }),
    messageRow('fixture-helper-seen', h, t(6), 'outgoing', { type: 'text', text: SEEN_TEXT }, { seenAt: t(6) + 4_000 }),
    messageRow('fixture-helper-tx', h, t(7), 'incoming', {
      type: 'buttons',
      text: 'Try a transaction: it only costs the network fee.',
      rows: [[{ label: 'Send 0.01 PAS to yourself', action: { kind: 'tx', intent: bytes(txIntent) } }]],
      oneShot: false,
      pressed: null,
    }),
    messageRow('fixture-helper-ref-failed', h, t(8), 'outgoing', reference('failed', tx('f1'), null, 'Not enough PAS to pay the fee')),
    messageRow('fixture-helper-ref-final', h, t(9), 'outgoing', reference('finalized', tx('f2'), 13630427)),
    messageRow('fixture-helper-ref-block', h, t(10), 'outgoing', reference('inBlock', tx('f3'), 13630512)),
    messageRow('fixture-helper-ref-sent', h, t(11), 'outgoing', reference('submitted', tx('f4'), null)),
  ];
  const assistantAt = Date.now() - 30 * 60_000;
  const assistant = [
    { messageId: 'fixture-assistant-ask', peerAccountId: 'local:assistant', timestamp: assistantAt, direction: 'outgoing', status: 'delivered',
      content: { type: 'text', text: 'Give me a markdown list of three short facts about Polkadot, one **bold** word in each, then one line of `inline code`.' }, reactions: [], editedAt: null },
    { messageId: 'fixture-assistant-reply', peerAccountId: 'local:assistant', timestamp: assistantAt + 6_000, direction: 'incoming', status: 'received',
      content: { type: 'text', text: '- Polkadot connects many **chains** into one network.\n- Its relay chain gives them **shared** security.\n- DOT holders **govern** the network on chain.\n\n`polkadot.network`' }, reactions: [], editedAt: null },
  ];
  const m = MANAGE;
  const g2 = group2Fixture(self);
  const stores = {
    groups: [g2.group],
    contacts: [
      ...m.contacts.map(c => contactRow(c, [])),
      contactRow(METER),
      contactRow(h),
      contactRow(pay.ask),
      ...(pay.paid ? [contactRow(pay.paid)] : []),
      contactRow(GROUP2.lena),
    ],
    rooms: [
      ...m.contacts.map(c => ({ ...roomRow(c, c.text, c.at, { ...(c.archived ? { archived: true } : {}), ...(c.pinnedAt ? { pinnedAt: c.pinnedAt } : {}) }), unreadCount: c.unread ?? 0 })),
      roomRow(METER, 'What is a parachain?', METER.at + 1),
      roomRow(h, TX_NOTE, t(11), { muted: true }),
      roomRow(pay.ask, pay.ask.text, pay.ask.at + 1),
      ...(pay.paid ? [roomRow(pay.paid, 'Paid', pay.paid.at + 60_000)] : []),
      g2.room,
      { peerAccountId: 'local:assistant', unreadCount: 0, lastMessageAt: assistantAt + 6_000, lastPreview: 'Polkadot connects many chains into one network.', createdAt: assistantAt, updatedAt: assistantAt },
    ],
    messages: [
      ...m.contacts.map(c => messageRow(`fixture-${c.username}`, c, c.at, 'incoming', { type: 'text', text: c.text })),
      { messageId: `bot-greeting:${METER.account}`, peerAccountId: METER.account, timestamp: METER.at, direction: 'system', status: 'received', content: { type: 'botGreeting', text: METER.info.greeting }, reactions: [], editedAt: null },
      messageRow('fixture-meter-question', METER, METER.at + 1, 'outgoing', { type: 'text', text: 'What is a parachain?' }),
      ...helperMessages,
      messageRow('fixture-pay-hello', pay.ask, pay.ask.at, 'incoming', { type: 'text', text: 'Got us two seats for Saturday!' }),
      messageRow('fixture-pay-ask', pay.ask, pay.ask.at + 1, 'incoming', { type: 'buttons', text: pay.ask.text, rows: pay.ask.rows, oneShot: false, pressed: null }),
      ...(pay.paid
        ? [
            messageRow(pay.paid.requestId, pay.paid, pay.paid.at, 'outgoing', { type: 'buttons', text: pay.paid.text, rows: pay.paid.rows, oneShot: false, pressed: null }),
            messageRow('fixture-pay-ref', pay.paid, pay.paid.at + 60_000, 'incoming', { type: 'transactionReference', reference: pay.paid.reference }),
          ]
        : []),
      ...assistant,
      ...g2.messages,
    ],
    requests: [
      { requestId: m.outgoing.requestId, peerAccountId: m.outgoing.account, peerUsername: m.outgoing.username, peerChatPublicKey: fill(32, 7), direction: 'outgoing',
        status: 'pending', welcomeMessage: 'Hello, can you help me with staking?', timestamp: m.outgoing.at, senderDevice: null, createdAt: m.outgoing.at },
      { requestId: ASKER.requestId, peerAccountId: ASKER.account, peerUsername: ASKER.username, peerChatPublicKey: fill(32, 7), direction: 'incoming',
        status: 'pending', welcomeMessage: 'Hi! We met at the Berlin meetup. Shall we keep in touch here?', timestamp: ASKER.at, senderDevice: madeUpDevices[0], createdAt: ASKER.at },
    ],
    blocked: m.blocked,
    peerInfo: [
      { peerId: METER.account, botInfo: METER.info, botInfoAt: METER.at, botSignalAt: METER.at, startSentAt: null },
      { peerId: h.account, botInfo: h.info, botInfoAt: h.at, botSignalAt: h.at, startSentAt: null },
    ],
  };
  return stores;
};

/**
 * M12g: rows for the payment shots, built with the app's own payments module
 * (so the request bytes are what the app sends). A person asks us for 0.5
 * PAS (the payer's view), and the last e2e:pay request with its real payment
 * (the requester's view), when that run's person a is the seeded identity.
 */
const PAY_LAST = join(root, '.agent-runs', 'pay-last.json');
const loadTs = async path => {
  const { register } = await import('tsx/esm/api');
  register();
  return import(pathToFileURL(join(root, path)).href);
};
const paymentFixture = async seededAccountHex => {
  const pay = await loadTs('src/renderer/domain/chain/payments.ts');
  const now = Date.now();
  // Display only: never a real transfer (requestProblem refuses to pay it).
  const placeholder = new Uint8Array([0x0a, 0x03]);
  const keyboard = (intent, amount, note) =>
    pay.requestButtons(intent, amount, note).rows.map(row => row.map(button => ({ label: button.label, action: { kind: 'tx', intent: bytes(button.action.value) } })));
  const askAmount = 5_000_000_000n;
  const asker = { account: account('c8'), username: 'rubyfinch.23', at: now - 10 * 60_000 };
  const askIntent = pay.transferIntent({ chainId: GENESIS, callData: placeholder, amount: askAmount, title: pay.requestTitle(asker.username, askAmount), description: 'Concert tickets', expiresAt: now + pay.REQUEST_TTL_MS });
  const ask = { ...asker, text: pay.requestButtons(askIntent, askAmount, 'Concert tickets').text, rows: keyboard(askIntent, askAmount, 'Concert tickets') };
  const last = existsSync(PAY_LAST) ? JSON.parse(readFileSync(PAY_LAST, 'utf8')) : null;
  let paid = null;
  let paidMissing = last ? null : 'no .agent-runs/pay-last.json: run npm run e2e:pay first';
  if (last && last.a.accountHex !== seededAccountHex) paidMissing = `pay-last.json is for ${last.a.username}, not the seeded identity`;
  if (last && !paidMissing) {
    const amount = BigInt(last.amount);
    const intent = pay.transferIntent({ chainId: GENESIS, callData: placeholder, amount, title: pay.requestTitle(last.a.username, amount), description: last.note, expiresAt: now + pay.REQUEST_TTL_MS });
    paid = {
      account: last.b.accountHex,
      username: last.b.username,
      at: now - 30 * 60_000,
      requestId: last.requestId,
      text: pay.requestButtons(intent, amount, last.note).text,
      rows: keyboard(intent, amount, last.note),
      reference: { chainId: GENESIS, hash: last.hash, status: 'inBlock', block: last.block, note: last.paymentNote, intentMessageId: last.requestId },
    };
  }
  return { ask, paid, paidMissing };
};

/**
 * M15a: a fictional friend who swaps photos (spec 0012 fixture). The image
 * bytes are drawn here and stored as the rows' local copies; nothing is on
 * the Bulletin chain, so no row is left without a copy (a missing copy would
 * start a real download of made-up hashes).
 */
const SOFIA = { account: account('f5'), username: 'sofiamarsh.31', at: Date.now() - 40 * 60_000 };
const BULLETIN_GENESIS = '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59';
const ATTACH_CAPTION = 'Sunset from the ferry';
const attachmentFixture = async () => {
  const { encodeBlurhash } = await loadTs('src/renderer/domain/chat/blurhash.ts');
  const t = step => SOFIA.at + step * 60_000;
  const scene = (width, height, colours) => {
    const image = drawScene(width, height, colours);
    const small = shrink(image.rgba, width, height);
    return { ...image, blurhash: encodeBlurhash(small.pixels, small.w, small.h, 4, 3) };
  };
  const sunset = scene(480, 320, { top: [44, 62, 120], bottom: [247, 150, 92], sun: [255, 214, 140], sea: [40, 70, 110] });
  const harbour = scene(360, 360, { top: [120, 180, 230], bottom: [214, 234, 248], sun: [255, 246, 200], sea: [30, 110, 140] });
  const dusk = scene(480, 360, { top: [70, 40, 110], bottom: [230, 110, 120], sun: [255, 190, 150], sea: [50, 40, 90] });
  const beach = scene(400, 300, { top: [90, 160, 220], bottom: [240, 220, 180], sun: [255, 240, 190], sea: [20, 120, 150] });
  const item = (image, chunks) => ({
    mime: 'image/png',
    name: null,
    size: chunks > 1 ? 3_400_000 : image.png.length,
    media: { kind: 'image', width: image.width, height: image.height },
    blurhash: image.blurhash,
    thumbnail: null,
    key: fill(32, 0x11),
    nonce: fill(12, 0x22),
    chunkSize: 2_000_000,
    chunks: Array.from({ length: chunks }, (_, i) => fill(32, 0x30 + i)),
    store: { genesis: BULLETIN_GENESIS, mirror: null },
    expiresAt: Date.now() + 13 * 24 * 3_600_000,
  });
  const local = (messageId, image, status, done, total) => ({
    messageId, index: 0, status, done, total, bytes: status === 'ready' ? bytes(image.png) : null, mime: 'image/png',
    expiresAt: Date.now() + 13 * 24 * 3_600_000, attempts: 0, firstFailedAt: null, error: null, updatedAt: Date.now(),
  });
  const attachment = (image, chunks, caption = null) => ({ type: 'attachment', items: [item(image, chunks)], caption });
  // M15b: files, albums and voice notes.
  const { waveformOf } = await loadTs('src/renderer/domain/chat/voice.ts');
  const plain = (size, byte) => ({ ...item({ png: new Uint8Array(1) }, Math.max(1, Math.ceil(size / 2_000_000))), size, key: fill(32, byte), nonce: fill(12, byte) });
  const fileItem = (name, mime, size, byte) => ({ ...plain(size, byte), mime, name, media: { kind: 'file' }, blurhash: null });
  const voiceItem = (durationMs, seed, byte) => ({
    ...plain(4_000 * Math.ceil(durationMs / 1000), byte),
    mime: 'audio/webm; codecs=opus',
    name: null,
    blurhash: null,
    media: { kind: 'voice', durationMs, waveform: waveformOf(Float32Array.from({ length: 3_200 }, (_, i) => Math.sin(i / 7) * (0.15 + 0.85 * Math.abs(Math.sin(i / (90 + seed)) * Math.cos(i / (400 + seed)))))) },
  });
  const report = fileItem('Island trip budget.pdf', 'application/pdf', 2_300_000, 0x41);
  const archive = fileItem('ferry-tickets.zip', 'application/zip', 412_000, 0x42);
  const archiveBytes = new Uint8Array(412_000).fill(7);
  const albumIn = [sunset, harbour, dusk, beach];
  const albumOut = [
    scene(360, 360, { top: [150, 200, 240], bottom: [250, 230, 200], sun: [255, 250, 220], sea: [10, 130, 160] }),
    scene(360, 360, { top: [30, 40, 90], bottom: [200, 90, 110], sun: [255, 170, 120], sea: [30, 30, 70] }),
    scene(360, 360, { top: [100, 170, 210], bottom: [230, 240, 250], sun: [255, 255, 230], sea: [40, 120, 120] }),
  ];
  const albumItems = images => images.map(image => item(image, 1));
  const voiceIn = voiceItem(4_000, 13, 0x51);
  const voiceOut = voiceItem(4_000, 61, 0x52);
  // M15c: videos. The poster (thumbnail) and the sent one's bytes are made in the page (recordFixtureVideo).
  const clip = scene(480, 270, { top: [30, 70, 130], bottom: [250, 180, 110], sun: [255, 225, 160], sea: [20, 80, 120] });
  const videoItem = (name, byte) => ({
    ...plain(1_400_000, byte),
    mime: 'video/webm',
    name,
    blurhash: clip.blurhash,
    media: { kind: 'video', width: 480, height: 270, durationMs: 3_000 },
  });
  const expired = { ...fileItem('Ferry timetable.pdf', 'application/pdf', 180_000, 0x43), expiresAt: Date.now() - 2 * 24 * 3_600_000 };
  const album = (id, images, status) => images.map((image, index) => ({ ...local(id, image, status, 1, 1), index }));
  return {
    contacts: [contactRow(SOFIA)],
    rooms: [roomRow(SOFIA, 'Please resend the photo', t(16))],
    messages: [
      messageRow('fixture-sofia-hello', SOFIA, t(0), 'incoming', { type: 'text', text: 'Back from the islands! Photos coming.' }),
      messageRow('fixture-sofia-harbour', SOFIA, t(1), 'outgoing', attachment(harbour, 1, 'Ours from the harbour')),
      messageRow('fixture-sofia-dusk', SOFIA, t(2), 'incoming', attachment(dusk, 2)),
      messageRow('fixture-sofia-beach', SOFIA, t(3), 'outgoing', attachment(beach, 2), { status: 'sending' }),
      messageRow('fixture-sofia-sunset', SOFIA, t(5), 'incoming', attachment(sunset, 1, ATTACH_CAPTION)),
      messageRow('fixture-sofia-pdf', SOFIA, t(6), 'incoming', { type: 'attachment', items: [report], caption: 'The budget, before I forget' }),
      messageRow('fixture-sofia-zip', SOFIA, t(7), 'outgoing', { type: 'attachment', items: [archive], caption: null }),
      messageRow('fixture-sofia-album-in', SOFIA, t(8), 'incoming', { type: 'attachment', items: albumItems(albumIn), caption: 'Best of the week' }),
      messageRow('fixture-sofia-album-out', SOFIA, t(9), 'outgoing', { type: 'attachment', items: albumItems(albumOut), caption: 'And ours' }),
      messageRow('fixture-sofia-voice-in', SOFIA, t(11), 'incoming', { type: 'attachment', items: [voiceIn], caption: null }),
      messageRow('fixture-sofia-voice-out', SOFIA, t(12), 'outgoing', { type: 'attachment', items: [voiceOut], caption: null }),
      messageRow('fixture-sofia-video-in', SOFIA, t(13), 'incoming', { type: 'attachment', items: [videoItem('ferry-wake.webm', 0x61)], caption: 'The wake behind the ferry' }),
      messageRow('fixture-sofia-video-out', SOFIA, t(14), 'outgoing', { type: 'attachment', items: [videoItem('harbour-sunset.webm', 0x62)], caption: null }),
      messageRow('fixture-sofia-expired', SOFIA, t(15), 'incoming', { type: 'attachment', items: [expired], caption: null }),
      messageRow('fixture-sofia-resend', SOFIA, t(16), 'incoming', { type: 'text', text: 'Please resend [the photo](#resend/fixture-sofia-harbour)' }),
    ],
    attachments: [
      local('fixture-sofia-sunset', sunset, 'ready', 1, 1),
      local('fixture-sofia-harbour', harbour, 'ready', 1, 1),
      local('fixture-sofia-dusk', dusk, 'downloading', 1, 2),
      local('fixture-sofia-beach', beach, 'uploading', 1, 2),
      { ...local('fixture-sofia-zip', beach, 'ready', 1, 1), bytes: bytes(archiveBytes), mime: 'application/zip' },
      ...album('fixture-sofia-album-in', albumIn, 'ready'),
      ...album('fixture-sofia-album-out', albumOut, 'ready'),
      { ...local('fixture-sofia-expired', dusk, 'expired', 0, 1), mime: 'application/pdf', expiresAt: expired.expiresAt, attempts: 3, firstFailedAt: Date.now() - 3_600_000, error: 'No source had the chunk.' },
    ],
    // M15c: today's uploads for the quota panel (3 stores, 1.4 MB).
    settings: [{ key: 'bulletin.uploads', value: JSON.stringify({ day: localDayOf(Date.now()), transactions: 3, bytes: 1_450_000 }) }],
    videoRows: { poster: ['fixture-sofia-video-in', 'fixture-sofia-video-out'], bytes: ['fixture-sofia-video-out'] },
    // The voice rows' bytes are recorded in the page (recordFixtureVoice): a real WebM/Opus file.
    voiceRows: ['fixture-sofia-voice-in', 'fixture-sofia-voice-out'],
    // The image the composer shot picks with the Paperclip.
    pick: drawScene(480, 320, { top: [60, 110, 170], bottom: [250, 200, 140], sun: [255, 230, 170], sea: [30, 80, 120] }).png,
  };
};

/** The intent of the fixture tx button: 0.01 PAS from `selfHex` to itself, with call data the app builds. */
const selfTransferIntent = async (app, selfHex) => {
  const callData = await app.evaluate(`window.desktop.chain.transferCall(${JSON.stringify(selfHex)}, '100000000').then(bytes => Array.from(bytes))`);
  const { encodeTxIntent } = await loadTs('src/shared/txIntent.ts');
  return encodeTxIntent({
    version: 1,
    chainId: GENESIS,
    calls: [{ kind: 0, to: undefined, data: Uint8Array.from(callData), value: 0n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
    display: { title: 'Send to yourself', description: 'A test transfer of 0.01 PAS from your account back to it', amount: '0.01', asset: 'PAS' },
    dryRunRequired: true,
    expiresAt: BigInt(Date.now() + 30 * 60_000),
  });
};

// ── Worker: sign-up ──────────────────────────────────────────────────────

const signupWorker = async () => {
  const log = logger('signup');
  const profile = mkdtempSync(join(tmpdir(), 'pcd-shots-signup-'));
  let app = null;
  try {
    app = await launch(profile, await portFor(0), log);
    await app.shot('signup', async () => {
      if (!(await app.waitFor(app.exists('#signup-username'), 30_000))) throw new Error('no sign-up screen');
      await app.type('#signup-username', 'polkadotfan');
      // The availability line answers from the identity backend.
      await app.waitFor(`!document.querySelector('[data-testid=availability]').textContent.includes('Checking')`, 20_000);
    });
  } catch (error) {
    miss('signup', error.message);
  } finally {
    await app?.quit();
    rmSync(profile, { recursive: true, force: true });
  }
};

// ── Worker: main (fixtures) ──────────────────────────────────────────────

const mainWorker = async () => {
  const log = logger('main');
  if (!existsSync(identitySource)) {
    for (const name of WORKER_SHOTS.main.filter(wanted)) miss(name, `no identity file at ${identitySource}`);
    return;
  }
  const source = JSON.parse(readFileSync(identitySource, 'utf8'));
  let app = null;
  let profile = null;
  try {
    ({ app, profile } = await openSeeded(identitySource, await portFor(1), log));
    log('seeded', source.username);
    const pay = await paymentFixture(source.accountHex);
    // The real call data needs the Asset Hub connection: only when room-tx presses the button.
    const txIntent = wanted('room-tx') ? await selfTransferIntent(app, source.accountHex) : new Uint8Array([0]);
    await writeRows(app, mainFixture({ txIntent, pay, self: { account: source.accountHex, username: source.username } }));
    const { pick, voiceRows, videoRows, ...attachRows } = await attachmentFixture();
    await writeRows(app, attachRows);
    await recordFixtureVoice(app, voiceRows);
    await recordFixtureVideo(app, videoRows);
    writeFileSync(join(profile, 'pick.png'), pick);
    await app.reload(app.exists('[data-testid=chat-row-assistant]'));
    log('fixture written');
    await mainShots(app, log, pay);
    await attachmentShots(app, join(profile, 'pick.png'));
    if (wanted('settings-agent')) await agentShots(app, log, profile);
  } catch (error) {
    missing.push(`main worker: ${error.message}`);
    log('stopped:', error.message);
  } finally {
    await app?.quit();
    if (profile) rmSync(profile, { recursive: true, force: true });
  }
};

/**
 * M15b: a real voice note for the fixture: the page records 4 s of a
 * modulated tone with MediaRecorder (WebM/Opus, as the app records the
 * microphone) and stores it as the local copy of each voice row, so the
 * player plays real audio.
 */
const recordFixtureVoice = (app, messageIds) =>
  app.evaluate(`(async () => {
    // No output device: with none (a Mac with its audio asleep) a normal context's clock stands still and the
    // recording is a 110-byte header. The silent sink renders on its own clock.
    const context = new AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
    await context.resume();
    const tone = context.createOscillator();
    const gain = context.createGain();
    const wobble = context.createOscillator();
    const depth = context.createGain();
    tone.frequency.value = 220;
    wobble.frequency.value = 3;
    depth.gain.value = 0.4;
    wobble.connect(depth).connect(gain.gain);
    const out = context.createMediaStreamDestination();
    out.channelCount = 1;
    tone.connect(gain).connect(out);
    tone.start();
    wobble.start();
    const recorder = new MediaRecorder(out.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 });
    const parts = [];
    recorder.ondataavailable = event => parts.push(event.data);
    const stopped = new Promise(done => { recorder.onstop = done; });
    recorder.start();
    await new Promise(done => setTimeout(done, 4000));
    recorder.stop();
    await stopped;
    await context.close();
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    const ids = ${JSON.stringify(messageIds)};
    await new Promise((done, fail) => {
      const open = indexedDB.open('polkadot-chat-web');
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(['attachments'], 'readwrite');
        for (const messageId of ids) {
          tx.objectStore('attachments').put({ messageId, index: 0, status: 'ready', done: 1, total: 1, bytes, mime: 'audio/webm; codecs=opus',
            expiresAt: Date.now() + 13 * 24 * 3600000, attempts: 0, firstFailedAt: null, error: null, updatedAt: Date.now() });
        }
        tx.oncomplete = () => { open.result.close(); done(true); };
        tx.onerror = () => fail(tx.error);
      };
    });
    return bytes.length;
  })()`);

/** The local calendar day, as storageQuota.ts `localDay` counts uploads. */
const localDayOf = at => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * M15c: a real video for the fixture: the page draws 3 s of a sunset over
 * moving water on a canvas, records it with MediaRecorder (WebM/VP8), stores
 * it as the local copy of the `bytes` rows, and writes a WebP poster (as
 * attachmentVideo.ts makes one) into the `poster` rows' message content.
 */
const recordFixtureVideo = (app, { poster, bytes }) =>
  app.evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const context = canvas.getContext('2d');
    let frame = 0;
    const draw = () => {
      const sky = context.createLinearGradient(0, 0, 0, 170);
      sky.addColorStop(0, 'rgb(30, 70, 130)');
      sky.addColorStop(1, 'rgb(250, 180, 110)');
      context.fillStyle = sky;
      context.fillRect(0, 0, 480, 170);
      context.fillStyle = 'rgb(255, 225, 160)';
      context.beginPath();
      context.arc(240, 150 - frame * 0.4, 38, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgb(20, 80, 120)';
      context.fillRect(0, 170, 480, 100);
      context.strokeStyle = 'rgba(255, 230, 190, 0.7)';
      context.lineWidth = 3;
      for (let row = 0; row < 6; row++) {
        context.beginPath();
        for (let x = 0; x <= 480; x += 12) context.lineTo(x, 185 + row * 15 + Math.sin(x / 30 + frame / 4 + row) * 4);
        context.stroke();
      }
      frame += 1;
    };
    draw();
    const stream = canvas.captureStream(25);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1500000 });
    const parts = [];
    recorder.ondataavailable = event => parts.push(event.data);
    const stopped = new Promise(done => { recorder.onstop = done; });
    const timer = setInterval(draw, 40);
    recorder.start();
    await new Promise(done => setTimeout(done, 3000));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    const video = new Uint8Array(await new Blob(parts).arrayBuffer());
    // The poster, as the app makes one: one frame, WebP, at most 2 KB.
    let thumbnail = null;
    for (const [w, h] of [[96, 54], [72, 41], [48, 27]]) {
      const small = new OffscreenCanvas(w, h);
      small.getContext('2d').drawImage(canvas, 0, 0, w, h);
      for (const quality of [0.6, 0.4, 0.25]) {
        const blob = await small.convertToBlob({ type: 'image/webp', quality });
        if (blob.size <= 2048) { thumbnail = new Uint8Array(await blob.arrayBuffer()); break; }
      }
      if (thumbnail) break;
    }
    const posterIds = ${JSON.stringify(poster)};
    const byteIds = ${JSON.stringify(bytes)};
    await new Promise((done, fail) => {
      const open = indexedDB.open('polkadot-chat-web');
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(['attachments', 'messages'], 'readwrite');
        const messages = tx.objectStore('messages');
        for (const messageId of posterIds) {
          const get = messages.get(messageId);
          get.onsuccess = () => {
            const row = get.result;
            row.content.items[0].thumbnail = thumbnail;
            row.content.items[0].size = video.length;
            messages.put(row);
          };
        }
        for (const messageId of byteIds) {
          tx.objectStore('attachments').put({ messageId, index: 0, status: 'ready', done: 1, total: 1, bytes: video, mime: 'video/webm',
            expiresAt: Date.now() + 13 * 24 * 3600000, attempts: 0, firstFailedAt: null, error: null, updatedAt: Date.now() });
        }
        tx.oncomplete = () => { open.result.close(); done(true); };
        tx.onerror = () => fail(tx.error);
      };
    });
    return video.length;
  })()`);

/** M15a: the image bubble states and the composer's attach row (fixture rows, no chain). */
const attachmentShots = async (app, pickPath) => {
  const openSofia = async () => {
    if ((await app.evaluate(`document.querySelector('[data-testid=room-title]')?.textContent`)) !== SOFIA.username) await openRow(app, SOFIA.username);
  };
  const status = s => `document.querySelectorAll('[data-testid=attachment-item][data-status=${s}]').length`;

  await app.shot('room-attachment', async () => {
    await openSofia();
    const shown = `${status('ready')} >= 2 && ${status('downloading')} >= 1 && ${status('uploading')} >= 1 && document.querySelectorAll('[data-testid=attachment-image]').length >= 2`;
    if (!(await app.waitFor(shown, 15_000))) throw new Error('the image bubbles did not show their states');
    // The decoded images paint a frame later than the rows.
    await app.waitFor(`[...document.querySelectorAll('[data-testid=attachment-image]')].every(img => img.complete && img.naturalWidth > 0)`, 10_000);
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-sunset"]')?.scrollIntoView({ block: 'end' }); true`);
  });

  await app.shot('room-file', async () => {
    await openSofia();
    const shown = `${app.exists('[data-message-id="fixture-sofia-pdf"] [data-testid=attachment-download]')} && ${app.exists('[data-message-id="fixture-sofia-zip"] [data-testid=attachment-open]')}`;
    if (!(await app.waitFor(shown, 15_000))) throw new Error('the file rows did not show (Download on the PDF, Open on the ZIP)');
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-pdf"]')?.scrollIntoView({ block: 'start' }); true`);
  });

  await app.shot('room-album', async () => {
    await openSofia();
    const tiles = id => `document.querySelectorAll('[data-message-id="${id}"] [data-testid=attachment-album] [data-testid=attachment-image]').length`;
    const shown = `${tiles('fixture-sofia-album-in')} === 4 && ${tiles('fixture-sofia-album-out')} === 3`;
    if (!(await app.waitFor(shown, 15_000))) throw new Error('the album grids did not show 4 and 3 images');
    await app.waitFor(`[...document.querySelectorAll('[data-testid=attachment-album] img')].every(img => img.complete && img.naturalWidth > 0)`, 10_000);
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-album-out"]')?.scrollIntoView({ block: 'end' }); true`);
  });

  await app.shot('room-voice', async () => {
    await openSofia();
    const play = `document.querySelector('[data-message-id="fixture-sofia-voice-in"] [data-testid=voice-play]')`;
    if (!(await app.waitFor(`${play} && !${play}.disabled`, 15_000))) throw new Error('the voice player did not get its audio');
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-voice-out"]')?.scrollIntoView({ block: 'end' }); true`);
    // Play the received one: its waveform fills as the audio plays (proves the WebM/Opus copy plays).
    await app.evaluate(`${play}.click(); true`);
    if (!(await app.waitFor(`/^0:0[1-3] \\/ 0:04$/.test(document.querySelector('[data-message-id="fixture-sofia-voice-in"] [data-testid=voice-duration]')?.textContent ?? '')`, 8_000))) {
      throw new Error(`the voice note did not play (no progress): ${await app.evaluate(`(() => { const a = document.querySelector('[data-message-id="fixture-sofia-voice-in"] audio'); const d = document.querySelector('[data-message-id="fixture-sofia-voice-in"] [data-testid=voice-duration]')?.textContent; return JSON.stringify({ d, paused: a?.paused, t: a?.currentTime, rs: a?.readyState, err: a?.error?.message, dur: a?.duration, src: !!a?.src }); })()`)}`);
    }
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-voice-in"] audio')?.pause(); true`);
  });

  await app.shot('room-video', async () => {
    await openSofia();
    const shown = [
      app.exists('[data-message-id="fixture-sofia-video-in"] [data-kind=video] [data-testid=attachment-download]'),
      app.exists('[data-message-id="fixture-sofia-video-out"] [data-testid=attachment-video]'),
      app.exists('[data-message-id="fixture-sofia-expired"] [data-testid=attachment-ask-resend]'),
      app.exists('[data-message-id="fixture-sofia-resend"] [data-testid=resend-run]'),
    ].join(' && ');
    if (!(await app.waitFor(shown, 15_000))) throw new Error('no video poster, inline player, Ask to resend or Resend offer');
    // The inline player has its frames and knows its duration (a MediaRecorder WebM learns it by one seek to the end and back).
    const player = `document.querySelector('[data-testid=attachment-video]')`;
    if (!(await app.waitFor(`${player}?.readyState >= 2 && !${player}.seeking && Number.isFinite(${player}.duration) && ${player}.currentTime === 0`, 10_000))) throw new Error('the inline video did not load');
    await sleep(500);
    await app.evaluate(`document.querySelector('[data-message-id="fixture-sofia-resend"]')?.scrollIntoView({ block: 'end' }); true`);
  });

  await app.shot('composer-attach', async () => {
    await openSofia();
    // The Paperclip's file picker, filled over CDP as a person's choice would.
    const input = (await app.send('Runtime.evaluate', { expression: `document.querySelector('[data-testid=composer-attach-input]')` })).result?.result;
    if (!input?.objectId) throw new Error('no Paperclip file input');
    await app.send('DOM.enable');
    await app.send('DOM.setFileInputFiles', { files: [pickPath], objectId: input.objectId });
    if (!(await app.waitFor(`${app.exists('[data-testid=attach-row]')} && ${app.exists('[data-testid=attach-notice]')}`, 10_000))) throw new Error('no attach row with its notice');
    await app.type('textarea[aria-label=Message]', 'For the trip album');
  });

  await app.shot('settings-storage', async () => {
    if (!(await app.evaluate(app.exists('[data-testid=storage]')))) await app.click('[aria-label=Settings]');
    if (!(await app.waitFor(app.exists('[data-testid=storage]'), 20_000))) throw new Error('no Storage section in Settings');
    // The authorization is read live (devnet, the seeded identity's Bulletin account); the day's count is the fixture's.
    const answered = `${app.exists('[data-testid=quota-today]')} || ${app.exists('[data-testid=quota-none]')}`;
    if (!(await app.waitFor(answered, 30_000))) throw new Error(`the quota did not load: ${await app.evaluate(`document.querySelector('[data-testid=storage]')?.innerText ?? ''`)}`);
    await app.evaluate(`document.querySelector('[data-testid=storage]').closest('section').scrollIntoView({ block: 'start' }); true`);
  });
  if (await app.evaluate(app.exists('[data-testid=storage]'))) await app.esc();
};

const mainShots = async (app, log, pay) => {
  const h = HELPER;
  const inRoom = () => app.evaluate(app.exists('textarea[aria-label=Message]'));
  const message = id => `document.querySelector('[data-message-id=${JSON.stringify(id)}]')`;
  const scrollTo = (id, block = 'center') => app.evaluate(`${message(id)}?.scrollIntoView({ block: ${JSON.stringify(block)} }); true`);
  const openHelper = async () => {
    if ((await app.evaluate(`document.querySelector('[data-testid=room-title]')?.textContent`)) !== h.username) await openRow(app, h.username);
  };

  await app.shot('chats', async () => {
    // A draft left in the Assistant room; Esc goes back to the list.
    await app.click('[data-testid=chat-row-assistant]');
    await app.waitFor(app.exists('textarea[aria-label=Message]'), 10_000);
    await app.type('textarea[aria-label=Message]', DRAFT);
    await sleep(800);
    await app.esc();
    if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=chat-row-assistant]')].some(r => r.textContent.includes('Draft: ${DRAFT}'))`, 10_000))) {
      throw new Error('no draft preview in the list');
    }
  });
  if (wanted('chats')) {
    // The draft goes again, so the Assistant shot has an empty composer.
    await app.click('[data-testid=chat-row-assistant]');
    await app.waitFor(`document.querySelector('textarea[aria-label=Message]')?.value === ${JSON.stringify(DRAFT)}`, 10_000);
    await app.clearField('textarea[aria-label=Message]');
    await sleep(800);
    await app.esc();
  }

  await app.shot('room', async () => {
    await openHelper();
    if (!(await app.waitFor(`${message('fixture-helper-echo')}?.querySelector('[aria-pressed=true]') != null`, 10_000))) throw new Error('the echo shows no 👍');
    await scrollTo('fixture-helper-echo');
  });

  await app.shot('room-deleted', async () => {
    await openHelper();
    if (!(await app.waitFor(`${message('fixture-helper-deleted')}?.querySelector('[data-testid=message-deleted]') != null`, 10_000))) throw new Error('no tombstone');
    if (!(await app.evaluate(app.exists('[data-testid=live-frame]')))) throw new Error('no live frame');
    await scrollTo('fixture-helper-frame');
  });

  await app.shot('room-buttons', async () => {
    await openHelper();
    const keyboard = `${message('fixture-helper-buttons')}?.querySelector('[data-testid=keyboard]')`;
    if (!(await app.waitFor(`${keyboard} != null`, 10_000))) throw new Error('no keyboard');
    await app.evaluate(`${keyboard}.scrollIntoView({ block: 'end' }); true`);
    await app.evaluate(`${keyboard}.querySelector('[data-action=url]').click(); true`);
    if (!(await app.waitFor(app.exists('[data-testid=url-confirm]'), 5_000))) throw new Error('no confirm strip for the url button');
    log('url strip:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=url-confirm]').textContent`)), 'disabled:', await app.evaluate(`${keyboard}.querySelectorAll('[data-testid=keyboard-disabled]').length`));
  });
  // Cancel the url strip, so later shots have one primary control on screen.
  await app.evaluate(`[...document.querySelectorAll('[data-testid=url-confirm] button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);

  await app.shot('room-bot', async () => {
    await openHelper();
    if (!(await app.waitFor(`${app.exists('header [data-testid=bot-badge]')} && ${app.exists('[data-testid=bot-description]')} && ${app.exists('[data-testid=bot-greeting]')}`, 10_000))) {
      throw new Error('no badge, description or greeting');
    }
    await app.type('textarea[aria-label=Message]', '/');
    if (!(await app.waitFor(`document.querySelectorAll('[data-testid=command-option]').length > 0`, 5_000))) throw new Error('"/" opened no command menu');
    // The greeting at the top of the list, above the menu.
    await app.evaluate(`document.querySelector('[data-testid=bot-greeting]').scrollIntoView({ block: 'start' }); true`);
    log('command menu:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=command-option]')].map(o => o.textContent)`)));
  });
  if (await inRoom()) {
    // The menu goes with the "/" (Esc, then the field is emptied), so the next shots start clean.
    await app.esc();
    await app.clearField('textarea[aria-label=Message]');
  }

  await app.shot(
    'room-seen',
    async () => {
      await openHelper();
      const tick = `${message('fixture-helper-seen')}?.querySelector('[data-testid=seen-tick]')`;
      if (!(await app.waitFor(`${tick} != null`, 10_000))) throw new Error('no seen tick');
      await scrollTo('fixture-helper-seen');
      await app.settle();
      const tooltip = `[...document.querySelectorAll('[data-slot=tooltip-content],[role=tooltip]')].some(t => t.textContent.startsWith('Seen '))`;
      let shown = false;
      for (let attempt = 0; attempt < 3 && !shown; attempt++) {
        await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await app.hoverAt(tick);
        shown = await app.waitFor(tooltip, 3_000);
      }
      if (!shown) throw new Error('no "Seen" tooltip on hover');
      // Let the tooltip finish its fade-in; the pointer stays on the tick.
      await sleep(400);
    },
    { hover: true },
  );

  const txStrip = `document.querySelector('[data-testid=tx-strip]')`;
  await app.shot('room-tx', async () => {
    await openHelper();
    const button = `${message('fixture-helper-tx')}?.querySelector('[data-action=tx]:not([disabled])')`;
    if (!(await app.waitFor(`${button} != null`, 10_000))) throw new Error('no tx button');
    await app.evaluate(`${button}.click(); true`);
    if (!(await app.waitFor(`['ready', 'refused'].includes(${txStrip}?.dataset.phase)`, 60_000))) throw new Error('the signing strip did not finish its dry-run');
    const strip = await app.evaluate(`${txStrip}.innerText.replace(/\\s+/g, ' ')`);
    log('strip:', JSON.stringify(strip));
    if ((await app.evaluate(`${txStrip}.dataset.phase`)) !== 'ready') throw new Error(`the dry-run refused it: ${strip}`);
    await app.evaluate(`${txStrip}.scrollIntoView({ block: 'end' }); true`);
  });
  // Never signed: Cancel.
  await app.evaluate(`[...document.querySelectorAll('[data-testid=tx-strip] button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);

  await app.shot('room-tx-done', async () => {
    await openHelper();
    const states = await app.evaluate(`[...document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]')].map(r => r.dataset.status)`);
    if (!['failed', 'finalized', 'inBlock', 'submitted'].every(status => states?.includes(status))) throw new Error(`the four reference states are not all shown: ${JSON.stringify(states)}`);
    const final = `${message('fixture-helper-ref-final')}?.querySelector('[data-testid=tx-actions]')`;
    if (!(await app.evaluate(`!!(${final}?.querySelector('[data-testid=tx-hash]') && ${final}?.querySelector('[data-testid=tx-explorer]'))`))) throw new Error('the finalized bubble has no action row');
    // The header reads the Meter balance at the best block.
    if (!(await app.waitFor(app.exists('[data-testid=bot-balance]'), 60_000))) throw new Error('no balance line (spec 0008 hint) in the header');
    log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=bot-balance]').textContent`)));
    await scrollTo('fixture-helper-ref-sent', 'end');
  });

  await app.shot('pocket', async () => {
    if (!(await app.waitFor(`/\\d PAS/.test(document.querySelector('[data-testid=balance-chip]')?.textContent ?? '')`, 60_000))) throw new Error('the balance chip shows no amount');
    await app.click('[data-testid=balance-chip]');
    const read = row => `/PAS|No balance needed/.test(document.querySelector('[data-testid=${row}]')?.textContent ?? '')`;
    if (!(await app.waitFor(`${read('pocket-asset-hub')} && ${read('pocket-people')} && ${app.exists('[data-testid=pocket] img')}`, 60_000))) {
      throw new Error(`the Pocket did not read both balances: ${await app.evaluate(`document.querySelector('[data-testid=pocket]')?.innerText ?? 'no pocket'`)}`);
    }
  });
  if (await app.evaluate(app.exists('[data-testid=pocket]'))) await app.esc();

  await app.shot('assistant', async () => {
    await app.click('[data-testid=chat-row-assistant]');
    if (!(await app.waitFor(`document.querySelectorAll('[data-testid=markdown]').length > 0 && ${app.exists('[data-testid=assistant-engine]')}`, 10_000))) throw new Error('no markdown reply or engine in the header');
  });
  if (await inRoom()) await app.esc();
  await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);

  // ── M7b: the unified search.
  const QUERY = 'pcdp';
  await app.shot('search', async () => {
    const pirateRow = `[...document.querySelectorAll('[data-testid=chat-row],[data-testid=chat-row-outgoing]')].some(r => r.textContent.includes(${JSON.stringify(PIRATE)}))`;
    if (!(await app.evaluate(pirateRow))) {
      // A request to the pirate bot, sent from a global search hit (the one live step here).
      await app.click('[aria-label="New chat"]');
      await app.type('[aria-label=Search]', 'pcdpirate');
      const hit = `[...document.querySelectorAll('[data-testid=search-global-row]')].some(r => r.textContent.includes(${JSON.stringify(PIRATE)}))`;
      if (!(await app.waitFor(hit, 60_000))) throw new Error(`${PIRATE} not found by the global search`);
      await app.clickText('[data-testid=search-global-row]', PIRATE);
      if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(PIRATE)} && ${app.exists('textarea[aria-label=Message]')}`, 10_000))) {
        throw new Error('the global hit did not open the draft room');
      }
      await app.type('textarea[aria-label=Message]', 'Ahoy from the desktop app');
      await app.clickText('button', 'Send Request');
      if (!(await app.waitFor(pirateRow, 60_000))) throw new Error(`the request to ${PIRATE} did not go out`);
      log('request sent to', PIRATE, 'from a global search hit');
      await app.esc();
      await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);
    }
    await app.type('[aria-label=Search]', QUERY);
    const ready = `(${app.exists('[data-testid=search-chats]')} || ${app.exists('[data-testid=search-bots]')}) && ${app.exists('[data-testid=search-messages]')} && [...document.querySelectorAll('[data-testid=search-global-row]')].some(r => r.textContent.includes(${JSON.stringify(BOT)})) && !document.querySelector('[data-testid=search-results]').textContent.includes('Searching…')`;
    if (!(await app.waitFor(ready, 60_000))) {
      const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
      throw new Error(`the three sections did not fill: ${JSON.stringify(seen)}`);
    }
    // ↓ twice: from the pirate row into the first global row.
    await app.key('ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
    await app.key('ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
    if (!(await app.waitFor(`document.querySelector('[data-highlighted=true] [data-testid=search-global-row]') != null`, 5_000))) throw new Error('↓↓ did not highlight the first global row');
  });

  // A message hit opens its room at that message and highlights it for 1.5 s:
  // both themes are taken inside that time.
  await app.shot(
    'search-jump',
    async () => {
      if (!(await app.evaluate(app.exists('[data-testid=search-message]')))) throw new Error('no message hit (the search shot did not run)');
      await app.click('[data-testid=search-message]');
      if (!(await app.waitFor(app.exists('[data-message-id].bg-selection-container-active'), 10_000))) throw new Error('no highlighted message after the jump');
    },
    { hover: true },
  );
  if (wanted('search-jump') && !(await app.waitFor(`!document.querySelector('[data-message-id].bg-selection-container-active')`, 5_000))) missing.push('search-jump: the message highlight did not end');

  const ESC_SEARCH = async () => {
    await app.evaluate(`document.querySelector('[aria-label=Search]')?.focus(); true`);
    await app.esc();
  };
  await ESC_SEARCH();
  // "Show more" fetches the next page of the global search (not a shot).
  if (wanted('search')) {
    try {
      await app.type('[aria-label=Search]', 'pcd');
      if (!(await app.waitFor(app.exists('[data-testid=search-show-more]'), 60_000))) throw new Error('no Show more for "pcd"');
      const before = await app.evaluate(`document.querySelectorAll('[data-testid=search-global-row]').length`);
      await app.click('[data-testid=search-show-more]');
      if (!(await app.waitFor(`document.querySelectorAll('[data-testid=search-global-row]').length > ${before}`, 60_000))) throw new Error('Show more added no rows');
      log(`global search "pcd": ${before} rows, ${await app.evaluate(`document.querySelectorAll('[data-testid=search-global-row]').length`)} after Show more`);
    } catch (error) {
      missing.push(`search: Show more (${error.message})`);
    }
    await ESC_SEARCH();
  }

  await app.shot('search-empty', async () => {
    // The search is clear; Esc in the field now closes the room.
    await ESC_SEARCH();
    await app.waitFor(app.exists('[data-testid=empty-room]'), 10_000);
    await app.click('[aria-label="New chat"]');
    if (!(await app.waitFor(`document.querySelector('[aria-label=Search]').placeholder === 'Type username' && document.activeElement === document.querySelector('[aria-label=Search]') && ${app.exists('[data-testid=search-results]')}`, 5_000))) {
      throw new Error('"+" did not focus the search field');
    }
  });

  await app.shot('search-no-results', async () => {
    await app.type('[aria-label=Search]', 'qxzqxzq');
    if (!(await app.waitFor(app.exists('[data-testid=search-no-results]'), 30_000))) throw new Error('no "No results" line');
  });
  await ESC_SEARCH();

  await app.shot('search-bots', async () => {
    await ESC_SEARCH();
    await app.type('[aria-label=Search]', 'test');
    const both = `[...document.querySelectorAll('[data-testid=search-bot-row]')].length >= 2`;
    if (!(await app.waitFor(`${both} && !document.querySelector('[data-testid=search-results]').textContent.includes('Searching…')`, 60_000))) {
      const seen = await app.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText ?? 'no results view'`);
      throw new Error(`the Bots section did not show both bots: ${JSON.stringify(seen)}`);
    }
    log('bots:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=search-bot-row]')].map(r => r.innerText.replace(/\\s+/g, ' '))`)));
  });
  await ESC_SEARCH();
  await ESC_SEARCH();

  await app.shot('requests', async () => {
    if (!(await app.waitFor(app.exists('[data-testid=new-requests]'), 10_000)) || !(await app.click('[data-testid=new-requests]'))) throw new Error('no "New requests" (the fixture request is missing)');
    const row = `[...document.querySelectorAll('[data-testid=incoming-request]')].find(r => r.textContent.includes(${JSON.stringify(ASKER.username)}))`;
    if (!(await app.waitFor(`!!${row}`, 10_000))) throw new Error('the fixture request is not in the list');
    await app.evaluate(`${row}.click(); true`);
    if (!(await app.waitFor(app.exists('[data-testid=request-banner]'), 10_000))) throw new Error('the request room did not open');
  });
  if (await app.evaluate(app.exists('[aria-label="Back to chats"]'))) await app.click('[aria-label="Back to chats"]');

  const openSettings = async () => {
    if (!(await app.evaluate(app.exists('[data-testid=assistant-key-state]')))) await app.click('[aria-label=Settings]');
    if (!(await app.waitFor(app.exists('[data-testid=assistant-key-state]'), 20_000))) throw new Error('settings did not load');
  };
  await app.shot('settings', async () => {
    await openSettings();
    await app.click('[data-testid=engine-detect]');
    if (!(await app.waitFor(app.exists('[data-testid=engine-status]'), 30_000))) throw new Error('engine detection did not answer');
    await app.evaluate(`document.querySelector('[data-testid=send-key-select]').closest('section').scrollIntoView({ block: 'start' }); true`);
  });

  await app.shot('settings-diagnostics', async () => {
    // Fixture counts: what three messages with their acknowledgements cost.
    await app.evaluate(`window.desktop.diagnostics.add({ submissions: 6, acknowledgements: 4, messages: 3 }); true`);
    await openSettings();
    // The fixture's 3 messages, plus what this run sent for real (the pirate request).
    if (!(await app.waitFor(`/\\(\\d+ \\/ [1-9]\\d*\\)/.test(document.querySelector('[data-testid=submissions-per-message]')?.textContent ?? '')`, 10_000))) {
      throw new Error(`the Diagnostics section does not show the counts: ${JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=diagnostics]')?.innerText ?? 'no section'`))}`);
    }
    log('diagnostics:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=diagnostics]').innerText.replace(/\\s+/g, ' ')`)));
    await app.evaluate(`document.querySelector('[data-testid=diagnostics]').closest('section').scrollIntoView({ block: 'center' }); true`);
  });

  await app.shot('keyboard', async () => {
    await openSettings();
    await app.evaluate(`document.querySelector('[data-testid=keyboard-shortcuts]').closest('section').scrollIntoView({ block: 'center' }); true`);
  });
  if (await app.evaluate(app.exists('[data-testid=assistant-key-state]'))) await app.esc();

  await manageShots(app, log);
  await paymentShots(app, log, pay);
  await group2Shots(app);
  if (WORKER_SHOTS.main.slice(-2).some(wanted)) await demoShots(app, log);
};

/** M12e and M12f: chat-menu, archived, settings-privacy, room-meter. */
const manageShots = async (app, log) => {
  const toList = async () => {
    if (await app.evaluate(app.exists('[data-testid=assistant-key-state]'))) await app.esc();
    if (await app.evaluate(app.exists('[aria-label="Back to chats"]'))) await app.click('[aria-label="Back to chats"]');
  };
  const maya = MANAGE.contacts[0];
  await app.shot('chat-menu', async () => {
    await toList();
    if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=chat-row]')].some(r => r.textContent.includes(${JSON.stringify(maya.nickname)}))`, 20_000))) {
      throw new Error('the fixture contacts are not in the list');
    }
    const more = `[aria-label=${JSON.stringify(`More for ${maya.nickname}`)}]`;
    // The "More" button shows on the row's hover.
    await app.hoverAt(`[...document.querySelectorAll('[data-testid=chat-row]')].find(r => r.textContent.includes(${JSON.stringify(maya.nickname)}))`);
    await app.pressOn(more);
    if (!(await app.waitFor(`${app.exists('[data-testid=chat-menu]')} && ${app.exists('[data-testid=menu-delete]')}`, 10_000))) throw new Error('the row menu did not open');
    log('row menu:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=chat-menu]').innerText.replace(/\\s+/g, ' ')`)));
  });
  if (await app.evaluate(app.exists('[data-testid=chat-menu]'))) {
    await app.esc();
    await app.waitFor(`!${app.exists('[data-testid=chat-menu]')}`, 5_000);
  }
  // Esc gives the focus back to the row's "More" button; the next shot is of the list at rest.
  await app.evaluate('document.activeElement?.blur(); true');
  await app.shot('archived', async () => {
    await toList();
    if (!(await app.waitFor(app.exists('[data-testid=archived-toggle]'), 10_000))) throw new Error('no Archived section');
    if ((await app.evaluate(`document.querySelector('[data-testid=archived-toggle]').getAttribute('aria-expanded')`)) !== 'true') await app.click('[data-testid=archived-toggle]');
    if (!(await app.waitFor(`[...document.querySelectorAll('[data-testid=archived-section] [data-testid=chat-row]')].length === 2`, 10_000))) throw new Error('the archived chats did not show');
    if (!(await app.evaluate(`[...document.querySelectorAll('[data-testid=chat-row-outgoing]')].some(r => r.textContent.includes('No answer yet'))`))) throw new Error('the pending request row has no "No answer yet"');
  });
  await app.shot('settings-privacy', async () => {
    await app.click('[aria-label=Settings]');
    if (!(await app.waitFor(app.exists('[data-testid=blocked-list]'), 20_000))) throw new Error('no blocked list in Settings');
    await app.evaluate(`document.querySelector('[data-testid=blocked-list]').closest('section').scrollIntoView({ block: 'center' }); true`);
  });
  await toList();
  await app.shot(
    'room-meter',
    async () => {
      await openRow(app, METER.username);
      // The chain read at the best block: the amount appears once the Meter answered.
      if (!(await app.waitFor(app.exists('[data-testid=bot-balance-amount]'), 60_000))) throw new Error('no balance with a pending split in the header');
      // Hover the number (a hidden window gets no focus events).
      await app.hoverAt(`document.querySelector('[data-testid=bot-balance-amount]')`);
      if (!(await app.waitFor(app.exists('[data-testid=bot-balance-split]'), 10_000))) throw new Error('the tooltip did not open');
      await app.settle();
      log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=bot-balance]').innerText`)), 'tooltip:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=bot-balance-split]').innerText`)));
    },
    { hover: true },
  );
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: HEIGHT - 1 });
};

/** M12g: room-request, send-pas, room-request-paid. */
const paymentShots = async (app, log, pay) => {
  await app.shot('room-request', async () => {
    await openRow(app, pay.ask.username);
    if (!(await app.waitFor(`${app.exists('[data-testid=keyboard-button][data-action=tx]')} && ${app.exists('[data-testid=request-decline]')}`, 20_000))) throw new Error('no Pay and Decline under the request');
    log('request:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=message-incoming]')].pop().innerText.replace(/\\s+/g, ' ')`)));
  });
  await app.shot('send-pas', async () => {
    await openRow(app, pay.ask.username);
    if (!(await app.waitFor(app.exists('[data-testid=composer-plus]'), 30_000))) throw new Error('no "+" in the composer (Asset Hub not open?)');
    await app.pressOn('[data-testid=composer-plus]');
    if (!(await app.waitFor(app.exists('[data-testid=plus-send-pas]'), 10_000))) throw new Error('the "+" menu did not open');
    await app.click('[data-testid=plus-send-pas]');
    if (!(await app.waitFor(app.exists('[data-testid=payment-row][data-kind=send]'), 10_000))) throw new Error('no amount row');
    await app.type('[data-testid=payment-amount]', '1.5');
    await app.type('[data-testid=payment-note]', 'Your ticket');
    await app.waitFor(`!document.querySelector('[data-testid=payment-submit]').disabled`, 5_000);
  });
  // Not a shot: Review opens the signing strip after the dry-run; Cancel closes it. Nothing is signed.
  if (wanted('send-pas') && (await app.evaluate(app.exists('[data-testid=payment-submit]')))) {
    await app.click('[data-testid=payment-submit]');
    if (await app.waitFor(`document.querySelector('[data-testid=tx-strip]')?.dataset.phase === 'ready'`, 60_000)) {
      log('send strip:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=tx-strip]').innerText.replace(/\\s+/g, ' ')`)));
    } else {
      missing.push(`send-pas Review check (the strip did not become ready: ${JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=tx-strip]')?.innerText.replace(/\\s+/g, ' ') ?? 'no strip'`))})`);
    }
    await app.clickText('[data-testid=tx-strip] button', 'Cancel');
  }
  // The amount row is local state: leaving the room drops it.
  await app.esc();
  await app.shot('room-request-paid', async () => {
    if (!pay.paid) throw new Error(pay.paidMissing);
    await openRow(app, pay.paid.username);
    // The app reads the extrinsic's Balances.Transfer on the chain before it says "Paid".
    if (!(await app.waitFor(app.exists('[data-testid=payment-request][data-state=paid]'), 60_000))) {
      throw new Error(`the request did not turn paid: ${JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=payment-request-state]')?.innerText ?? 'no request bubble'`))}`);
    }
    log('paid:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=payment-request]').innerText.replace(/\\s+/g, ' ')`)));
  });
  await app.esc();
};

/**
 * M13 settings-agent: the agent published for real on devnet, with a test
 * identity (PCD_SCREENSHOT_AGENT_IDENTITY, default pcdbenchcold) as its own,
 * audience "My contacts only"; the shot waits until bot-core runs and its
 * lines are in the log.
 */
const agentShots = async (app, log, profile) => {
  await app.shot('settings-agent', async () => {
    if (!existsSync(agentIdentitySource)) throw new Error(`no agent test identity at ${agentIdentitySource}`);
    mkdirSync(join(profile, 'agent'), { recursive: true, mode: 0o700 });
    if (!(await app.evaluate('window.desktop.agent.status().then(s => !!s.identity)'))) await seedIdentityFile(profile, agentIdentitySource, join(profile, 'agent', 'identity.json'));
    await app.evaluate(`window.desktop.agent.update({ enabled: true, audience: 'contacts' }).then(() => true)`);
    await app.click('[aria-label=Settings]');
    if (!(await app.waitFor(`${app.exists('[data-testid=agent-settings]')} && ${app.exists('[data-testid=agent-username]')}`, 20_000))) throw new Error('no published agent in Settings');
    if (!(await app.waitFor(`window.desktop.agent.status().then(s => s.state === 'running' && s.log.length >= 2)`, 90_000))) throw new Error('the agent did not start');
    await sleep(3000);
    await app.evaluate(`document.querySelector('[data-testid=agent-settings]').closest('section').scrollIntoView({ block: 'start' }); true`);
    log('settings agent:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=agent-settings]').innerText.replace(/\\s+/g, ' ').slice(0, 300)`)));
  });
  await app.esc();
};

/** M12i: fixture pending requests to two demo bots with no state yet (fixed ids, removed after). */
const DEMO_FIXTURE_IDS = ['fixture-demo-sent', 'fixture-demo-silent'];
const demoShots = async (app, log) => {
  const rowsReady = `document.querySelectorAll('[data-testid=demo-row]').length > 0`;
  // The mark sign-up sets; the chat screen shows the step once after a reload.
  await app.evaluate(`localStorage.setItem('pcd-demo-intro', '1'); true`);
  await app.reload(`${app.exists('[data-testid=demo-intro]')} && ${rowsReady}`);
  // Two bots with no status yet get a fixture request (after the live rows loaded).
  await sleep(1000);
  const free = await app.evaluate(`[...document.querySelectorAll('[data-testid=demo-row]')].filter(r => !r.querySelector('[data-testid=demo-status]')).map(r => r.dataset.username)`);
  const rows = free.slice(0, 2).map((username, index) => {
    // "Sent" lasts 15 s from its time; the reload and the chat start take a few of them.
    const at = index === 0 ? Date.now() + 10_000 : Date.now() - 60_000;
    return { requestId: DEMO_FIXTURE_IDS[index], peerAccountId: account(index === 0 ? 'd1' : 'd2'), peerUsername: username, peerChatPublicKey: fill(32, 7),
      direction: 'outgoing', status: 'pending', welcomeMessage: 'Hi!', timestamp: at, senderDevice: null, createdAt: at };
  });
  log('demo fixture requests:', rows.map(row => row.peerUsername).join(', ') || 'none (every bot has a state)');
  await writeRows(app, { requests: rows });
  await app.evaluate(`localStorage.setItem('pcd-demo-intro', '1'); true`);
  await app.reload(`${app.exists('[data-testid=demo-intro]')} && ${rowsReady}`);
  await app.shot('demo-onboarding', async () => {
    // The button reads "Start chats with all" once the chat manager runs.
    if (!(await app.waitFor(`!document.querySelector('[data-testid=demo-start-all]').disabled`, 60_000))) throw new Error('the chat did not start (the button stays disabled)');
    log('demo intro:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=demo-intro]').innerText.replace(/\\s+/g, ' ')`)));
  });
  if (await app.evaluate(app.exists('[data-testid=demo-skip]'))) await app.click('[data-testid=demo-skip]');
  await app.shot('settings-demo', async () => {
    await app.click('[aria-label=Settings]');
    if (!(await app.waitFor(`${app.exists('[data-testid=demo-settings]')} && document.querySelectorAll('[data-testid=demo-settings] [data-testid=demo-row]').length > 0`, 20_000))) throw new Error('no Demo section in Settings');
    await app.evaluate(`document.querySelector('[data-testid=demo-settings]').closest('section').scrollIntoView({ block: 'center' }); true`);
  });
};

// ── Worker: the Faucet and the coin flip (live) ──────────────────────────

const flipWorker = async () => {
  const log = logger('flip');
  if (!existsSync(identityFile(flipIdentity))) {
    for (const name of WORKER_SHOTS.flip.filter(wanted)) miss(name, `no .agent-runs/identity-${flipIdentity}`);
    return;
  }
  // The second player: drips, accepts pcdflip and waits for STAKE on its stdin.
  const flips = ['room-flip', 'room-flip-done'].some(wanted);
  const peerLog = join(outDir, 'flip-peer.log');
  writeFileSync(peerLog, '');
  const lines = [];
  const peer = flips
    ? spawn('node', ['scripts/e2e-flip.mjs', '--role', 'b', '--identity', flipWith], { cwd: root, stdio: ['pipe', 'pipe', openSync(join(outDir, 'flip-peer.err.log'), 'w')] })
    : null;
  peer?.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      lines.push(line);
      writeFileSync(peerLog, `${line}\n`, { flag: 'a' });
    }
  });
  let app = null;
  let profile = null;
  try {
    ({ app, profile } = await openSeeded(identityFile(flipIdentity), await portFor(2), log));
    await connected(app);
    log('seeded', flipIdentity);
    await faucetShot(app, log);
    if (flips) await flipShots(app, log, lines, peer);
  } catch (error) {
    missing.push(`flip worker: ${error.message}`);
    log('stopped:', error.message);
  } finally {
    peer?.stdin.write('EXIT\n');
    peer?.kill('SIGTERM');
    await app?.quit();
    if (profile) rmSync(profile, { recursive: true, force: true });
  }
};

/** "Get 1 PAS": the embedded Faucet's own transfer (pending row, reference, balance), then the url strip. Also funds the stake. */
const faucetShot = async (app, log) => {
  if (!wanted('faucet') && !(await needsDrip(app))) return;
  await app.shot('faucet', async () => {
    if (!(await app.waitFor(app.exists('[data-testid=chat-row-faucet]'), 10_000)) || !(await app.click('[data-testid=chat-row-faucet]'))) throw new Error('no Faucet row in the chat list');
    if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === 'Faucet' && ${app.exists('[data-testid=keyboard]')}`, 10_000))) throw new Error('the Faucet room did not open with its keyboard');
    const dripButton = `[...document.querySelectorAll('[data-testid=keyboard] [data-action=command]')].find(b => b.textContent.includes('Get 1 PAS'))`;
    await app.evaluate(`${dripButton}.click(); true`);
    if (!(await app.waitFor(`${app.exists('[data-testid=live-frame]')} && ${dripButton}.getAttribute('aria-busy') === 'true'`, 10_000))) throw new Error('"Get 1 PAS" shows no pending row or spinner');
    await app.evaluate(`${dripButton}.click(); true`);
    await sleep(300);
    if ((await app.evaluate(`document.querySelectorAll('[data-testid=live-frame]').length`)) !== 1) missing.push('faucet: a second "Get 1 PAS" press stacked a row');
    const ended = `[...document.querySelectorAll('[data-testid=message-system]')].some(r => /Balance now|did not answer|empty|Try again|devnet/.test(r.textContent))`;
    if (!(await app.waitFor(ended, 120_000))) throw new Error('the Faucet room shows no outcome of "Get 1 PAS"');
    if (!(await app.evaluate(`[...document.querySelectorAll('[data-testid=message-system]')].some(r => /Balance now/.test(r.textContent))`))) missing.push('faucet: "Get 1 PAS" did not end with a balance');
    log('faucet room:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=messages]').innerText.replace(/\\s+/g, ' ').slice(-200)`)));
    await app.evaluate(`document.querySelector('[data-testid=keyboard] [data-action=url]').click(); true`);
    if (!(await app.waitFor(app.exists('[data-testid=url-confirm]'), 5_000))) throw new Error('no confirm strip for "Get test funds"');
  });
  // Leave the strip unanswered: Open would start the browser.
  await app.esc();
};
/** Without the faucet shot, drip only when the balance is below a stake and its fees. */
const needsDrip = async app => {
  await app.waitFor(`/\\d PAS/.test(document.querySelector('[data-testid=balance-chip]')?.textContent ?? '')`, 30_000);
  const text = await app.evaluate(`document.querySelector('[data-testid=balance-chip]')?.textContent ?? ''`);
  const amount = Number(/([\d.]+) PAS/.exec(text)?.[1] ?? 0);
  return amount < 0.6;
};

const flipShots = async (app, log, lines, peer) => {
  const flipTitle = `/^${FLIP_BOT}\\.\\d{2}$/.test(document.querySelector('[data-testid=room-title]')?.textContent ?? '')`;
  const stakeKeyboard = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=keyboard]')].filter(k => [...k.querySelectorAll('[data-action=tx]:not([disabled])')].some(b => b.textContent.includes('Stake'))).pop()`;
  const settledRefs = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=tx-reference]')].filter(r => r.textContent.includes('Flip settled'))`;
  const settledCount = `${settledRefs}.length`;
  const settledRef = `${settledRefs}.pop()`;
  const strip = `document.querySelector('[data-testid=tx-strip]')`;
  let staked = false;
  await app.shot('room-flip', async () => {
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
    if (!(await app.waitFor(`${flipTitle} && ${app.exists('[aria-label=Send]')}`, 120_000))) throw new Error(`${FLIP_BOT} did not accept the request`);
    if (!(await app.waitFor(`${stakeKeyboard} != null`, 45_000))) {
      await app.type('textarea[aria-label=Message]', '/stake');
      await app.click('[aria-label=Send]');
      if (!(await app.waitFor(`${stakeKeyboard} != null`, 60_000))) throw new Error(`no Stake button from ${FLIP_BOT}`);
    }
    const pressStake = async () => {
      await app.evaluate(`${stakeKeyboard}.querySelector('[data-action=tx]').click(); true`);
      if (!(await app.waitFor(`['ready', 'refused'].includes(${strip}?.dataset.phase)`, 60_000))) throw new Error('the stake strip did not finish its dry-run');
      const text = await app.evaluate(`${strip}.innerText.replace(/\\s+/g, ' ')`);
      log('flip strip:', JSON.stringify(text));
      return { ready: (await app.evaluate(`${strip}.dataset.phase`)) === 'ready', text };
    };
    let dryRun = await pressStake();
    if (!dryRun.ready && /already staked/.test(dryRun.text)) {
      // Our stake from an earlier run still waits in the (global) contract: the second player settles that round first.
      log('our earlier stake still waits; the second player settles it');
      await app.evaluate(`[...document.querySelectorAll('[data-testid=tx-strip] button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);
      const settledBefore = await app.evaluate(settledCount);
      await secondStake(lines, peer);
      if (!(await app.waitFor(`${settledCount} > ${settledBefore}`, 90_000))) throw new Error('the earlier round did not settle');
      dryRun = await pressStake();
    }
    if (!dryRun.ready) throw new Error(`the dry-run refused the stake: ${dryRun.text}`);
    await app.evaluate(`${strip}.scrollIntoView({ block: 'end' }); true`);
    staked = true;
  });
  await app.shot('room-flip-done', async () => {
    if (!staked && !(await app.evaluate(`${strip}?.dataset.phase === 'ready'`))) throw new Error('no stake strip to sign');
    const before = await app.evaluate(`document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]').length`);
    const settledBefore = await app.evaluate(settledCount);
    await app.click('[data-testid=tx-sign]');
    const own = `[...document.querySelectorAll('[data-testid=message-outgoing] [data-testid=tx-reference]')][${before}]`;
    if (!(await app.waitFor(`${own} != null && ['inBlock', 'finalized'].includes(${own}.dataset.status)`, 90_000))) throw new Error('the stake did not reach a block');
    log('stake:', JSON.stringify(await app.evaluate(`${own}.innerText`)));
    const settled = `${settledCount} > ${settledBefore}`;
    // A stake already waiting (someone else's) settles with ours; else the second player stakes.
    if (!(await app.waitFor(settled, 10_000))) {
      const from = lines.length;
      await secondStake(lines, peer, 0);
      // The second player's own failure ends the wait at once (its line names the chain's error).
      for (const until = Date.now() + 120_000; Date.now() < until && !(await app.evaluate(settled)); await sleep(250)) {
        const failed = lines.slice(from).find(line => /^STAKE_FAILED /.test(line));
        if (failed) throw new Error(`the second player's stake failed: ${failed.slice('STAKE_FAILED '.length)}`);
      }
    }
    if (!(await app.evaluate(settled))) throw new Error('no "Flip settled" reference from the bot (see .agent-runs/screens/flip-peer.log)');
    log('settled:', JSON.stringify(await app.evaluate(`${settledRef}.innerText`)));
    await app.evaluate(`${settledRef}.scrollIntoView({ block: 'center' }); true`);
  });
};

/**
 * The second player stakes. `wait` (ms): how long to wait for its STAKED line
 * (0: return once the command is sent).
 */
const secondStake = async (lines, peer, wait = 120_000) => {
  for (let i = 0; i < 480 && !lines.some(line => /^READY /.test(line)); i++) await sleep(250);
  if (!lines.some(line => /^READY /.test(line))) throw new Error('the second player never got ready (see .agent-runs/screens/flip-peer.log)');
  const from = lines.length;
  peer.stdin.write('STAKE\n');
  console.log(elapsed(), '[flip]', 'second player stakes');
  for (const until = Date.now() + wait; Date.now() < until; await sleep(250)) {
    const line = lines.slice(from).find(entry => /^STAKED |^STAKE_FAILED /.test(entry));
    if (line?.startsWith('STAKE_FAILED')) throw new Error(`the second player's stake failed: ${line.slice('STAKE_FAILED '.length)}`);
    if (line) return;
  }
  if (wait > 0) throw new Error('the second player did not stake in time');
};

// ── Worker: the group of three and a bot's "working…" (live) ────────────

const groupWorker = async () => {
  const log = logger('group');
  if (!existsSync(identityFile(groupIdentity)) || !existsSync(identityFile(groupWith))) {
    for (const name of WORKER_SHOTS.group.filter(wanted)) miss(name, `no .agent-runs/identity-${groupIdentity} or identity-${groupWith}`);
    return;
  }
  const self = JSON.parse(readFileSync(identityFile(groupIdentity), 'utf8'));
  const memberName = JSON.parse(readFileSync(identityFile(groupWith), 'utf8')).username;
  const groups = ['group-create', 'room-group', 'group-members'].some(wanted);
  // The second group member: waits for commands on its stdin (e2e-group.mjs child protocol).
  const peerLog = join(outDir, 'group-peer.log');
  writeFileSync(peerLog, '');
  const lines = [];
  const member = groups
    ? spawn('node', ['scripts/e2e-group.mjs', '--role', 'b', '--identity', groupWith, '--other', self.accountHex, '--bot', GROUP_BOT], {
        cwd: root,
        stdio: ['pipe', 'pipe', openSync(join(outDir, 'group-peer.err.log'), 'w')],
      })
    : null;
  member?.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      lines.push(line);
      writeFileSync(peerLog, `${line}\n`, { flag: 'a' });
    }
  });
  /** Sends a command to the member; its first answer line matching `pattern`, or null. */
  const ask = async (command, pattern, ms) => {
    const from = lines.length;
    member.stdin.write(`${command}\n`);
    for (const until = Date.now() + ms; Date.now() < until; await sleep(200)) {
      const hit = lines.slice(from).find(line => pattern.test(line));
      if (hit) return hit;
    }
    return null;
  };
  let app = null;
  let profile = null;
  try {
    ({ app, profile } = await openSeeded(identityFile(groupIdentity), await portFor(3), log));
    await connected(app);
    log('seeded', groupIdentity);
    // The member's slow steps (connect, its bot chat, its request) run while the app opens its bot room.
    const memberRequest = groups ? memberRequestArrived(app, log, lines, ask, memberName) : null;
    // Seen by the runtime at once, so a failure before the await is not unhandled.
    memberRequest?.catch(() => undefined);
    await openBotRoom(app, log);
    await app.shot('room-typing', async () => {
      await openRow(app, GROUP_BOT);
      await app.type('textarea[aria-label=Message]', 'What is a parachain, in one line?');
      await app.click('[aria-label=Send]');
      // Spec 0005: a known bot shows the local "working…" until its reply.
      if (!(await app.waitFor(app.exists('[data-testid=typing-indicator][data-kind=working]'), 20_000))) throw new Error(`no working… after a message to ${GROUP_BOT}`);
      log('header:', JSON.stringify(await app.evaluate(`document.querySelector('[data-testid=typing-indicator]').textContent`)));
    });
    if (groups) {
      try {
        await memberRequest;
        await acceptMember(app, log, ask, memberName);
      } catch (error) {
        for (const name of ['group-create', 'room-group', 'group-members'].filter(wanted)) miss(name, error.message);
        throw error;
      }
      await groupShots(app, log, ask, memberName);
    }
  } catch (error) {
    missing.push(`group worker: ${error.message}`);
    log('stopped:', error.message);
  } finally {
    member?.stdin.write('EXIT\n');
    member?.kill('SIGTERM');
    await app?.quit();
    if (profile) rmSync(profile, { recursive: true, force: true });
  }
};

/** The member connects, opens its chat with the bot and sends us a request; resolves once that very request is in the app's store. */
const memberRequestArrived = async (app, log, lines, ask, memberName) => {
  for (let i = 0; i < 960 && !lines.some(line => /^READY /.test(line)); i++) await sleep(250);
  if (!lines.some(line => /^READY /.test(line))) throw new Error('the group member never got ready (see .agent-runs/screens/group-peer.log)');
  const botLine = await ask('OPEN_BOT', /^BOT_CONTACT |_FAILED /, 150_000);
  if (!botLine || /_FAILED/.test(botLine)) throw new Error(`the group member could not open ${GROUP_BOT}: ${botLine}`);
  const sentAt = Date.now();
  const sent = await ask('REQUEST_OTHER', /^REQUEST_SENT |_FAILED /, 60_000);
  if (!sent || /_FAILED/.test(sent)) throw new Error(`the member's request did not go out: ${sent}`);
  const requestId = /id=(\S+)/.exec(sent)?.[1];
  // This very request (by id), not an older one from an earlier run replayed from the network.
  const arrived = `new Promise(done => { const open = indexedDB.open('polkadot-chat-web'); open.onsuccess = () => { const get = open.result.transaction('requests').objectStore('requests').get(${JSON.stringify(requestId)}); get.onsuccess = () => { open.result.close(); done(!!get.result); }; get.onerror = () => done(false); }; open.onerror = () => done(false); })`;
  if (!(await app.waitFor(arrived, 120_000))) throw new Error(`the request of ${memberName} (${requestId}) did not arrive`);
  log('request of', memberName, 'arrived', ((Date.now() - sentAt) / 1000).toFixed(1), 's after it was sent');
};

/** Accepts the member's request: the list shows the newest request per person, which is the one that arrived. */
const acceptMember = async (app, log, ask, memberName) => {
  if (await app.evaluate(app.exists('textarea[aria-label=Message]'))) await app.esc();
  if (!(await app.waitFor(app.exists('[data-testid=new-requests]'), 10_000))) throw new Error('no "New requests"');
  await app.click('[data-testid=new-requests]');
  const row = `[...document.querySelectorAll('[data-testid=incoming-request]')].find(r => r.textContent.includes(${JSON.stringify(memberName)}))`;
  if (!(await app.waitFor(`!!${row}`, 30_000))) throw new Error(`no request from ${memberName} in the list`);
  await app.evaluate(`${row}.click()`);
  await app.waitFor(app.exists('[data-testid=request-banner]'), 10_000);
  await app.clickText('[data-testid=request-banner] button', 'Accept');
  if (!(await ask('WAIT_CONTACT', /^CONTACT /, 120_000))) throw new Error(`${memberName} never saw the accept`);
  log('contact with', memberName);
  if (await app.evaluate(app.exists('[aria-label="Back to chats"]'))) await app.click('[aria-label="Back to chats"]');
};

/** Our chat with the bot: a request from a global search hit, accepted by the bot. */
const openBotRoom = async (app, log) => {
  const row = `[...document.querySelectorAll('[data-testid=chat-row]')].some(r => r.textContent.includes(${JSON.stringify(GROUP_BOT)}))`;
  if (await app.evaluate(row)) return;
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
  // The bot's botInfo makes it a known bot (the local "working…").
  if (!(await app.waitFor(app.exists('header [data-testid=bot-badge]'), 30_000))) log(`no botInfo from ${GROUP_BOT} yet`);
  log('contact with', GROUP_BOT);
  await app.esc();
};

/** M16: the fixture private group's room and its members panel. */
const group2Shots = async app => {
  const row = `[...document.querySelectorAll('[data-testid=chat-row-group]')].find(r => r.textContent.includes(${JSON.stringify(GROUP2.name)}))`;
  const openRoom = async () => {
    if (await app.evaluate(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(GROUP2.name)}`)) return;
    if (await app.evaluate(app.exists('[aria-label="Back to chats"]'))) await app.click('[aria-label="Back to chats"]');
    if (await app.evaluate(app.exists('[data-testid=assistant-key-state]'))) await app.esc();
    if (!(await app.waitFor(`!!${row}`, 10_000))) throw new Error('the fixture private group is not in the list');
    await app.evaluate(`${row}.click(); true`);
    if (!(await app.waitFor(`(document.querySelector('[data-testid=group-status]')?.textContent ?? '').includes('epoch 2')`, 10_000))) throw new Error('the group header does not show the epoch');
  };
  await app.shot('room-group2', async () => {
    await openRoom();
    if (await app.evaluate(app.exists('[data-testid=members-panel]'))) await app.click('[data-testid=members-toggle]');
    await app.settle();
  });
  const openPanel = async () => {
    await openRoom();
    if (!(await app.evaluate(app.exists('[data-testid=members-panel]')))) await app.click('[data-testid=members-toggle]');
    if (!(await app.waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 10_000))) throw new Error('the members panel does not list three members');
  };
  await app.shot('room-pinned', async () => {
    await openRoom();
    if (await app.evaluate(app.exists('[data-testid=members-panel]'))) await app.click('[data-testid=members-toggle]');
    if (!(await app.waitFor(`(document.querySelector('[data-testid=pin-text]')?.textContent ?? '').includes('trailhead')`, 10_000))) throw new Error('the pin bar does not show the pinned message');
    await app.settle();
  });
  await app.shot('group-invite', async () => {
    await openPanel();
    if (!(await app.waitFor(app.exists('[data-testid=join-request]'), 10_000))) throw new Error('the join request is not in the panel');
    await app.evaluate(`document.querySelector('[data-testid=join-requests]').scrollIntoView({ block: 'start' }); true`);
    await app.settle();
  });
  await app.shot('group-roles', async () => {
    await openPanel();
    await app.evaluate(`document.querySelector('[data-testid=members-panel] .overflow-y-auto')?.scrollTo(0, 0); true`);
    if (!(await app.evaluate(app.exists('[data-testid=role-editor]')))) {
      await app.evaluate(`[...document.querySelectorAll('[data-testid=member-manage]')].find(e => e.textContent.includes(${JSON.stringify(GROUP2.lena.username)})).click(); true`);
    }
    if (!(await app.waitFor(app.exists('[data-testid=role-editor]'), 5_000))) throw new Error('the role editor did not open');
    await app.settle();
  });
  await app.shot(
    'group2-members',
    async () => {
      await openRoom();
      if (!(await app.evaluate(app.exists('[data-testid=members-panel]')))) await app.click('[data-testid=members-toggle]');
      if (!(await app.waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 10_000))) throw new Error('the members panel does not list three members');
      // group-roles leaves an editor open: this shot is the plain list.
      await app.evaluate(`document.querySelector('[data-testid=member-manage][aria-expanded=true]')?.click(); true`);
      await app.settle();
      // The owner's Remove shows on the hovered row (design system §10: on hover, undoable).
      await app.hoverAt(`[...document.querySelectorAll('[data-testid=member-row]')].find(e => e.textContent.includes(${JSON.stringify(GROUP2.lena.username)}))`);
      await sleep(400);
    },
    { hover: true },
  );
};

const groupShots = async (app, log, ask, memberName) => {
  const groupRow = `[...document.querySelectorAll('[data-testid=chat-row-group]')].find(r => r.textContent.includes(${JSON.stringify(GROUP_NAME)}))`;
  if (await app.evaluate(app.exists('textarea[aria-label=Message]'))) await app.esc();
  await app.shot('group-create', async () => {
    await app.click('[aria-label="New chat"]');
    if (!(await app.waitFor(app.exists('[data-testid=new-group]'), 5_000))) throw new Error('no "New group" in the New chat panel');
    await app.click('[data-testid=new-group]');
    if (!(await app.waitFor(app.exists('[aria-label="Group name"]'), 5_000))) throw new Error('the New group view did not open');
    await app.type('[aria-label="Group name"]', GROUP_NAME);
    for (const name of [memberName, GROUP_BOT]) {
      const box = `[...document.querySelectorAll('[data-testid=group-candidate]')].find(r => r.textContent.includes(${JSON.stringify(name)}))?.querySelector('[role=checkbox]')`;
      if (!(await app.waitFor(`!!${box}`, 10_000))) throw new Error(`${name} is not among the contacts to pick`);
      await app.evaluate(`${box}.click(); true`);
    }
    if (!(await app.waitFor(`document.querySelectorAll('[data-testid=group-candidate] [role=checkbox][data-state=checked]').length === 2 && !document.querySelector('[data-testid=group-create]').disabled`, 5_000))) {
      throw new Error('the two members are not checked');
    }
  });
  await app.shot('room-group', async () => {
    if (!(await app.evaluate(app.exists('[data-testid=group-create]:not([disabled])')))) throw new Error('nothing to create');
    await app.click('[data-testid=group-create]');
    if (!(await app.waitFor(`document.querySelector('[data-testid=room-title]')?.textContent === ${JSON.stringify(GROUP_NAME)} && ${app.exists('[data-testid=group-status]')}`, 30_000))) throw new Error('the group room did not open');
    const joined = await ask('WAIT_GROUP any', /^JOINED /, 90_000);
    if (!joined) throw new Error(`${memberName} did not receive the roster (see .agent-runs/screens/group-peer.log)`);
    await app.type('textarea[aria-label=Message]', 'hello all');
    await app.click('[aria-label=Send]');
    await sleep(2_000);
    const said = await ask(`SEND Hi! ${memberName} here, ready for Saturday.`, /^SENT |_FAILED /, 60_000);
    if (!said || /_FAILED/.test(said)) throw new Error(`${memberName} could not post: ${said}`);
    const peerText = `[...document.querySelectorAll('[data-testid=message-incoming]')].some(m => m.textContent.includes(${JSON.stringify(memberName)}))`;
    if (!(await app.waitFor(peerText, 60_000))) throw new Error(`no message from ${memberName} with its sender name`);
    // The bot's reply, if it runs group-aware code: a third sender name.
    const botText = `[...document.querySelectorAll('[data-testid=message-incoming] [data-testid=sender-name]')].some(n => n.textContent === ${JSON.stringify(GROUP_BOT)}) && !document.querySelector('[data-testid=live-frame]')`;
    if (!(await app.waitFor(botText, 60_000))) missing.push(`room-group.png: no reply from ${GROUP_BOT} in 60 s; taken with two senders`);
    log('group senders:', JSON.stringify(await app.evaluate(`[...document.querySelectorAll('[data-testid=sender-name]')].map(n => n.textContent)`)));
  });
  await app.shot(
    'group-members',
    async () => {
      if (!(await app.evaluate(app.exists('[data-testid=group-status]')))) {
        if (!(await app.waitFor(`!!${groupRow}`, 5_000))) throw new Error('the group room is not open');
        await app.evaluate(`${groupRow}.click()`);
      }
      if (!(await app.evaluate(app.exists('[data-testid=members-panel]')))) await app.click('[data-testid=members-toggle]');
      if (!(await app.waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 10_000))) throw new Error('the members panel does not list three members');
      await app.settle();
      // Hover the member's row: the admin's Remove shows (design system §10).
      await app.hoverAt(`[...document.querySelectorAll('[data-testid=member-row]')].find(e => e.textContent.includes(${JSON.stringify(memberName)}))`);
      await sleep(400);
    },
    { hover: true },
  );
};

// ── Run the workers at the same time ─────────────────────────────────────

const workers = { signup: signupWorker, main: mainWorker, flip: flipWorker, group: groupWorker };
await Promise.all(
  Object.entries(workers)
    .filter(([name]) => needs(name))
    .map(([name, run]) =>
      run().catch(error => {
        missing.push(`${name} worker: ${error.message}`);
      }),
    ),
);

const seconds = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\nPNGs:');
for (const file of saved) console.log(`  ${file.slice(root.length + 1)}`);
if (missing.length > 0) {
  console.log('\nNot captured:');
  for (const entry of missing) console.log(`  ${entry}`);
  console.log(`SCREENSHOTS_PARTIAL in ${seconds} s`);
  process.exit(1);
}
console.log(`SCREENSHOTS_OK in ${seconds} s`);
