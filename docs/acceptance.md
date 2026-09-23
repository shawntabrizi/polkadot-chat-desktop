# Acceptance log

One section per milestone. Real command output only.

## M0

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1, npm 11.12.1.

### `npm run check` (last 20 lines)

```

> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  22 passed (22)
      Tests  132 passed (132)
   Start at  10:08:40
   Duration  933ms (transform 774ms, setup 460ms, import 5.75s, tests 1.50s, environment 1ms)

check exit=0
```

### `npm run smoke` (last 20 lines)

```
rendering chunks...
out/main/index.js  1.22 kB

✓ built in 12ms
vite v8.3.0 building ssr environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
out/preload/index.js  0.18 kB

✓ built in 5ms
vite v8.3.0 building client environment for production...
transforming...
✓ 1010 modules transformed.
rendering chunks...
out/renderer/index.html                    0.32 kB
out/renderer/assets/index-DwrG3l9y.js  1,705.32 kB

✓ built in 84ms
SMOKE_OK
smoke exit=0
```

### `git status --short`

Run after the commit; see the commit report. The file cannot contain its own post-commit state.

### Not run

- `docs/milestones/M0.check.sh` as a whole: it calls `timeout`, which this machine does not have. See docs/questions.md.

### Extra manual check

A one-off Electron script (not committed) loaded `out/renderer/index.html` with the built preload and read the page after 4 s. Output line:

```
PROBE {"root":20802,"text":"Polkadot Chat Web\nPair with your phone\nNetwork \nDevnet\nPaseo\n\nSubmitted. Scan the code with the Polkadot app and approve this device.\n\nPairing link","desktop":{"version":"44.4.1"}}
```

So the React app mounts (not only `did-finish-load`) and `window.desktop.version` is `44.4.1`.

## M1

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1, npm 11.12.1.

Reviewer check run (2026-09-23): `docs/milestones/M1.check.sh` registered `pcdrevchibacbfcc.48`, `ON_CHAIN key_type=0`.

### `npm run check` (last 12 lines)

```
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  24 passed (24)
      Tests  147 passed (147)
   Start at  10:31:46
   Duration  1.03s (transform 898ms, setup 458ms, import 7.33s, tests 2.05s, environment 1ms)

check exit=0
```

### `npm run smoke` (last 8 lines)

```
✓ 979 modules transformed.
rendering chunks...
out/renderer/index.html                    0.32 kB
out/renderer/assets/index-B7ZGM2qn.js  1,630.38 kB

✓ built in 80ms
SMOKE_OK
smoke exit=0
```

### `npm run identity:register -- pcdtest6698` (final code, 14:29 UTC)

```

> polkadot-chat-desktop@0.1.0 identity:register
> node scripts/identity-register.mjs pcdtest6698

note: usernames are letters only; using pcdtestggji for pcdtest6698
Creating keys
Claiming username
Waiting for the network.......................
profile devnet
username pcdtestggji.38
accountHex 0x423f651ffe33d58dac5816f5e8198ed693cf24e544b21e52bfc60db766ca640e
identifierKeyHex 0x007169a1cab85f05384185f5054aba372b13405dcb02f68ffab90a0b1313691b3b0000000000000000000000000000000000000000000000000000000000000000
confirmed true
identity file /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcdtestggji/identity.json
ON_CHAIN key_type=0
on-chain identifierKey matches: true
npm run identity:register -- $N  1.17s user 0.22s system 0% cpu 2:27.69 total
```

The same command ran once before on this code base (14:18 UTC, before the availability change in `register.ts`; the registration path was the same). It also passed:

```

> polkadot-chat-desktop@0.1.0 identity:register
> node scripts/identity-register.mjs pcdtest9080

note: usernames are letters only; using pcdtestjaia for pcdtest9080
Creating keys
Claiming username
Waiting for the network......
profile devnet
username pcdtestjaia.98
accountHex 0x5efb3590d35d794578c07313720e0ccdb0abff70b9e67927ccda7a00fcc6ed73
identifierKeyHex 0x000c858b0eef02fe28063cc3ff14531e25c8b9e031e3ef69b3fcaee20e1f4397480000000000000000000000000000000000000000000000000000000000000000
confirmed true
identity file /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcdtestjaia/identity.json
ON_CHAIN key_type=0
on-chain identifierKey matches: true
npm run identity:register -- $N  0.99s user 0.15s system 1% cpu 57.864 total
```

The identifier keys above are public (they are on chain). The printed identity files hold the test mnemonics; they stay in the git-ignored `.agent-runs/`.

### `git status --short`

Run after the commit; see the commit report. The file cannot contain its own post-commit state.

### Not run

- `docs/milestones/M1.check.sh` as a whole: it needs the commit first and registers one more identity. Its parts were run above.

### Extra manual check (Electron)

A one-off Electron script (not committed) loaded `src/main/ipc.ts` through tsx, set a temporary `userData` folder, opened `out/renderer/index.html` with the built preload, and drove the page. It saved a random, unregistered identity through `store.ts` (safeStorage), reloaded, and read Dexie. The first line runs the lite-person wasm through `node:wasi` inside Electron main. Output:

```
PROBE wasi in electron ok string
PROBE first launch text: "Polkadot Chat Web\nWelcome to Polkadot\n\nChoose a username to get started.\n\nPick a username\n\n\nMinimum 6 characters\n\n Let the network pick\nDigits \nusername.NN\n\nNetwork \nDevnet\nPaseo\n\nGet username"
PROBE typed HiShawn9 -> hishawn "It's yours!" disabled: false
PROBE prefilled digits: 01
PROBE digits 84: "Digits taken. Try again." disabled: true
PROBE digits 85: null disabled: false
PROBE short name disabled: true
PROBE file keys: version,username,accountHex,profile,mnemonicEncrypted plaintext absent: true
PROBE roundtrip ok: true
PROBE second launch text: "Polkadot Chat Web\n\nprobeuser.01\n\nChats\nRequests\nSearch\nSettings\nConnecting…\nChats\n\nNo chats yet. Find someone and send a request."
PROBE dexie identity matches saved account: true
```

## M2

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1. Test peer: the echo bot `pcdpeer.47` on devnet (log `/tmp/pcdpeer.log`).

### `npm run check` (last 12 lines, final code)

```
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  25 passed (25)
      Tests  155 passed (155)
   Start at  11:05:57
   Duration  1.03s (transform 1.11s, setup 513ms, import 7.24s, tests 2.35s, environment 1ms)

check exit=0
```

### `npm run e2e:chat -- pcdpeer.47`

Every run of the command is listed, in order. Runs 1–3 are the investigation; the fixes they led to are in docs/decisions.md (M2).

**Run 1 (14:45 UTC): `CHAIN_READ_FAIL best block timed out`.** It registered a new default identity (`pcdeceyxxk.36`). The WS then dropped as stale about 1 ms after every connect (`TimeoutOverflowWarning: Infinity ... set to 1`, `[ws] connected` / `[ws] disconnected` in a loop). Cause: `heartbeatTimeout: Infinity` in `statementStore.ts`. Fixed.

**Run 2 (14:48 UTC): `E2E_OK`, but a false pass.** `REPLY Echo: ` was the bot's answer to the empty request opener, not to the ping. The bot log showed `BOT_SESSION_DECODE_FAILED ... unable to authenticate data` for the ping. Cause: the device encryption key was the identity chat key. Fixed (own device key). The script now waits for the bot's greeting before the ping and prints `REPLY_HAS_NONCE`.

**Run 3 (14:53 UTC): `E2E_TIMEOUT reply`.** The bot now received the ping (`BOT_RECEIVED_TEXT`, `BOT_SENT_TEXT chars 17`), but this app dropped the echo (`dropping an undecodable incoming statement`). Cause: run 1–2's identity was known to the bot with the old device key; bot-core keeps both entries for the one statement account and the SDK unwraps only the first. The identity was moved aside (`.agent-runs/identity-pcde2e-m1layout`, git-ignored), see docs/questions.md.

**Run 4 (14:56 UTC), fresh default identity: `E2E_OK`.**

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity register pcdecejakd on devnet
  Creating keys
  Claiming username
  Waiting for the network
  Waiting for the network
  Waiting for the network
  Waiting for the network
  Waiting for the network
identity registered pcdecejakd.11 confirmed=true
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044445
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping b73b8c
REPLY Echo: ping b73b8c
REPLY_HAS_NONCE yes
E2E_OK
```

Bot log for run 4:

```
{"time":"2026-09-23T14:56:52.610Z","event":"BOT_RECEIVED_OPENER","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","requestId":"974d4f9d-c3f5-43bf-9d94-4a5311b5c309","chars":0}
{"time":"2026-09-23T14:56:53.211Z","event":"BOT_SENT_TEXT","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":6}
{"time":"2026-09-23T14:56:54.313Z","event":"BOT_RECEIVED_TEXT","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":11}
{"time":"2026-09-23T14:56:54.623Z","event":"BOT_SENT_TEXT","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":17}
```

**Run 5 (14:57 UTC), same identity reused: `E2E_OK`.**

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044457
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping d802be
REPLY Echo: ping d802be
REPLY_HAS_NONCE yes
E2E_OK
```

