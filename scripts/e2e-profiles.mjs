#!/usr/bin/env node
// M18 e2e: two profiles (two identities) on one computer, side by side.
//   npm run e2e:profiles
// Headless (PCD_HEADLESS=1), one throwaway userData root (PCD_USER_DATA_DIR).
// 1. Profile a and profile b start at once (`--profile a`, `--profile b`),
//    each on an empty profile folder, and each signs up a fresh username on
//    devnet through the app's own sign-up call (pcdprofa… / pcdprofb…).
//    Both apps quit. profiles.json must list both with their usernames
//    (PROFILES_CREATED).
// 2. Both start again at once from the same root. Each must answer its own
//    identity (IDENTITY_OK), the other's running mark must show in its
//    profile list (RUNNING_OK), and a third start of `--profile a` must end
//    at once with PROFILE_ALREADY_OPEN while a runs (LOCK_OK).
// 3. b finds a by global search and sends a chat request with a message; a
//    receives it (REQUEST_OK), accepts, b sends a second message, a receives
//    it (MESSAGES_OK).
// 4. M19 recovery phrase: a shows its phrase in Settings › Security after
//    typing "reveal" (12 words; another word is refused: REVEAL_OK). a quits,
//    b removes profile a, and a picker process restores a's phrase into a
//    new profile, which opens as a's account and username (RESTORE_OK):
//    PROFILES_OK. The phrase stays in this process's memory; it is never
//    printed.
// Exit 0 PROFILES_OK; 1 PROFILES_FAIL <why>. Prints no secret.

import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build, launch, root as repo } from './lib/app.mjs';

const t0 = Date.now();
const log = (...parts) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...parts);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const letters = n => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join('');
const NETWORK = 'devnet';

build();
log('built');
const userData = mkdtempSync(join(tmpdir(), 'pcd-e2e-profiles-'));
const suffix = letters(4);
const want = { a: `pcdprofa${suffix}`, b: `pcdprofb${suffix}` };
const apps = {};
let code = 1;

const fail = message => {
  throw new Error(message);
};
const open = async name => {
  apps[name] = await launch(userData, { args: ['--profile', name] });
  return apps[name];
};
const quitAll = async () => {
  for (const name of Object.keys(apps)) {
    await apps[name]?.quit().catch(() => undefined);
    delete apps[name];
  }
};
const q = value => JSON.stringify(value);
const exists = selector => `!!document.querySelector(${q(selector)})`;
const click = (app, selector, text) =>
  app.evaluate(`(() => { const el = [...document.querySelectorAll(${q(selector)})].find(e => ${text ? `e.textContent.includes(${q(text)})` : 'true'}); if (!el) return false; el.click(); return true; })()`);
const type = async (app, selector, text) => {
  await app.evaluate(`document.querySelector(${q(selector)}).focus(); true`);
  await app.send('Input.insertText', { text });
};

