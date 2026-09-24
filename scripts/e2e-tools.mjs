#!/usr/bin/env node
// M13 e2e: structured directives by tool calling, in the real app.
//   npm run e2e:tools [-- --identity pcde2e]
// 1. A fake OpenAI-style server (scripts/lib/fake-openai.mjs) answers every
//    turn with the text "Pick a colour." and a `send_buttons` tool call whose
//    arguments stream in small pieces, slowly.
// 2. The app is built and started headless (PCD_HEADLESS=1) on a throwaway
//    profile (PCD_USER_DATA_DIR) seeded with a test identity, its Assistant on
//    the proxy engine pointed at the fake server, with a dummy key.
// 3. In the Assistant room it asks for buttons. While the reply streams, the
//    room is read every 100 ms: no button JSON may ever show. At the end the
//    room must show a keyboard with the two buttons (TOOLS_KEYBOARD), and the
//    request must have offered the tool (TOOLS_OFFERED).
// Exit 0 TOOLS_OK; 1 TOOLS_FAIL <why>. Prints no secret.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build, launch, root, seedIdentity, writeAssistantSettings } from './lib/app.mjs';
import { startFakeOpenAi } from './lib/fake-openai.mjs';

const args = process.argv.slice(2);
const identityName = args.includes('--identity') ? args[args.indexOf('--identity') + 1] : 'pcde2e';
const identityFile = join(root, '.agent-runs', `identity-${identityName}`, 'identity.json');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const t0 = Date.now();
const log = (...parts) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...parts);

if (!existsSync(identityFile)) {
  console.log(`TOOLS_FAIL no test identity at ${identityFile}`);
  process.exit(1);
}

const BUTTONS = { rows: [[{ label: 'Red', action: { command: 'red' } }, { label: 'Blue', action: { command: 'blue' } }]], oneShot: true };
const fake = await startFakeOpenAi(() => ({ text: 'Pick a colour.', toolCall: { name: 'send_buttons', arguments: JSON.stringify(BUTTONS) } }));
log('fake server', fake.baseUrl);

build();
log('built');
const profile = mkdtempSync(join(tmpdir(), 'pcd-e2e-tools-'));
let app = null;
let code = 1;
try {
  log('seeded', seedIdentity(profile, identityFile));
  writeAssistantSettings(profile, { engine: 'proxy', baseUrl: fake.baseUrl });
  // A dummy key: the fake server must never see the real one.
  app = await launch(profile, { env: { LLM_PROXY_KEY: 'fake-key-for-e2e' } });
  if (!(await app.waitFor(`!!document.querySelector('[data-testid=chat-row-assistant]')`, 90_000))) throw new Error('the chat screen did not open');
  await app.evaluate(`document.querySelector('[data-testid=chat-row-assistant]').click(); true`);
  if (!(await app.waitFor(`!!document.querySelector('textarea[aria-label=Message]')`, 10_000))) throw new Error('the Assistant room did not open');
  await app.evaluate(`document.querySelector('textarea[aria-label=Message]').focus(); true`);
  await app.send('Input.insertText', { text: 'Which colour? Give me buttons.' });
  await app.evaluate(`document.querySelector('[aria-label=Send]').click(); true`);
  log('asked');

  // The room's text while the reply streams and after: button JSON must never be in it.
  const roomText = `(document.querySelector('[data-testid=message-list]') ?? document.querySelector('main') ?? document.body).innerText`;
  const jsonSeen = [];
  let keyboard = false;
  const until = Date.now() + 60_000;
  while (Date.now() < until && !keyboard) {
    const text = await app.evaluate(roomText);
    if (/"rows"|"label"|"action"|send_buttons|```/.test(text)) jsonSeen.push(text.slice(-200));
    keyboard = await app.evaluate(
      `[...document.querySelectorAll('[data-testid=keyboard]')].some(k => ['Red', 'Blue'].every(label => [...k.querySelectorAll('[data-testid=keyboard-button]')].some(b => b.textContent.includes(label))))`,
    );
    await sleep(100);
  }
  // A little longer after the keyboard: the finished row must stay clean too.
  for (let i = 0; i < 10; i++) {
    const text = await app.evaluate(roomText);
    if (/"rows"|"label"|"action"|send_buttons|```/.test(text)) jsonSeen.push(text.slice(-200));
    await sleep(100);
  }
  const offered = fake.requests.length > 0 && (fake.requests[0].tools ?? []).some(tool => tool.function?.name === 'send_buttons');
  const promptOk = fake.requests.length > 0 && !String(fake.requests[0].messages?.[0]?.content ?? '').includes('```buttons');
  log(`TOOLS_OFFERED ${offered ? 'yes' : 'no'} (requests=${fake.requests.length}, tools=${(fake.requests[0]?.tools ?? []).map(tool => tool.function?.name).join(',')})`);
  log(`TOOLS_PROMPT_WITHOUT_FENCE ${promptOk ? 'yes' : 'no'}`);
  log(`TOOLS_KEYBOARD ${keyboard ? 'Red, Blue' : 'none'}`);
  log(`TOOLS_JSON_SEEN ${jsonSeen.length}`);
  if (jsonSeen.length > 0) console.log(`  first: ${JSON.stringify(jsonSeen[0])}`);
  if (!offered) throw new Error('the request did not offer send_buttons');
  if (!promptOk) throw new Error('the system prompt still asks for a fenced block');
  if (!keyboard) throw new Error('no keyboard in the room');
  if (jsonSeen.length > 0) throw new Error('button JSON was shown in the room');
  console.log('TOOLS_OK');
  code = 0;
} catch (error) {
  console.log(`TOOLS_FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await app?.quit();
  await fake.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