After run 5 one more domain change landed (`lookup.ts`, found in the GUI check below; the e2e read path does not use it). Then:

**Runs 6–8 (15:06, 15:08, 15:11 UTC), final code: `CHAIN_READ_FAIL identifier lookup timed out after 120000ms`.** The WS stayed connected, the best block arrived, and the first storage read (which waits for the runtime metadata) did not answer within 120 s. No `BOT_` event was logged (no request was sent). Run 8:

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044758
CHAIN_READ_FAIL identifier lookup timed out after 120000ms
e2e exit=1
```

Investigation: the same read through the app's connection in a scratch script answered in 12–19 s at 15:14–15:16 UTC, from each of the three devnet endpoints (12 s, 26 s, 40 s). A copy of `scripts/e2e-chat.mjs` with one extra log line, run at 15:16 UTC with the final code, passed (`REQUEST_SENT` / `ACCEPTED devices=1` / `GREETING Echo: ` / `PING_SENT ping e293ae` / `REPLY Echo: ping e293ae` / `REPLY_HAS_NONCE yes` / `E2E_OK`; bot log `BOT_RECEIVED_TEXT` 15:16:24.113Z, `BOT_SENT_TEXT chars 17` 15:16:24.459Z). I found no cause in this repo for runs 6–8; slow public nodes at that time are the likely cause. The command was not run again after run 8 (the run limit for this milestone).

### GUI (step 4)

cmux computer use was not available (onboarding not finished), so the built app was driven through the Chrome DevTools protocol: `npx electron out/main/index.js --remote-debugging-port=9333`, DOM clicks and input events. That run uses the `Electron` userData folder, not the `npm run dev` one, so it signed up its own identity; the owner's dev identity (`shawntest.76`) was not used.

1. Sign-up screen: `pcdguiqrst` → "It's yours!" → Get username → "Signed up as pcdguiqrst.08.", tabs shown, "Connected".
2. Search `pcdpeer` → `pcdpeer.47 5DbzeXqY… Send request` (the backend answered 402; the search solved the proof of compute).
3. Send request → first attempt: "pcdpeer.47 has no chat key on the People chain yet." Cause: `lookup.ts` passed an SS58 address where host-papp wants hex. Fixed, rebuilt, restarted: the identity was restored with no sign-up.
4. Send request again → row turns "(contact)" within 8 s. Chats: `pcdpeer.47 … 1 device · 1 unread`, preview `Echo: `.
5. Room: "Chat accepted", "Echo: ". Sent "hello from the desktop gui" → `✓✓`, then "Echo: hello from the desktop gui" (bot log `BOT_RECEIVED_TEXT chars 26`, `BOT_SENT_TEXT chars 32` at 15:05:32Z).

Not checked in the GUI: an incoming request from a person (needs a second client), reactions, edits.

### `git status --short`

Empty after the commit (checked before the report).

## M3

Run 2026-09-23 (about 15:30–15:50 UTC) on the final code of this commit.

### `npm run check` (last 10 lines)

```


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  27 passed (27)
      Tests  169 passed (169)
   Start at  11:45:34
   Duration  1.10s (transform 1.12s, setup 502ms, import 8.10s, tests 2.89s, environment 1ms)

```

eslint printed nothing (no findings).

### `npm run package` (last lines; the long "duplicate dependency references" line is cut)

```
  • installing native dependencies  arch=arm64
  • completed installing native dependencies
  • packaging       platform=darwin arch=arm64 electron=44.4.1 appOutDir=dist/mac-arm64
  • downloaded      label=electron progress=100%
  • downloaded electron zip extracted successfully  output=/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/dist/mac-arm64
  • searching for node modules  pm=npm searchDir=/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop
  • default Electron icon is used  reason=application icon is not set
  • skipped macOS code signing  reason=identity explicitly is set to null
  • building        target=DMG arch=arm64 file=dist/Polkadot Chat-0.1.0-arm64.dmg
  • building block map  blockMapFile=dist/Polkadot Chat-0.1.0-arm64.dmg.blockmap