try {
  // ── 1. Two sign-ups in two profiles at once ──
  const [a, b] = await Promise.all([open('a'), open('b')]);
  for (const [name, app] of [['a', a], ['b', b]]) {
    if (!(await app.waitFor(exists('#signup-username'), 60_000))) fail(`profile ${name} did not show sign-up`);
  }
  log('both profiles show sign-up');
  const created = await Promise.all(
    [['a', a], ['b', b]].map(async ([name, app]) => {
      const result = await app.evaluate(`window.desktop.identity.create({ username: ${q(want[name])}, digits: null, profile: ${q(NETWORK)} })`);
      log(`signed up ${name}: ${result.username} confirmed=${result.confirmed}`);
      return [name, result.username];
    }),
  );
  const usernames = Object.fromEntries(created);
  await quitAll();
  const listed = JSON.parse(readFileSync(join(userData, 'profiles.json'), 'utf8'));
  const byName = Object.fromEntries(listed.profiles.map(entry => [entry.name, entry.username]));
  // The migration made "default" on the first start; a and b came from the flag.
  if (byName.a !== usernames.a || byName.b !== usernames.b) fail(`profiles.json lists ${q(byName)}`);
  console.log(`PROFILES_CREATED a=${usernames.a} b=${usernames.b} profiles=${listed.profiles.map(entry => entry.name).join(',')}`);

  // ── 2. Both at once again: each its own identity, running marks, the lock ──
  const [a2, b2] = await Promise.all([open('a'), open('b')]);
  for (const [name, app] of [['a', a2], ['b', b2]]) {
    if (!(await app.waitFor(exists('[data-testid=username]'), 90_000))) fail(`profile ${name} did not open its chats`);
    const identity = await app.evaluate('window.desktop.identity.get()');
    const shown = await app.evaluate(`document.querySelector('[data-testid=username]').textContent`);
    if (identity?.username !== usernames[name] || !shown.includes(usernames[name])) fail(`profile ${name} answers ${identity?.username} (shows ${shown})`);
  }
  console.log(`IDENTITY_OK a=${usernames.a} b=${usernames.b}`);
  const state = await a2.evaluate('window.desktop.profiles.state()');
  const row = name => state.profiles.find(entry => entry.name === name);
  if (state.current !== 'a' || !row('a')?.current || !row('b')?.running || row('default')?.running) fail(`profile list from a: ${q(state.profiles)}`);
  console.log(`RUNNING_OK a sees ${state.profiles.map(entry => `${entry.name}:${entry.running ? 'running' : 'closed'}`).join(' ')}`);

  const third = spawn(join(repo, 'node_modules/.bin/electron'), ['.', '--profile', 'a'], {
    cwd: repo,
    env: { ...process.env, PCD_HEADLESS: '1', PCD_USER_DATA_DIR: userData },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let thirdOut = '';
  third.stdout.on('data', chunk => (thirdOut += chunk));
  const thirdCode = await Promise.race([new Promise(done => third.once('exit', done)), sleep(30_000).then(() => 'timeout')]);
  if (thirdCode === 'timeout') {
    third.kill('SIGTERM');
    fail('a second process of profile a kept running');
  }
  if (!thirdOut.includes('PROFILE_ALREADY_OPEN a')) fail(`a second process of profile a said ${q(thirdOut.trim())}`);
  if (!(await a2.evaluate('window.desktop.identity.get().then(id => !!id)'))) fail('profile a lost its identity after the second start');
  console.log(`LOCK_OK second start of a exited code=${thirdCode} (PROFILE_ALREADY_OPEN)`);

  // ── 3. b messages a over the network ──
  const nonce = letters(6);
  const first = `Hello from profile b (${nonce})`;
  const second = `Second message from b (${nonce})`;
  const base = usernames.a.split('.')[0];
  await click(b2, '[aria-label="New chat"]');
  const hit = `[...document.querySelectorAll('[data-testid=search-global-row]')].find(r => r.textContent.includes(${q(usernames.a)}))`;
  // The search asks the identity backend once per pause in typing, and a name
  // claimed a minute ago may not be listed yet: type the name again until it is.
  let found = false;
  for (let attempt = 1; attempt <= 12 && !found; attempt++) {
    await b2.evaluate(`document.querySelector('[aria-label=Search]').focus(); true`);
    await b2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
    await b2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
    await b2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await b2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await type(b2, '[aria-label=Search]', base);
    found = await b2.waitFor(`!!${hit}`, 20_000);
    if (!found) log(`search attempt ${attempt}:`, q(await b2.evaluate(`document.querySelector('[data-testid=search-results]')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no results panel'`)));
  }
  if (!found) fail(`b did not find ${usernames.a} by search`);
  await b2.evaluate(`${hit}.click(); true`);
  if (!(await b2.waitFor(exists('textarea[aria-label=Message]'), 15_000))) fail('b has no message field for the request');
  await type(b2, 'textarea[aria-label=Message]', first);
  if (!(await click(b2, 'button', 'Send Request'))) fail('b has no Send Request button');
  log('b sent a request to', usernames.a);

  if (!(await a2.waitFor(exists('[data-testid=new-requests]'), 180_000))) fail('a shows no new request');
  await click(a2, '[data-testid=new-requests]');
  const request = `[...document.querySelectorAll('[data-testid=incoming-request]')].find(r => r.textContent.includes(${q(usernames.b)}))`;
  if (!(await a2.waitFor(`!!${request}`, 60_000))) fail(`a has no request from ${usernames.b}`);
  await a2.evaluate(`${request}.click(); true`);
  if (!(await a2.waitFor(`document.querySelector('[data-testid=messages]')?.textContent.includes(${q(first)})`, 30_000))) fail('the request does not show b’s message');
  console.log(`REQUEST_OK a received "${first}" from ${usernames.b}`);
  if (!(await click(a2, '[data-testid=request-banner] button', 'Accept'))) fail('a has no Accept button');

  if (!(await b2.waitFor(exists('[aria-label=Send]'), 180_000))) fail('b never saw the accept');
  await type(b2, 'textarea[aria-label=Message]', second);
  await click(b2, '[aria-label=Send]');
  log('b sent', q(second));
  if (!(await a2.waitFor(`[...document.querySelectorAll('[data-testid=messages]')].some(m => m.textContent.includes(${q(second)}))`, 180_000))) fail('a did not receive b’s message');
  console.log(`MESSAGES_OK a=${usernames.a} received 2 messages from b=${usernames.b}`);

  // ── 4. M19: show the recovery phrase, then restore it into a new profile ──
  const aIdentity = await a2.evaluate('window.desktop.identity.get()');
  await click(a2, '[aria-label=Settings]');
  if (!(await a2.waitFor(exists('[data-testid=recovery-show]'), 15_000))) fail('Settings has no "Show recovery phrase"');
  await click(a2, '[data-testid=recovery-show]');
  if (!(await a2.waitFor(exists('#recovery-confirm-word'), 5_000))) fail('no field for the word reveal');
  if (!(await a2.evaluate(`document.querySelector('[data-testid=recovery-reveal]').disabled`))) fail('Reveal is enabled before the word is typed');
  await type(a2, '#recovery-confirm-word', 'reveal');
  await a2.waitFor(`!document.querySelector('[data-testid=recovery-reveal]').disabled`, 5_000);
  await click(a2, '[data-testid=recovery-reveal]');
  if (!(await a2.waitFor(`document.querySelectorAll('[data-testid=recovery-words] li').length === 12`, 10_000))) fail('the panel does not show 12 words');
  if (!(await a2.evaluate(`window.desktop.identity.recoveryPhrase('show').then(() => false, () => true)`))) fail('main gave the phrase without the word reveal');
  const phrase = await a2.evaluate(`window.desktop.identity.recoveryPhrase('reveal')`);
  const shownMatches = await a2.evaluate(`[...document.querySelectorAll('[data-testid=recovery-words] li span:last-child')].map(e => e.textContent).join(' ') === ${q(phrase)}`);
  if (!shownMatches || typeof phrase !== 'string' || phrase.split(' ').length !== 12) fail('the words on screen are not the stored phrase');
  console.log('REVEAL_OK 12 words shown after typing reveal; another word was refused');

  await apps.a.quit();
  delete apps.a;
  await b2.evaluate(`window.desktop.profiles.remove('a').then(() => true)`);
  const picker = (apps.picker = await launch(userData, { args: ['--picker'] }));
  if (!(await picker.waitFor(exists('[data-testid=profile-restore-open]'), 30_000))) fail('the picker has no "Add profile from a recovery phrase"');
  const restored = await picker.evaluate(`window.desktop.profiles.restore(${q(phrase)}, ${q(NETWORK)})`);
  const again = await picker.evaluate(`window.desktop.profiles.restore(${q(phrase)}, ${q(NETWORK)}).then(() => 'accepted', e => e.message.includes('already in the profile') ? 'refused' : e.message)`);
  if (again !== 'refused') fail(`a second restore of the same phrase: ${again}`);
  await apps.picker.quit();
  delete apps.picker;
  const back = await open(restored);
  if (!(await back.waitFor(exists('[data-testid=username]'), 90_000))) fail(`the restored profile ${restored} did not open its chats`);
  const backIdentity = await back.evaluate('window.desktop.identity.get()');
  if (backIdentity?.accountHex !== aIdentity?.accountHex) fail(`the restored profile is account ${backIdentity?.accountHex}, not a's ${aIdentity?.accountHex}`);
  if (backIdentity?.username !== usernames.a) fail(`the restored profile is named ${backIdentity?.username}, not ${usernames.a}`);
  console.log(`RESTORE_OK profile ${restored} = ${backIdentity.username} ${backIdentity.accountHex} (same account as the removed profile a); a second restore was refused`);
  console.log(`PROFILES_OK in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  code = 0;
} catch (error) {
  console.log(`PROFILES_FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await quitAll();
  rmSync(userData, { recursive: true, force: true });
}
process.exit(code);