```

```
$ ls -la dist/*.dmg
-rw-r--r--@ 1 shawntabrizi  staff  165540327 Sep 23 11:45 dist/Polkadot Chat-0.1.0-arm64.dmg
```

The dmg is 165,540,327 bytes (158 MiB). The app is 391 MB unpacked; 288 MB of it is the Electron framework, 100 MB is `app.asar` (the production `node_modules`, see decisions).

### `npm run smoke:packaged`

```

> polkadot-chat-desktop@0.1.0 smoke:packaged
> bash scripts/smoke-packaged.sh

profile /var/folders/_1/q03733qd0pv42n1dvkcvyx0c0000gn/T/pcd-smoke.E85QVzQEVx
SMOKE_OK
```

The packaged app finds the wasm where `resourcePath()` looks (`ELECTRON_RUN_AS_NODE=1` with the packaged binary, the same formula):

```
packaged true .../dist/mac-arm64/Polkadot Chat.app/Contents/Resources/resources/summit-bandersnatch-cli.wasm true
```

### `npm run e2e:chat -- pcdpeer.47` (after the chain-client changes)

```

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7045332 (runtime ready in 1.9s)
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping 375a0a
REPLY Echo: ping 375a0a
REPLY_HAS_NONCE yes
E2E_OK
```

The first e2e run after the change (empty metadata cache) printed `runtime ready in 12.1s` and passed; every later run printed `runtime ready in 1.9s`. In M2 the same first read timed out after 120 s three times.

### Restart, re-seed and reset (built app, throwaway profile)

`npm run build`, then a scratch script (not committed) started `electron .` four times with `PCD_USER_DATA_DIR=<new temp folder>` and `--remote-debugging-port`, and drove the renderer through the Chrome DevTools protocol. The owner's profile (`~/Library/Application Support/polkadot-chat-desktop`) was not opened. Sign-up used the app's own IPC (`window.desktop.identity.create`) with a throwaway name on devnet. Output of the second run (the first run was the same, except that the reset took 30 s because the script itself held IndexedDB connections open; fixed in the script):

```
0.5s start 1 sign-up screen: true
53.2s create -> username=pcdrestartapjv.06 confirmed=true finalized=true (52.7s from click to answer)
53.2s progress: ["0.0s Creating keys","0.0s Claiming username","2.2s Waiting for the network","15.7s Waiting for the network",...] 15
53.2s identity.json exists: true mnemonic stored encrypted (no plaintext field): true
53.8s window.json after quit: {"x":264,"y":159,"width":1200,"height":800}
54.6s start 2 shows username: true chat tabs: true
54.6s Dexie secrets rows: 3
55.8s start 3 after Dexie wipe shows username: true chat tabs: true
55.8s Dexie secrets rows after re-seed: 3
56.1s after reset sign-up screen: true
56.1s identity.json exists after reset: false
56.1s IndexedDB databases after reset: []
57.3s start 4 sign-up screen: true
```

Start 3 cleared the `secrets` and `userIdentity` stores behind the app's back before the restart; the app re-seeded them from `identity.json` and opened into chats. The reset clicked Settings → "Reset identity" with `window.confirm` answered yes.

The renderer reaches the metadata cache through IPC: `window.desktop.chain.getMetadata('0xd0f3…36df')` returned `Uint8Array 524446`; `getMetadata('../../etc/passwd')` returned `null`.

### Timing: best-block reads and the metadata cache

Scratch script (not committed) with the main-process code, devnet, 2026-09-23.

| What | Before (M2 code) | After (M3 code) |
|---|---|---|
| Open the People directory + first read, fresh process | 9.7 s, 16.4 s (no cache; waits for the finalized block) | 13.6 s with an empty cache; 2.1–2.9 s (4 runs) with the cache filled |
| Sign-up: claim sent → key seen by the app | 93.3 s (1 run; finalized head, poll 5 s) | 20.8 s, 21.5 s (empty cache), 47.7 s, 9.1 s (script); 52.7 s, 88.4 s (in the app, empty cache) |
| Best-block confirmation → finalized head holds the key | — | 3.5 s, 24.5 s (2 runs) |

The time the backend takes to put the claim in a block varies from about 9 s to more than 80 s between runs, so one sign-up against another is not a fair comparison. The parts M3 removes are measured directly: the finality lag (3.5 s and 24.5 s in two runs) and the metadata download on the first read after a start (about 11 s: 13.6 s cold against 2.1–2.9 s warm).

### `git status --short`

Empty after the commit (checked before the report).

### Not run

- Sign-up and restart **in the packaged app**. The packaged app has the name `polkadot-chat-desktop` (package.json `name`), so its `safeStorage` uses the keychain entry "polkadot-chat-desktop Safe Storage", which the dev Electron binary created. An unsigned binary that reads that entry makes macOS show a permission prompt, which an unattended run cannot answer and which would appear on the owner's screen. The restart test above ran the same code with the dev Electron binary. The packaged app was checked with `--smoke` in a throwaway profile, and the wasm path was checked in the packaged app. See docs/questions.md.
- The reset confirm dialog was answered by replacing `window.confirm`; the native dialog itself was not clicked.
- `docs/milestones/M3.check.sh` was not run by me (reviewer script). Its steps (check, package, dmg, smoke:packaged, M3 section) were each run above.

## M4

Run 2026-09-23 on this machine (macOS, Apple Silicon). The proxy key came from `LLM_PROXY_KEY` in the shell; it is not printed anywhere below.

### `npm run check`

```
 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  30 passed (30)
      Tests  188 passed (188)
   Start at  12:04:25
   Duration  1.19s (transform 1.21s, setup 549ms, import 8.54s, tests 3.41s, environment 1ms)

```

Exit code 0 (eslint prints nothing when clean). New specs: `src/main/assistant/client.spec.ts` (6), `src/renderer/domain/assistant/assistant.spec.ts` (9), `src/renderer/domain/markdown/markdown.spec.ts` (4).

### `npm run e2e:assistant`

```

> polkadot-chat-desktop@0.1.0 e2e:assistant
> node scripts/e2e-assistant.mjs

proxy https://llm.substrate.dev model auto/deepseek-v4.1-flash
prompt: Reply with exactly: proxy ok
reply: proxy ok
deltas 2, 8 chars
ASSISTANT_OK
```

The model (`auto/deepseek-v4.1-flash`) first streams a reasoning block (`delta.reasoning_content`, `delta.content: ""`), which the client skips. For this short reply the proxy sent the text in 2 content deltas.

Failure paths of the same script:

```
$ LLM_PROXY_KEY=wrong-test-value node scripts/e2e-assistant.mjs | tail -1   # exit 5
ASSISTANT_FAIL The proxy refused the API key (HTTP 401).
$ env -u LLM_PROXY_KEY node scripts/e2e-assistant.mjs                      # exit 2
LLM_PROXY_KEY is not set
```

The proxy's own 401 body quotes the first and last 4 characters of the key it got (`Received=wron****alue`), so the client does not show a 401/403 body.

### The Assistant in the app (step 7)

`npm run build`, then a scratch script (`.agent-runs/m4/gui.mjs`, git-ignored) started `electron .` three times with `PCD_USER_DATA_DIR=<new temp folder>` and `--remote-debugging-port`, and drove the renderer through the Chrome DevTools protocol (DOM clicks, `Input.insertText` for typing). The owner's profile was not opened. The Chats tab needs an identity, so the first start signed up a throwaway name on devnet through `window.desktop.identity.create`. The script compared (never printed) the key against Dexie, `assistant.json` and the app's stdout/stderr. The temp profile was deleted at the end. Output:

```
0.0s profile /var/folders/_1/q03733qd0pv42n1dvkcvyx0c0000gn/T/pcd-m4-gv28UA
0.5s sign-up screen: true
27.9s signed up pcdassistabzk.13 confirmed true
28.1s chats shown: true
28.1s first row of Chats: chat-row-assistant | Assistant AI, in this app
28.1s settings seen by renderer: {"model":"auto/deepseek-v4.1-flash","baseUrl":"https://llm.substrate.dev","hasKey":false,"envKey":true}
28.1s room title: Assistant
36.9s Stop button shown while streaming: true | distinct text lengths seen while streaming: 2 34,94
36.9s samples (first 6, last 3): ["28.1s idle len=0","28.3s streaming len=34","28.4s streaming len=34","28.6s streaming len=34","28.7s streaming len=34","28.9s streaming len=34","...","36.6s streaming len=94","36.7s streaming len=94","36.9s idle len=199"]
36.9s markdown html: "<ol>\n<li>Polkadot connects <strong>independent</strong> blockchains through its relay chain.</li>\n<li>It provides <strong>shared</strong> security for all connected parachains.</li>\n<li>The native token <strong>DOT</strong> powers staking and governance.</li>\n</ol>\n"
36.9s rendered text: "Polkadot connects independent blockchains through its relay chain.\nIt provides shared security for all connected parachains.\nThe native token DOT powers staking and governance.\n9/23/2026, 12:02:26 PM"
36.9s has <li>/<strong>: true/true
43.4s follow-up reply: "3\n\n9/23/2026, 12:02:35 PM"
74.1s after Stop, last two rows: [{"d":"incoming","s":"failed","t":"The history of distributed ledgers is not a single story but…"},{"d":"system","s":"received","t":"Assistant: Stopped."}]
74.6s Chats preview after all: Assistant AI, in this app | Assistant: Stopped. 9/23/2026, 12:03:12 PM
74.6s settings form: model= auto/deepseek-v4.1-flash baseUrl= https://llm.substrate.dev | key state: no key stored; the app uses LLM_PROXY_KEY from its environment
80.7s Test -> Reply: proxy ok
80.7s Dexie holds the key: false | Dexie assistant rows: 7
81.3s main output mentions key: false
82.0s no env key, key state: no key stored
82.0s Test without key -> Test failed: No API key for the LLM proxy. Set one in Settings.
82.0s after Save, key state: key stored | password field empty: true
82.0s assistant.json fields: version,model,baseUrl,keyEncrypted | holds plaintext key: false
82.1s getSettings has no key field: {"model":"auto/deepseek-v4.1-flash","baseUrl":"https://llm.substrate.dev","hasKey":true,"envKey":false}
88.7s Test with stored key -> Reply: proxy ok
90.1s after restart: rows shown 10 | markdown blocks 3 | Dexie rows 7
90.1s Dexie holds the key: false
90.8s main output mentions key: false
90.8s profile removed: true
```

What this shows:

- The Assistant is the first row of Chats ("Assistant AI, in this app"), with no contact on chain.
- The reply row appears at once as "Thinking…" with `…` and a Stop button; the text grew while streaming (34 → 94 characters of row text in the samples, then 199 when done). Send is disabled until the reply ends.
- The reply renders as markdown: `<ol><li>…<strong>…</strong>…` in the room.
- The follow-up "How many items did your previous answer have?" got `3`: the earlier turns go as context.
- Stop kept the partial text (row `failed`) and added the notice "Assistant: Stopped.".
- Settings shows the default model and base URL, the key state, and Test answers "Reply: proxy ok" with the key from the environment and with a key stored through the form. Without any key, Test shows "No API key for the LLM proxy. Set one in Settings." `assistant.json` holds `version,model,baseUrl,keyEncrypted`, no plaintext key; `getSettings` returns `hasKey`/`envKey` only.
- After a restart the room shows the same 7 Dexie rows (10 `li` elements: 7 rows plus the 3 list items of the markdown reply) and 3 markdown blocks.
- Dexie and the app's output never contained the key.

After this run, the key-state text in Settings changed from "…uses LLM_PROXY_KEY from its environment" to "…uses the proxy key from its environment", because `M4.check.sh` refuses the name `LLM_PROXY_KEY` anywhere in `src/renderer`. `npm run check` above ran after that change; the GUI run was not repeated for one string.

`npm run dev` itself (Vite dev server) was started once with `PCD_USER_DATA_DIR=<temp folder>` and `--remoteDebuggingPort`: the page loaded from `http://localhost:5173/` at sign-up (new profile), `window.desktop.assistant` had `getSettings,setSettings,send,cancel,onDelta,onDone,onError`, and `getSettings()` returned `{"model":"auto/deepseek-v4.1-flash","baseUrl":"https://llm.substrate.dev","hasKey":false,"envKey":true}`. The chat itself was checked in the built app above, not in the dev server.

### `git status --short`

Empty after the commit (checked before the report).

### Not run

- The native macOS keychain prompt path: the stored key uses the dev Electron binary's existing keychain entry, so no prompt appeared. The packaged app was not started with a stored key.
- `docs/milestones/M4.check.sh` is the reviewer's script; its steps (clean tree, M4 commit, files, renderer grep, check, e2e, M4 section) were each run above or at commit time.

## M5

Run 2026-09-23 on this machine (macOS, Apple Silicon), Node v24.13.1. `LLM_PROXY_KEY` came from the shell environment and is not printed anywhere below.

### `npm run check` (now ends with `check:tokens`)

```

> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint . && npm run check:tokens


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  30 passed (30)
      Tests  189 passed (189)
   Start at  12:51:25
   Duration  1.10s (transform 1.15s, setup 535ms, import 7.65s, tests 3.28s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (89 files)
exit 0
```

tsc and eslint print nothing when clean. Negative test of the token lint: a probe `.tsx` with one violation of each rule gave 10 hits (`grep -c` of the probe path in the lint output); the probe was deleted and the lint is clean again.

### `npm run smoke` (last 12 lines)

```

✓ built in 6ms
vite v8.3.0 building client environment for production...
transforming...
✓ 2989 modules transformed.
rendering chunks...
out/renderer/index.html                     0.93 kB
out/renderer/assets/index-Cz6qKNlv.css     98.17 kB
out/renderer/assets/index-BDZ4Ia2p.js   2,436.29 kB

✓ built in 167ms
SMOKE_OK
```

### `npm run screenshots`

Final run, with the seeded test identity `pcdecejakd.11` and the room peer `pcdtestjaia` (the bot was down, see below):

```
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots
0.6s built
5.7s saved berlin-day/signup.png
11.0s saved berlin-night/signup.png
11.8s seeded pcdecejakd.11
27.7s accepted the request of pcdtestjaia.98
45.5s saved berlin-day/room.png
55.9s saved berlin-day/assistant.png
57.8s saved berlin-day/chats.png
58.6s saved berlin-day/requests.png
59.7s saved berlin-day/settings.png
63.2s saved berlin-night/room.png
64.1s saved berlin-night/assistant.png
65.9s saved berlin-night/chats.png
66.8s saved berlin-night/requests.png
67.6s saved berlin-night/settings.png
68.3s seeded profile removed: true

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
SCREENSHOTS_OK
exit 0
```

First run (bot `pcdpeer.47` as the room peer, `PCD_SCREENSHOT_ROOM_WITH` unset). The Berlin Day room worked end to end; then the bot crashed (`TypeError … outbound-lanes.mjs:179` in `/tmp/pcdpeer.log`, 16:43 UTC), so the Berlin Night room had no echo:

```
0.6s built
6.0s saved berlin-day/signup.png
11.7s saved berlin-night/signup.png
12.5s seeded pcdecejakd.11
16.6s request sent to pcdpeer.47
33.6s saved berlin-day/room.png
47.3s saved berlin-day/assistant.png
49.2s saved berlin-day/chats.png
50.0s saved berlin-day/requests.png
51.3s saved berlin-day/settings.png
144.0s missed berlin-night/room.png: pcdpeer.47 did not echo
144.8s saved berlin-night/assistant.png
146.7s saved berlin-night/chats.png
148.0s saved berlin-night/requests.png
149.1s saved berlin-night/settings.png
149.8s seeded profile removed: true

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png

Not captured:
  berlin-night/room.png (pcdpeer.47 did not echo)
SCREENSHOTS_PARTIAL
```

That Berlin Day bot room is kept as `.agent-runs/screens/berlin-day/room-bot-pcdpeer47.png`. Runs 2 and 3 of the fallback (between them I fixed what the PNGs showed) also ended `SCREENSHOTS_OK`.

### PNGs (1280×800, git-ignored)

- `.agent-runs/screens/berlin-day/signup.png`
- `.agent-runs/screens/berlin-day/chats.png`
- `.agent-runs/screens/berlin-day/room.png`
- `.agent-runs/screens/berlin-day/assistant.png`
- `.agent-runs/screens/berlin-day/requests.png`
- `.agent-runs/screens/berlin-day/settings.png`
- `.agent-runs/screens/berlin-night/signup.png`
- `.agent-runs/screens/berlin-night/chats.png`
- `.agent-runs/screens/berlin-night/room.png`
- `.agent-runs/screens/berlin-night/assistant.png`
- `.agent-runs/screens/berlin-night/requests.png`
- `.agent-runs/screens/berlin-night/settings.png`
- `.agent-runs/screens/berlin-day/room-bot-pcdpeer47.png` (first run, live bot)

### What the PNGs showed, and the fixes

I read every PNG in both themes after each run.

- Run 1, Berlin Day room: the tail corner was checked on a crop (4 px on the last bubble of a run). The time on own bubbles (`text-fg-tertiary-inverted`) was hard to read → the time uses `text-fg-secondary-inverted`; the ticks keep the step-5 colour.
- Run 1, chat list: the Assistant preview showed raw markdown ("- Polkadot connects…") → previews strip markdown marks.
- Run 1, requests: a request without a message left the room empty under "Today" → the line "<name> sent message request".
- Run 1, settings: the requests panel was still open on the left → the script goes back to the list first.
- Run 1, Berlin Night: a dark band under the room header (the navigation-overlay gradient is black on Night, darker than the container) → the fade is removed.
- Run 3: the requests list showed one sender three times and an accepted contact still as a request → one row per person, contacts hidden; the pill count follows.
- Run 4 (final): no overflow, no clipped text, the edges line up (pane content at 16 px, surfaces at 8 px), hover states are not captured (the pointer is parked). Known and accepted: the `opal` avatar tone is dark on Berlin Night (avatar colours are theme-invariant by design); the Danger section of Settings is below the fold.

### Reset identity with Undo (step 8)

Scratch script `.agent-runs/m5/reset.mjs` (git-ignored): a throwaway profile seeded with `pcdbenchfina.25`, the built app over CDP, Settings → Reset identity, Undo, then a second reset without Undo.

```
chat screen: true
sign-up after reset: true | toast: true | identity.json=false .bak=true
chat screen after Undo: true | identity.json=true .bak=false
11 s later, still in chats: true | identity.json=true .bak=false
second reset, no Undo: identity.json=false .bak=true
11 s later: identity.json=false .bak=false | sign-up shown: true
IndexedDB after commit: "contacts=0 device=0 messages=0 requests=0 rooms=0 secrets=0 settings=0 userIdentity=0"
```

### Review fixes (docs/review/M5.md, 2026-09-23)

Fix 1: the username and the number are one field, like the phone. The name is on the left; a "." in `text-fg-tertiary` and a two-digit editable input (`font-mono`, `text-fg-primary`, 28 px) sit on the right inside the same border. The suffix shows once the name is valid, checked and free, pre-filled with the first `availableDigits` entry. The "Number" Select and "Let the network pick" are gone; the claim sends the digits shown. Digits not in `availableDigits` turn the border `stroke-error`, the line reads "Digits taken. Try again." and Get username is disabled. The field draws one focus outline (`focus-within`); the two inputs carry a `data-slot` so the global per-element outline stands down.

`npm run check` (last lines, exit 0):

```
 Test Files  30 passed (30)
      Tests  189 passed (189)

> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (89 files)
```

`npm run screenshots` without `PCD_SCREENSHOT_IDENTITY` (the script has no sign-up-only switch; the seeded screens were not changed by this fix and are reported missing, so the exit is 1 by design):

```
0.5s built
5.2s saved berlin-day/signup.png
10.6s saved berlin-night/signup.png

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
...
SCREENSHOTS_PARTIAL
```

New PNGs: `.agent-runs/screens/berlin-day/signup.png`, `.agent-runs/screens/berlin-night/signup.png` (`polkadotfan` with ".01", "It's yours!"). The other ten PNGs listed above are from the M5 run.

What the PNGs showed: the first run set the "." in Inter; on Berlin Night it was a speck next to the Martian Mono digits → the dot is `font-mono` too, so ".01" reads as one unit. Second run: both themes correct.

Error state: a scratch copy of the sign-up part of the screenshot script (outside the repo) typed `00` into the number. Output, both themes: `Digits taken. Try again. | digits=00`; the PNG shows the red border, the red line and a disabled button, with one focus outline.

### Not run

- Themes Lisbon, Malta and Tokyo were not screenshotted (step 11 asks for Berlin Day and Night). They are selectable in Settings.
- `git status --short` is checked after the commit (it cannot be in the committed file).

## M6

Run on 2026-09-23 (macOS, Apple Silicon). `claude` 2.1.280, `codex` 0.154.0, `opencode` 1.14.21 installed; `LLM_PROXY_KEY` set in the environment (value not printed). The run happens inside a Claude Code session.

### `npm run check`

```
 Test Files  38 passed (38)
      Tests  235 passed (235)
   Start at  13:40:12
   Duration  3.69s (transform 1.33s, setup 700ms, import 8.09s, tests 7.02s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (100 files)
```

(`tsc` and `eslint` print nothing when clean; exit code 0.)

### `npm run smoke`

```
✓ built in 180ms
SMOKE_OK
```

### `npm run e2e:engines`

```
> polkadot-chat-desktop@0.1.0 e2e:engines
> node scripts/e2e-engines.mjs

workspace /private/var/folders/_1/q03733qd0pv42n1dvkcvyx0c0000gn/T/pcd-e2e-engines-3ewQa0 (empty, tools off)
prompt: Reply with exactly: engine ok
ENGINE proxy ok engine ok
  LLM proxy · 6.3s · 1 deltas · events thinking,done · session no
ENGINE claude ok engine ok
  2.1.280 (Claude Code) · 3.5s · 2 deltas · events thinking,done · session yes
ENGINE codex fail Codex: You hit your spend cap set by the owner of your works
  codex-cli 0.154.0 · error: Codex: You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.
ENGINE opencode fail OpenCode: litellm.BadRequestError: You passed in model=deeps
  1.14.21 · error: OpenCode: litellm.BadRequestError: You passed in model=deepseek-flash. There are no healthy deployments for this modelNo fallback model group found for original model_group=deepseek-flash. Fallbacks=[{'auto/deepseek-v4.1-flash': ['openrouter/deepseek/deepseek-v4.1-flash']}]. Received Model Group=dee
ENGINES_FAIL 2 of 4 did not answer
exit 6
```

**Not ENGINES_OK.** The proxy and Claude Code answered. Codex and OpenCode started, spoke their JSON protocol, and reported an account or configuration error that the app shows as it is:

- Codex: the machine's Codex account is over its workspace spend cap. The same error comes from a plain `codex exec` outside the app (checked with and without `--ignore-user-config`).
- OpenCode: the machine's OpenCode config (`~/.config/opencode/opencode.json`) sets the default model `parity-proxy/deepseek-flash`, and the LLM proxy has no deployment for `deepseek-flash`. The same error comes from a plain `opencode run` outside the app. Before the app passed `LLM_PROXY_KEY` to OpenCode (the config reads `{env:LLM_PROXY_KEY}`), the error was "No api key passed in"; see decisions.md.
- Claude Code did not refuse as a nested session: the app drops `CLAUDECODE` and every `CLAUDE_CODE_*` variable from the child's environment (step 10), so the "skipped (nested session)" branch did not trigger.

Both fixes are outside this repo (docs/questions.md). With them, the run is expected to reach ENGINES_OK; that is not proven here.

### Tool policy, live (Claude Code)

A scratch script (not committed) ran the claude engine twice in a temp workspace holding `notes.txt` ("The secret word is banana."), asking for the word:

```
tools=[] answer="unknown\n\nTools are off in this session, so I can't read notes.txt. You can turn " events=thinking,done
tools=[read] answer="banana" events=thinking,tool_use:reading notes.txt,done
```

The first try, before the engines told the model about its tools, answered tools-off with invented `<tool_result>` markup and the word "lighthouse"; `toolsInstruction` (decisions.md) fixed that.

### `npm run screenshots`

```
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots
...
48.1s saved berlin-night/room.png
48.9s saved berlin-night/assistant.png
51.6s saved berlin-night/chats.png
54.0s saved berlin-night/requests.png
55.9s saved berlin-night/settings.png
56.7s saved berlin-night/keyboard.png
57.3s seeded profile removed: true

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
```

The seeded identity is `pcdecejakd.11`; the room is with the live bot `pcdpeer.47`; the Assistant runs on Claude Code (tools off).

What the PNGs show (all read): `assistant.png` has the header "Claude Code, in this app · tools: off" and a markdown answer; `room.png` has the room muted (BellOff in the header); `chats.png` has "Draft: Ask about the People chain…" on the Assistant row and the BellOff icon on `pcdpeer.47`; `settings.png` has the Chat section (send key, Notifications, Sound) and the Assistant section after "Detect installed" (Proxy "LLM proxy", Claude Code 2.1.280, Codex 0.154.0, OpenCode 1.14.21; Tools checkboxes and the workspace note); `keyboard.png` has the Keyboard section.

Found in the first run and fixed: in Berlin Night the room was no longer muted. A new message rewrote the room row (`touchRoom` → `put`) and dropped `muted`. `touchRoom` now keeps it; a spec covers it; the second run (above) shows the icon in both themes.

### Live keyboard and unread check

A scratch CDP script (not committed; same launch and seeding code as the screenshot script) drove the built app with a fresh profile of `pcdecejakd.11`. `CHECK_DRAFT_TARGET=pcdpeer.47` sends a real chat request to the bot from the draft room. Output:

```
PASS connection label (Connected)
PASS window title (Polkadot Chat)
PASS draft room composer focused
PASS Esc closes the draft
PASS Enter in the draft room sends the request (Enter mode)
PASS the peer accepted; its room opened
PASS Up arrow edits the last own message
PASS Esc cancels the edit and keeps the room
PASS the echo is unread while another room is open
PASS window title counts it ((1) Polkadot Chat)
PASS "New messages" sits above the unread echo
PASS seen in the focused window: read, title cleared (window focused)
PASS Cmd+K opens New chat with the field focused
PASS Esc closes the panel
PASS Cmd+N opens New chat
PASS Cmd+1 opens the first chat (Assistant)
PASS composer focused on open
PASS Cmd+Down moves to the next chat (pcdpeer.47)
PASS Alt+Up moves back
PASS Shift+Enter adds a newline in Enter mode
PASS Cmd+, opens Settings
PASS Esc from Settings returns to the empty room
PASS send key setting saved
PASS Enter adds a newline in Cmd+Enter mode
PASS Cmd+Enter sends in Cmd+Enter mode (0 -> 1)
PASS composer refocused after send
PASS notify:show IPC accepted
PASS title after the checks (Polkadot Chat)
```

A first run found that ⌥↑ in a contact room started an edit instead of moving to the previous chat (the composer's ↑ handler ignored modifiers). Fixed: only a plain ↑ edits.

### Not run / not seen

- **Native notification banners.** `notify:show` was accepted over IPC and `app:setBadge` is called on every unread change, but I did not look at the macOS screen, so I did not see a banner, the dock badge, or a click on a banner. The click path (restore, show, focus, `notify:open` with the room or request) is covered by `src/main/notify.spec.ts` with a fake window. Unpackaged Electron may not show banners at all.
- **The macOS menu** cannot be captured by a CDP page screenshot. Its template (app menu with About, Preferences… ⌘, → `menu:settings`, Hide, Quit; Edit roles; View with Reload and DevTools in dev only; Window; Help → README) is covered by `src/main/menu.spec.ts`. The spell-check context menu was not exercised.
- **Jump-to-bottom button and the reconnect banner** were not screenshotted (the rooms were short and the connection stayed up). The banner rule (5 s) is covered by `connectionState.spec.ts`.
- **Failed send → "Not sent · Retry"** was not seen live (no send failed); `manager.retry` is covered by two specs.
- **Stop on a CLI engine** was not pressed live; SIGTERM then SIGKILL after 3 s is covered by a spec against a real child process that ignores SIGTERM.
- `git status --short` is checked after the commit.

## M7

Run on 2026-09-23 (macOS, Apple Silicon). The bot `pcdpeer.47` was restarted on the pca RFC-0003 branch at 18:12:42 UTC (by the reviewer; I did not start or stop it). `deleted` is content kind 21 (docs/decisions.md).

### `npm run check`

```
 Test Files  39 passed (39)
      Tests  265 passed (265)
   Start at  14:17:39
   Duration  3.72s (transform 1.49s, setup 693ms, import 7.87s, tests 8.04s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (102 files)
```

(`tsc` and `eslint` print nothing when clean; exit code 0.)

### `npm run smoke`

```
✓ built in 175ms
SMOKE_OK
```

### `npm run e2e:chat -- pcdpeer.47 --delete`

Final run (18:18 UTC, the committed code):

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47 --delete

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7048375 (runtime ready in 1.9s)
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping a2006a
REPLY Echo: ping a2006a
REPLY_HAS_NONCE yes
DOOMED_SENT delete me 7eec81
DOOMED_ECHO Echo: delete me 7eec81
DELETE_SENT 1ad63d86-1920-426a-bb9c-974898d8abcb
LOCAL_TOMBSTONE yes
PING_SENT ping 6ca1e3
REPLY Echo: ping 6ca1e3
REPLY_HAS_NONCE yes
REPLY_QUOTES_DELETED no
E2E_OK
```

The bot log (`/tmp/pcdpeer.log`, read only) for this run and for the first run at 18:14 UTC (same output, `DELETE_SENT 1e00aace-8b6a-4a83-86a3-8c63fa660f4b`):

```
{"time":"2026-09-23T18:14:59.881Z","event":"BOT_PROTOCOL_EXTENSION_ENABLED","peer":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","kind":"deleted"}
{"time":"2026-09-23T18:14:59.881Z","event":"BOT_RECEIVED_DELETED","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messageId":"1e00aace-8b6a-4a83-86a3-8c63fa660f4b","applied":true}
{"time":"2026-09-23T18:18:03.661Z","event":"BOT_RECEIVED_DELETED","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messageId":"1ad63d86-1920-426a-bb9c-974898d8abcb","applied":true}
```

Each `DELETE_SENT` id is the id in a `BOT_RECEIVED_DELETED` line with `"applied":true`. The answer to the ping after the deletion does not quote the deleted text.

### `npm run screenshots`

```
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots

0.5s built
5.8s saved berlin-day/signup.png
11.8s saved berlin-night/signup.png
12.5s seeded pcdecejakd.11
12.5s assistant engine claude
28.4s accepted the request of pcdtestjaia.98
31.4s saved berlin-day/room.png
31.6s deleting, the toast shows
37.7s tombstone shown
38.5s saved berlin-day/room-deleted.png
43.4s saved berlin-day/assistant.png
46.1s saved berlin-day/chats.png
48.5s saved berlin-day/requests.png
51.2s saved berlin-day/settings.png
52.0s saved berlin-day/keyboard.png
55.8s saved berlin-night/room.png
56.6s saved berlin-night/room-deleted.png
57.5s saved berlin-night/assistant.png
60.2s saved berlin-night/chats.png
62.6s saved berlin-night/requests.png
64.5s saved berlin-night/settings.png
65.3s saved berlin-night/keyboard.png
66.0s seeded profile removed: true

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/room-deleted.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/room-deleted.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
```

The room peer is the test identity `pcdtestjaia.98` (`PCD_SCREENSHOT_ROOM_WITH`). Its `e2e-chat.mjs` run got `--live-frame` and sent a real `⏳ working · 12s · step 2` text over the wire after its ping was answered. The echo bot sends no live frames.

What the PNGs show (I read all of the new and changed ones):

- `berlin-day/room-deleted.png`, `berlin-night/room-deleted.png`: the incoming live frame as a dimmed row "working · 12s · step 2 / ▸ Reading notes.md / ▸ Searching the People chain", with no hourglass, no time and no ticks. There is an own bubble "Message deleted" in italic tertiary with its time only (no ticks). In Berlin Day, the chat list preview is "You: Message deleted". The Night room has a second "hello" after the tombstone (the room step sends one in each theme).
- The script's log lines "deleting, the toast shows" and "tombstone shown" come from waits in the DOM: the bubble said "Deleting…", a Sonner toast said "This asks their device to delete it.", and after the 6 s Undo time the bubble became the tombstone. The PNG is taken after the toast closed.
- `berlin-day/settings.png`: the Chat section has "Reveal bot replies" (on) under Notifications and Sound.
- `berlin-day/room.png`: the same room before the deletion; the chat list preview there shows the raw frame text "⏳working · 12s · step 2 ▸ Readin…" (docs/questions.md).

### Not run / not seen

- **RFC-0003 case 2 (pre-delivery removal)** is not implemented: the SDK cannot take one message out of the outstanding batch (docs/decisions.md). Case 1 (a `failed` row is removed and nothing is sent) is covered by a spec, not by a live run.
- **The typing reveal was not seen live.** No peer on devnet edits a live frame into an answer (the echo bot has no live progress), and a PNG cannot show motion. `revealedLength` and `answerArrived` have specs; the hook itself ran only in the build, with no reveal triggered in the screenshots.
- **The pulse of the live frame** and **Undo** were not seen in a PNG. Undo is not exercised by the script; its path is the same timer pattern as the identity reset's Undo.
- **The Assistant's "Delete"** was not pressed in the app. `deleteMessage` has two specs (context and session dropped; no delete while streaming, no overwrite by a late event).
- **The incoming tombstone in the app UI** was not seen live: the pca bot receives deletions but does not send them. The recipient rules have specs over the real SDK sessions and codec (`manager.messaging.spec.ts`) and over Dexie (`messages.spec.ts`).
- `git status --short` is checked after the commit.

## M7b

Run on 2026-09-23 (macOS, Apple Silicon). The bots pcdpeer.47, pcdpirate.81, pcdcolor.05 and pcdguide.70 were running on devnet. I did not start or stop them.

### `npm run check`

```
Test Files  40 passed (40)
      Tests  280 passed (280)
   Start at  15:05:17
   Duration  3.70s (transform 1.42s, setup 667ms, import 7.78s, tests 8.53s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (104 files)
```

(`tsc` and `eslint` print nothing when clean; exit code 0.)

### `npm run smoke`

```
✓ built in 174ms
SMOKE_OK
```

### 5 000-row timing (step 4)

`npx vitest run src/renderer/domain/chat/messages.spec.ts --reporter=verbose`:

```
stdout | src/renderer/domain/chat/messages.spec.ts > searchMessages > answers under 50 ms over 5 000 rows
searchMessages over 5000 rows: 10.0 ms, 10 hits
 ✓ src/renderer/domain/chat/messages.spec.ts > searchMessages > answers under 50 ms over 5 000 rows 169ms
```

The first cut (Dexie `Collection.filter()`) measured 89.1 ms and failed the 50 ms test. The committed `toArray()` + JavaScript filter measured 10.0 ms (docs/decisions.md).

### `npm run screenshots` (headless, the committed code)

```
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots

> polkadot-chat-desktop@0.1.0 screenshots
> node scripts/screenshots.mjs

0.5s built
5.7s saved berlin-day/signup.png
11.1s saved berlin-night/signup.png
11.9s seeded pcdecejakd.11
11.9s assistant engine claude
29.3s accepted the request of pcdtestjaia.98
32.5s saved berlin-day/room.png
32.7s deleting, the toast shows
38.8s tombstone shown
39.6s saved berlin-day/room-deleted.png
44.5s saved berlin-day/assistant.png
47.2s saved berlin-day/chats.png
50.3s request sent to pcdpirate.81 from a global search hit
52.2s saved berlin-day/search.png
52.4s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke03:03 PM"
52.5s saved berlin-day/search-jump.png
53.8s the highlight ended
58.3s global search "pcd": 7 rows, 14 after Show more
59.2s saved berlin-day/search-empty.png
61.5s saved berlin-day/search-no-results.png
62.9s saved berlin-day/requests.png
64.8s saved berlin-day/settings.png
65.6s saved berlin-day/keyboard.png
69.1s saved berlin-night/room.png
69.9s saved berlin-night/room-deleted.png
70.8s saved berlin-night/assistant.png
73.4s saved berlin-night/chats.png
76.6s saved berlin-night/search.png
76.9s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke03:03 PM"
76.9s saved berlin-night/search-jump.png
78.2s the highlight ended
79.0s saved berlin-night/search-empty.png
82.2s saved berlin-night/search-no-results.png
83.5s saved berlin-night/requests.png
85.1s saved berlin-night/settings.png
86.0s saved berlin-night/keyboard.png
86.6s seeded profile removed: true

PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/room-deleted.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/search.png
  .agent-runs/screens/berlin-day/search-jump.png
  .agent-runs/screens/berlin-day/search-empty.png
  .agent-runs/screens/berlin-day/search-no-results.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/room-deleted.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/search.png
  .agent-runs/screens/berlin-night/search-jump.png
  .agent-runs/screens/berlin-night/search-empty.png
  .agent-runs/screens/berlin-night/search-no-results.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
```

Live checks inside this run: a global search hit opened the draft room and sent a request to `pcdpirate.81`, and the bot accepted it (its reply is in the list). ↓↓ from the field highlighted the first global row. A message hit opened the room with the message highlighted, and the highlight ended within 1.5 s. "Show more" for `pcd` went from 7 to 14 rows.

What the PNGs show (I read all of the new ones in both themes, and room/room-deleted/chats/keyboard):

- `search.png` (both): the field "pcdp"; CHATS AND CONTACTS: pcdpirate.81 (its last message as the preview); GLOBAL SEARCH: pcdpeer.47, "Not a contact yet", with the keyboard highlight; MESSAGES: pcdtestjaia.98, "You: Ask **pcdp**irate.81 for a pirate …", time "Now". The overline headers are uppercase tertiary.
- `search-jump.png` (both): the room with pcdtestjaia.98 scrolled to "Ask pcdpirate.81 for a pirate joke" with the band behind the row; the search results stay on the left.
- `search-empty.png` (both): "+" active, placeholder "Type username", RECENT with the two contact rooms.
- `search-no-results.png` (both): "No results for “qxzqxzq”" with the SearchX icon.
- `room.png` (Day): the chat list preview of the room with the live frame is "Typing…" in tertiary (carry item 2). Before, it showed the raw frame.
- `keyboard.png`: ⌘K "Search chats, people and messages", ⌘N "New chat", "↑ / ↓ and Enter in the search".

Visual problems I saw and fixed: the Night run sent the room message twice (the script checked before the room rendered; it now waits). The first highlight band hugged the bubble and I tried vertical padding, but that moved every row by 4 px (margin collapse), so I reverted to the horizontal band. The `search-jump` capture came too late in a slow run (after the 1.5 s), so that shot now captures at once.

### Headless mode check (owner request)

A hidden 1280×800 `BrowserWindow` with `show: false`, `paintWhenInitiallyHidden: true`, `backgroundThrottling: false` and `app.dock.hide()`, loading the built renderer, then `webContents.capturePage()` (a scratch Electron script, not committed):

```
visible=false visibilityState=visible size=2560x1536 empty=false sampledColors=47 nonWhiteSamples=40538
```

The PNG shows rendered text (the harness has no IPC handlers, so the page shows its IPC error line). It is not blank. The run above is headless, and its CDP captures are the PNGs I read. No window came to the front.

### Earlier runs that failed (window visible, before the headless mode)

The last run before the headless change:

```
> polkadot-chat-desktop@0.1.0 screenshots
> node scripts/screenshots.mjs

0.5s built
11.3s saved berlin-day/signup.png
22.4s saved berlin-night/signup.png
23.2s seeded pcdecejakd.11
23.2s assistant engine claude
36.9s accepted the request of pcdtestjaia.98
157.3s missed berlin-day/room.png: no message from pcdtestjaia.98
157.6s deleting, the toast shows
164.4s tombstone shown
284.6s missed berlin-day/room-deleted.png: no live frame from pcdtestjaia.98 (see .agent-runs/screens/room-peer.log)
297.1s saved berlin-day/assistant.png
305.0s saved berlin-day/chats.png
366.1s missed berlin-day/search.png: pcdpirate.81 not found by the global search: "GLOBAL SEARCH\n\nSearching…"
376.1s missed berlin-day/search-jump.png: no highlighted message after the jump
376.1s the highlight ended
442.3s saved berlin-day/search-empty.png
464.2s saved berlin-day/search-no-results.png
470.4s saved berlin-day/requests.png
477.7s saved berlin-day/settings.png
483.6s saved berlin-day/keyboard.png
487.7s saved berlin-night/room.png
488.5s saved berlin-night/room-deleted.png
489.4s saved berlin-night/assistant.png
492.0s saved berlin-night/chats.png
496.9s request sent to pcdpirate.81 from a global search hit
499.5s saved berlin-night/search.png
499.8s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke03:00 PM"
499.8s saved berlin-night/search-jump.png
501.1s the highlight ended
501.9s saved berlin-night/search-empty.png
504.0s saved berlin-night/search-no-results.png
504.9s saved berlin-night/requests.png
507.0s saved berlin-night/settings.png
507.8s saved berlin-night/keyboard.png
508.4s seeded profile removed: true

PNGs:

Not captured:
  berlin-day/room.png (no message from pcdtestjaia.98)
  berlin-day/room-deleted.png (no live frame from pcdtestjaia.98 (see .agent-runs/screens/room-peer.log))
  berlin-day/search.png (pcdpirate.81 not found by the global search: "GLOBAL SEARCH\n\nSearching…")
  berlin-day/search-jump.png (no highlighted message after the jump)
  berlin-day: Show more (no Show more for "pcd")
SCREENSHOTS_PARTIAL
```

Here the room peer's script gave no message within 120 s, and username searches stayed at "Searching…" for 60 s. A `curl` to the backend a minute later answered in 0.4 s. A likely cause is timer throttling of the backgrounded window during proof-of-work mining. That is why each search now has a 15 s limit that also stops the mining, and why the headless window has `backgroundThrottling: false`. An earlier run had "Show more added no rows" once. Five other runs passed (docs/questions.md).

### Not run / not seen

- The global search's "Search unavailable" line was not seen in a PNG. The timeout path has a spec (a fetch that never answers is aborted).
- The "Searching…" line was not captured in a PNG. The failed-run output above shows it as the text of the global section.
- The `🤔 ` live frame was not seen from a real pca bot. It has a spec. The live frame in the screenshots is the `⏳` frame from the test identity.
- `--visible` was not run after the change (all visible runs above came before it; the flag only drops the env var).
- `git status --short` is checked after the commit.

## M8

Run on 2026-09-23 against devnet. The pca half is `polkadot-chat-agents` commit 2acd215 (branch `desktop/rfc-0003`); the coordinator restarted the bots at 15:20:53 with the buttons extension on.

### npm run check

```
> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint . && npm run check:tokens
 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop
 Test Files  41 passed (41)
      Tests  306 passed (306)
   Start at  15:27:11
   Duration  3.73s (transform 1.48s, setup 749ms, import 8.27s, tests 8.46s, environment 2ms)
> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs
check:tokens: clean (105 files)
```

The pca vectors of `docs/spec/vectors-0006.md` are in `src/renderer/domain/chat/content.spec.ts`: vector A (buttons) and vector B (buttonPress) decode to the pinned values and encode to the same bytes (four tests, all pass above).

### npm run smoke

```
✓ built in 186ms
SMOKE_OK
```

(Last lines of the output; the build lines before them are the usual electron-vite output.)

### npm run e2e:buttons — NOT PASSED (exit 4)

First run:

```
> polkadot-chat-desktop@0.1.0 e2e:buttons
> node scripts/e2e-buttons.mjs
identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7049772 (runtime ready in 1.8s)
PEER 0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06 key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Sorry — I couldn't reach my agent just now. Please try again in a moment.
MENU_SENT menu
BUTTONS_RECEIVED rows=1
BUTTONS_TEXT Hey! I'm here to help with Polkadot, staking, governance, and the Polkadot app. What would you like 
  row 0: [Staking · command] [Governance · command] [Colour of the day · callback] [Docs · url]
PRESS_SENT row=0 index=2 label="Colour of the day"
PRESS_REPLY Emerald — #50C878 (does not name "Colour of the day")
E2E_TIMEOUT press reply
```

Second run (exit=4):

```
> polkadot-chat-desktop@0.1.0 e2e:buttons
> node scripts/e2e-buttons.mjs
identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7049780 (runtime ready in 1.9s)
PEER 0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06 key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Sorry — I couldn't reach my agent just now. Please try again in a moment.
MENU_SENT menu
BUTTONS_RECEIVED rows=1
BUTTONS_TEXT What would you like to know about?
  row 0: [Staking · command] [Governance · command] [Colour of the day · callback] [Docs · url]
PRESS_SENT row=0 index=2 label="Colour of the day"
PRESS_REPLY Tangerine — #F28500 (does not name "Colour of the day")
E2E_TIMEOUT press reply
```

What passed: the guide bot `pcdguide.70` answered `menu` with a real kind-242 keyboard (`BUTTONS_RECEIVED rows=1`, four buttons: two commands, one callback, one url), and the desktop sent the callback press (`PRESS_SENT`). The bot answered the press within 60 s with a colour, which shows that it received the press. What failed: step 6 needs a reply that names the label ("Colour of the day"), and neither reply did, so `BUTTONS_OK` was not printed. The criterion is unchanged. The question is in docs/questions.md. The greeting line in both runs is an error text from the bot (docs/questions.md).

### npm run screenshots

```
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots
```

```
0.5s built
5.8s saved berlin-day/signup.png
11.2s saved berlin-night/signup.png
12.0s seeded pcdecejakd.11
12.0s assistant engine claude
27.1s accepted the request of pcdtestjaia.98
30.3s saved berlin-day/room.png
30.6s deleting, the toast shows
36.6s tombstone shown
37.5s saved berlin-day/room-deleted.png
37.5s callback pressed, spinner on
37.5s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
37.5s disabled buttons: 1
38.3s saved berlin-day/room-buttons.png
43.2s saved berlin-day/assistant.png
45.9s saved berlin-day/chats.png
49.7s request sent to pcdpirate.81 from a global search hit
52.6s saved berlin-day/search.png
52.9s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke03:26 PM"
52.9s saved berlin-day/search-jump.png
54.2s the highlight ended
55.7s global search "pcd": 7 rows, 14 after Show more
56.5s saved berlin-day/search-empty.png
59.1s saved berlin-day/search-no-results.png
60.5s saved berlin-day/requests.png
62.4s saved berlin-day/settings.png
63.2s saved berlin-day/keyboard.png
66.7s saved berlin-night/room.png
67.5s saved berlin-night/room-deleted.png
67.5s callback pressed, spinner on
67.5s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
67.5s disabled buttons: 1
68.4s saved berlin-night/room-buttons.png
69.2s saved berlin-night/assistant.png
71.9s saved berlin-night/chats.png
77.1s saved berlin-night/search.png
77.4s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke03:26 PM"
77.4s saved berlin-night/search-jump.png
78.7s the highlight ended
79.5s saved berlin-night/search-empty.png
81.9s saved berlin-night/search-no-results.png
82.8s saved berlin-night/requests.png
84.6s saved berlin-night/settings.png
85.5s saved berlin-night/keyboard.png
86.0s seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/room-deleted.png
  .agent-runs/screens/berlin-day/room-buttons.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/search.png
  .agent-runs/screens/berlin-day/search-jump.png
  .agent-runs/screens/berlin-day/search-empty.png
  .agent-runs/screens/berlin-day/search-no-results.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/room-deleted.png
  .agent-runs/screens/berlin-night/room-buttons.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/search.png
  .agent-runs/screens/berlin-night/search-jump.png
  .agent-runs/screens/berlin-night/search-empty.png
  .agent-runs/screens/berlin-night/search-no-results.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
exit=0
```

I read `berlin-day/room-buttons.png` and `berlin-night/room-buttons.png`. Both show the room peer's message "What would you like to do?" with two rows: "Show my balance" (callback, pressed: primary fill and a spinner), "Staking" (command), "Open the docs" (url, with the link icon, highlighted while its strip is open) and "Stake 10 DOT" (reserved `tx`, disabled). Under the bubble, the strip says "Open **docs.polkadot.com** in your browser?" with Cancel and Open. In Berlin Day the chat list shows the keyboard's text as the preview.

### Not run / not seen

- `BUTTONS_OK` was not seen (see above).
- The Open button of the url strip was not clicked in a run, so `shell.openExternal` through `open:url` was not seen opening a browser. The scheme rule has a spec (`src/shared/buttonsBlock.spec.ts`, `openableUrl`).
- The tooltip of a disabled button was not captured in a PNG.
- A `command` press and a received `buttonPress` were not driven in the app UI. They have manager specs against an in-memory store (`manager.messaging.spec.ts`).
- The Assistant's buttons were not seen from a real engine. The parser and the Assistant path have specs (`buttonsBlock.spec.ts`, `assistant.spec.ts`).
- `git status --short` is checked after the commit.

## M9

Run on 2026-09-23 against devnet. The pca half is `polkadot-chat-agents` commit ec73ad3 (branch `desktop/rfc-0003`). The coordinator restarted the four bots on it at 15:47:49 (bot log: `BOT_PROTOCOL_EXTENSIONS enabled: deleted, buttons, typing, seen`). I did not start or stop any bot.

### npm run check

```
> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint . && npm run check:tokens
 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop
 Test Files  42 passed (42)
      Tests  334 passed (334)
   Start at  16:11:31
   Duration  3.74s (transform 1.76s, setup 708ms, import 8.41s, tests 8.93s, environment 2ms)
> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs
check:tokens: clean (107 files)
```

Both pca vectors of `docs/spec/vectors-0005.md` (typing `TYP-1`, seen `SEN-1`) are pinned in `src/renderer/domain/chat/content.spec.ts`: each decodes byte for byte to the file's values and encodes to the same bytes (tests "encodes both byte for byte…" and "decodes both vectors…", both pass above). The file appeared at the 7th 60 s poll (15:45:33); my hand-derived vector A was already identical to pca's.

### npm run smoke

```
✓ built in 175ms
SMOKE_OK
```

(Last lines; the lines before them are the usual electron-vite build output.)

### npm run e2e:typing — PASSED (exit 0)

```
> polkadot-chat-desktop@0.1.0 e2e:typing
> node scripts/e2e-typing.mjs
identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7050360 (runtime ready in 1.9s)
PEER 0x66b78abdcb4c89d2817ce45f201677c08240fde23c50b9c94a6abb6912888a63 key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Sorry — I couldn't reach my agent just now. Please try again in a moment.
QUESTION_SENT 6fed02fc-1f40-4220-a08e-22be351fd0f8
SEEN_RECEIVED upTo=6fed02fc-1f40-4220-a08e-22be351fd0f8 at=1.0s seenAt=2026-09-23T19:50:59.288Z
TYPING_RECEIVED kind=working at=1.4s ahead=5692ms
TYPING_CLEARED at=4.7s
SEEN_SENT upTo=9FA23BA2-F07E-4B23-BEE4-C564F8E71612
REPLY at=5.0s What do ye call a pirate who guards the blocks, matey? A block-kade! Har, that be the finest joke on
TYPING_BEFORE_REPLY yes
TYPING_UPDATES 1
TYPING_OK
EXIT=0
```

The bot log (`/tmp/pcdpirate.log`, read only) for the same turn: `BOT_RECEIVED_TEXT` 19:50:59.285, `BOT_SENT_SEEN` upTo `6fed02fc-…` at 59.289, `BOT_SENT_TYPING kind: working` at 59.996, `BOT_SENT_TEXT` at 19:51:03.530. The order in the script output is the order of arrival: pca sends `seen` when it consumes the message, before the turn starts, so `SEEN_RECEIVED` comes first. `TYPING_CLEARED at=4.7s` is the reply clearing the hint (the reply row is polled once per second, so `REPLY` prints at 5.0 s).

An earlier run the same minute also ended `TYPING_OK`, but it took the bot's answer to the request opener ("Sorry — I couldn't reach my agent…", sent before our question) for the reply and printed `TYPING_BEFORE_REPLY no`. The bot log showed the real order (question 19:50:26.052, seen .056, typing 26.742, answer 30.782). The script now takes only a row newer than the question (docs/decisions.md). The run above is the fixed script.

### npm run screenshots

Command: `PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots` (headless).

```
> polkadot-chat-desktop@0.1.0 screenshots
> node scripts/screenshots.mjs
0.5s built
5.7s saved berlin-day/signup.png
11.1s saved berlin-night/signup.png
11.9s seeded pcdecejakd.11
11.9s assistant engine claude
30.3s accepted the request of pcdtestjaia.98
33.2s saved berlin-day/room.png
33.4s deleting, the toast shows
39.5s tombstone shown
40.3s saved berlin-day/room-deleted.png
40.3s callback pressed, spinner on
40.3s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
40.3s disabled buttons: 1
41.2s saved berlin-day/room-buttons.png
41.9s seen tick shown
42.6s tooltip: "Seen 04:12 PM"
43.2s saved berlin-day/room-seen.png
44.5s header: "working…"
45.3s saved berlin-day/room-typing.png
50.2s saved berlin-day/assistant.png
52.9s saved berlin-day/chats.png
57.8s request sent to pcdpirate.81 from a global search hit
60.1s saved berlin-day/search.png
60.4s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke04:12 PM"
60.4s saved berlin-day/search-jump.png
61.7s the highlight ended
64.0s global search "pcd": 7 rows, 14 after Show more
64.8s saved berlin-day/search-empty.png
67.2s saved berlin-day/search-no-results.png
68.5s saved berlin-day/requests.png
70.4s saved berlin-day/settings.png
71.2s saved berlin-day/keyboard.png
74.9s saved berlin-night/room.png
75.8s saved berlin-night/room-deleted.png
75.8s callback pressed, spinner on
75.8s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
75.8s disabled buttons: 1
76.6s saved berlin-night/room-buttons.png
78.2s seen tick shown
78.8s tooltip: "Seen 04:12 PM"
79.5s saved berlin-night/room-seen.png
81.0s header: "working…"
81.8s saved berlin-night/room-typing.png
82.7s saved berlin-night/assistant.png
85.3s saved berlin-night/chats.png
90.1s saved berlin-night/search.png
90.3s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke04:12 PM"
90.3s saved berlin-night/search-jump.png
91.6s the highlight ended
92.4s saved berlin-night/search-empty.png
94.5s saved berlin-night/search-no-results.png
95.6s saved berlin-night/requests.png
97.5s saved berlin-night/settings.png
98.3s saved berlin-night/keyboard.png
98.9s seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/room-deleted.png
  .agent-runs/screens/berlin-day/room-buttons.png
  .agent-runs/screens/berlin-day/room-seen.png
  .agent-runs/screens/berlin-day/room-typing.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/search.png
  .agent-runs/screens/berlin-day/search-jump.png
  .agent-runs/screens/berlin-day/search-empty.png
  .agent-runs/screens/berlin-day/search-no-results.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/room-deleted.png
  .agent-runs/screens/berlin-night/room-buttons.png
  .agent-runs/screens/berlin-night/room-seen.png
  .agent-runs/screens/berlin-night/room-typing.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/search.png
  .agent-runs/screens/berlin-night/search-jump.png
  .agent-runs/screens/berlin-night/search-empty.png
  .agent-runs/screens/berlin-night/search-no-results.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
EXIT=0
```

What I saw in the new PNGs:

- `berlin-day/room-seen.png`, `berlin-night/room-seen.png`: the own messages show the double tick in the link blue; the pointer is on the last tick and the tooltip reads "Seen 04:12 PM". The hover also shows the message's reaction toolbar (a real hover state).
- `berlin-day/room-typing.png`, `berlin-night/room-typing.png`: the header subtitle reads "working…" in the caption style with the three dots; the chat-list row of the peer reads "working…" in the tertiary tone. The ticks of the earlier messages are the seen colour.
- The other room shots now also show seen ticks on own messages, because the room peer marks every app message read.

Earlier runs of the same command (same session):

1. Run 1: `room-seen` missed in both themes ("no seen"). Cause: my `e2e-chat.mjs --seen` loop took `toArray()` order (by id) as time order, so it sent `seen` only once. Fixed (sort by timestamp). Every other PNG was saved.
2. Runs 2 and 3: `berlin-night/room-seen.png` missed ("no Seen tooltip on hover"). Cause: `room-buttons` scrolls the keyboard into view, so in the longer night room the new message was below the view and the pointer missed the tick. Fixed (scroll the message into view, measure, retry the hover up to 4 times).
3. Run 4: all ten room shots missed. The room peer printed `REQUEST_SENT` then `E2E_TIMEOUT accept`: the app accepted at 28 s, but the accept did not reach the peer in 120 s. No code on the accept path changed in M9, and runs 1–3 and 5 passed that stage, so I count it as a devnet flake. Run 5 (above) is the committed code.

### Not run / not seen

- `e2e:typing` does not check `typing{composing}` from a person, because no phone app sends kind 240 yet. The desktop's own `composing` send is covered by `manager.messaging.spec.ts` (two clients, one in-memory store).
- The deferral of a `seen` with an unknown `upTo` is covered by `signals.spec.ts` (the bounded set) and `messages.spec.ts` (`applySeen` returns `unknown`); no two-client test drives the race, because a test cannot choose the id of a message the manager sends.
