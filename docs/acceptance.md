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

## M10

Run on 2026-09-23 against devnet. The pca half is `polkadot-chat-agents` commit 70d8a87 (branch `desktop/rfc-0003`). The bots were restarted by the coordinator (pcdguide log 20:56:14Z: `BOT_PROTOCOL_EXTENSIONS` enabled deleted, buttons, typing, seen, botinfo). I did not start or stop any bot.

### npm run check

```
> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint . && npm run check:tokens
 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop
 Test Files  45 passed (45)
      Tests  372 passed (372)
   Start at  17:02:59
   Duration  3.72s (transform 1.66s, setup 810ms, import 8.16s, tests 9.18s, environment 3ms)
> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs
check:tokens: clean (115 files)
EXIT=0
```

The pca vector of `docs/spec/vectors-0008.md` (`BOT-1`, kind 244) decodes byte for byte to the file's values and the values encode to the same bytes (`content.spec.ts`, "decodes the pca vector byte for byte…" and "encodes the pinned values…", both pass above). The file appeared at the 3rd 60 s poll (16:45:22).

### npm run smoke

```
✓ built in 178ms
SMOKE_OK
```

(Last lines; the lines before them are the usual electron-vite build output.)

### npm run e2e:botinfo — PASSED (exit 0)

```
> polkadot-chat-desktop@0.1.0 e2e:botinfo
> node scripts/e2e-botinfo.mjs
identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7051652 (runtime ready in 1.8s)
PEER 0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06 key_type=0
REQUEST_SENT
ACCEPTED devices=1
BOTINFO_RECEIVED name="Polkadot Guide" commands=5 kind=agent version=1 at=0.0s
BOTINFO_DESCRIPTION Friendly Polkadot support: staking, governance, parachains, the app. Test bot on devnet.
BOTINFO_COMMANDS /help /menu /staking /governance /reset
GREETING_ROW Hi! Ask me anything about Polkadot, or type /menu.
START_SENT /start
START_ANSWER botInfo again version=1 at=1.0s
START_TEXT Hi! Ask me anything about Polkadot, or type /menu.
START_OK
BOTINFO_OK
EXIT=0
```

A first run the same minute also ended `BOTINFO_OK` with the same lines; its exit code was lost to my shell's `PIPESTATUS` (zsh), so I ran it again with the exit code captured (above). `at=0.0s`: pca sends `botInfo` in the same statement as the accept, so the row exists when the accept is seen. After `/start` the bot sent `botInfo` again (same version, new `botInfoAt`) and then the greeting as text, as vectors-0008.md says.

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
28.0s accepted the request of pcdtestjaia.98
46.3s saved berlin-day/room.png
46.6s deleting, the toast shows
52.6s tombstone shown
53.5s saved berlin-day/room-deleted.png
53.5s callback pressed, spinner on
53.5s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
53.5s disabled buttons: 1
54.3s saved berlin-day/room-buttons.png
54.3s header: "Answers staking questions and checks your rewards"
54.3s command menu: ["/stakingHow staking works","/rewardsYour rewards this era","/validatorsPick validators to nominate","/startStart over","/helpWhat I can do"]
55.8s saved berlin-day/room-bot.png
57.0s seen tick shown
57.7s tooltip: "Seen 05:01 PM"
58.4s saved berlin-day/room-seen.png
60.1s header: "working…"
61.0s saved berlin-day/room-typing.png
65.9s saved berlin-day/assistant.png
68.5s saved berlin-day/chats.png
71.9s request sent to pcdpirate.81 from a global search hit
74.8s saved berlin-day/search.png
75.0s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke05:01 PM"
75.1s saved berlin-day/search-jump.png
76.4s the highlight ended
77.9s global search "pcd": 7 rows, 14 after Show more
78.7s saved berlin-day/search-empty.png
80.6s saved berlin-day/search-no-results.png
81.6s bots: ["Faucet Test funds for devnet","P Captain Dot A cheerful pirate who answers everything in pirate speak. Test bot on devnet.","P Staking Helper Answers staking questions and checks your rewards"]
81.6s sections: ["Bots"]
82.5s saved berlin-day/search-bots.png
82.7s faucet strip: "Open faucet.polkadot.io in your browser?CancelOpen"
83.6s saved berlin-day/faucet.png
84.9s saved berlin-day/requests.png
86.8s saved berlin-day/settings.png
87.6s saved berlin-day/keyboard.png
91.3s saved berlin-night/room.png
92.2s saved berlin-night/room-deleted.png
92.2s callback pressed, spinner on
92.2s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
92.2s disabled buttons: 1
93.0s saved berlin-night/room-buttons.png
93.0s header: "Answers staking questions and checks your rewards"
93.0s command menu: ["/stakingHow staking works","/rewardsYour rewards this era","/validatorsPick validators to nominate","/startStart over","/helpWhat I can do"]
94.5s saved berlin-night/room-bot.png
96.3s seen tick shown
96.9s tooltip: "Seen 05:02 PM"
97.6s saved berlin-night/room-seen.png
99.1s header: "working…"
99.9s saved berlin-night/room-typing.png
100.8s saved berlin-night/assistant.png
103.5s saved berlin-night/chats.png
106.7s saved berlin-night/search.png
107.0s jumped to the message hit, highlighted: "👍❤️😂😮😢🙏🔥👏Ask pcdpirate.81 for a pirate joke05:01 PM"
107.0s saved berlin-night/search-jump.png
108.3s the highlight ended
109.1s saved berlin-night/search-empty.png
111.7s saved berlin-night/search-no-results.png
113.5s bots: ["Faucet Test funds for devnet","P Captain Dot A cheerful pirate who answers everything in pirate speak. Test bot on devnet.","P Staking Helper Answers staking questions and checks your rewards"]
113.5s sections: ["Bots"]
114.3s saved berlin-night/search-bots.png
114.9s faucet strip: "Open faucet.polkadot.io in your browser?CancelOpen"
115.7s saved berlin-night/faucet.png
117.0s saved berlin-night/requests.png
119.1s saved berlin-night/settings.png
120.0s saved berlin-night/keyboard.png
120.6s seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/signup.png
  .agent-runs/screens/berlin-night/signup.png
  .agent-runs/screens/berlin-day/room.png
  .agent-runs/screens/berlin-day/room-deleted.png
  .agent-runs/screens/berlin-day/room-buttons.png
  .agent-runs/screens/berlin-day/room-bot.png
  .agent-runs/screens/berlin-day/room-seen.png
  .agent-runs/screens/berlin-day/room-typing.png
  .agent-runs/screens/berlin-day/assistant.png
  .agent-runs/screens/berlin-day/chats.png
  .agent-runs/screens/berlin-day/search.png
  .agent-runs/screens/berlin-day/search-jump.png
  .agent-runs/screens/berlin-day/search-empty.png
  .agent-runs/screens/berlin-day/search-no-results.png
  .agent-runs/screens/berlin-day/search-bots.png
  .agent-runs/screens/berlin-day/faucet.png
  .agent-runs/screens/berlin-day/requests.png
  .agent-runs/screens/berlin-day/settings.png
  .agent-runs/screens/berlin-day/keyboard.png
  .agent-runs/screens/berlin-night/room.png
  .agent-runs/screens/berlin-night/room-deleted.png
  .agent-runs/screens/berlin-night/room-buttons.png
  .agent-runs/screens/berlin-night/room-bot.png
  .agent-runs/screens/berlin-night/room-seen.png
  .agent-runs/screens/berlin-night/room-typing.png
  .agent-runs/screens/berlin-night/assistant.png
  .agent-runs/screens/berlin-night/chats.png
  .agent-runs/screens/berlin-night/search.png
  .agent-runs/screens/berlin-night/search-jump.png
  .agent-runs/screens/berlin-night/search-empty.png
  .agent-runs/screens/berlin-night/search-no-results.png
  .agent-runs/screens/berlin-night/search-bots.png
  .agent-runs/screens/berlin-night/faucet.png
  .agent-runs/screens/berlin-night/requests.png
  .agent-runs/screens/berlin-night/settings.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
EXIT=0
```

What I saw in the new PNGs:

- `berlin-day/room-bot.png`, `berlin-night/room-bot.png`: header "pcdtestjaia.98" with the `Sparkles` badge (AI agent), the line "Answers staking questions and checks your rewards" under it; the greeting row "Hi! I explain staking on Polkadot. Type / to see what I can do." as a centred block; the command menu open over the composer with "/" typed: `/staking`, `/rewards`, `/validators`, `/start`, `/help` with descriptions, the first row selected. The chat list shows the badge after the name and "Draft: /" for the room while the "/" is in the field (it is cleared after the shot). The M8 url strip of the room-buttons shot is still open above the greeting.
- `berlin-day/faucet.png`, `berlin-night/faucet.png`: the Faucet second in the list with the `Bot` badge and "Test funds for devnet"; the room with the same header, the greeting block, the keyboard "Get test funds" (external-link icon) and "Copy my address", the confirm strip "Open faucet.polkadot.io in your browser?", and the line "The Faucet has no chat. Use the buttons above." instead of a composer.
- `berlin-day/search-bots.png`, `berlin-night/search-bots.png`: the query "test" shows one section, "Bots": Faucet (by its description), "Captain Dot" (pcdpirate.81, which now sends `botInfo`; its description says "Test bot on devnet") and "Staking Helper" (pcdtestjaia.98, by its username), each with its badge and description. The global search had no other hit for "test".
- `search.png` (M7b) changed: pcdpirate.81 now sent `botInfo`, so it is under "Bots" as "Captain Dot", not under "Chats and contacts". The script accepts either section now; ↓↓ still lands on the first global row.

Earlier run of the same command (same session): `search.png` missed in both themes (the script waited for the "Chats and contacts" section, and the pirate bot had moved to "Bots") and `berlin-night/faucet.png` missed ("no Faucet row in the chat list"; the script clicked before the list was back after Esc). Both fixed in the script (either section; wait up to 10 s for the row). The greeting row was also below the command menu in that run's `room-bot.png`; the script now scrolls it to the top after the menu opens. The run above is the committed code.

### Faucet URL

One `curl https://faucet.polkadot.io/` returned the SvelteKit shell only; no query parameters are documented there. The faucet's source on this machine (`~/Documents/GitHub/polkadot-testnet-faucet`, cddfc83) reads `parachain` and `address` in `client/src/lib/components/Faucet.svelte`, and `/` is Paseo (chain 1000 = Asset Hub). So the button uses `https://faucet.polkadot.io/?parachain=1000&address=<ss58, prefix 0>`. (docs/decisions.md M10.)

### Not run / not seen

- "Open" on the Faucet's confirm strip was not pressed (it would start the browser), so the prefilled address on the live faucet page is not seen; the parameter names come from the faucet's source, not from the live site.
- "Copy my address" was not pressed in the automation (it would write the machine's clipboard); the copy row is covered by `faucet.spec.ts`.
- The automatic `/start` was not seen live: every running pca bot now sends `botInfo` with the accept, so none qualifies. It is covered by `manager.messaging.spec.ts` (two clients, one in-memory store: exactly one `/start`, none to a peer without a bot sign, none after `botInfo`).
- The Assistant's `/reset` and `/model` were not run in the app; they are covered by `assistant.spec.ts`.

## M11

Run 2026-09-23 on this machine, headless, devnet. Bots `pcdfaucet.77` and `pcdmeter.01` were running (started by the pca agent, pca commit 4812bd7). Vectors: `docs/spec/vectors-0007.md` A and B decode byte for byte and encode back (`content.spec.ts`).

### npm run check (last lines)

```

 Test Files  49 passed (49)
      Tests  397 passed (397)
   Start at  18:00:11
   Duration  3.75s (transform 1.88s, setup 857ms, import 8.47s, tests 9.23s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (122 files)
EXIT 0
```

### npm run smoke

```
✓ built in 186ms
SMOKE_OK
EXIT 0
```

### npm run e2e:meter

```

SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connected
people best block #7052444
ASSET_HUB 0xd6eec261… account 5H4Lootcg7w7A4xgsPFDabSiEqFUTpdykagVckcwcx6kyQYW free 24.9922 PAS
FOUND pcdfaucet.77 0xe018148187403b5980aa5d91d38e108af1aadcb91ce5bc47f104ef04554e680f
DRIP_SENT via=request to=pcdfaucet.77 (/drip 15zdx99gXuCabbyCq2JDikGs6TF8A8C7q5Qyn3cJB38H9sMf)
DRIP_OK status=inBlock block=13620052 note="Dripped 1 PAS" hash=0xb46eba14c3aac9b9b982eb7d5c13c5122c0fd7512fbd06e196402c176c056269 at=10.8s
FOUND pcdmeter.01 0x9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967
REQUEST_SENT pcdmeter
ACCEPTED pcdmeter at=16.0s
BALANCE_BEFORE 0.7 PAS
SENT /topup
BUTTON "Top up 1 PAS" text="Add 1 PAS to your balance. Each reply costs 0.1 PAS." intent: Top up 1 PAS; calls=1 kind=1 to=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 value=10000000000
DRYRUN ok=true fee=0.0014 PAS (14510503 planck) mapsAccount=false value=10000000000
SIGNED hash=0x79fb550e97c00764073f78e436e4b590cadcd88e547523b5fd208464fbd7bf40 at=24.6s
TOPUP_OK status=inBlock block=13620060 row="Top up (1 PAS)" at=26.6s
BALANCE 1.6 PAS (16000000000 planck; before 0.7 PAS) · ~16 replies
BALANCE_NOTE the top-up is not fully visible yet (a charge may have run meanwhile)
ANSWER 1 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate, 
BALANCE 1.5 PAS (-0.1) reference="balance: 15000000000" inBlock at=36.0s
ANSWER 2 A parachain is an independent blockchain that runs on the Polkadot network, sharing security with other parach
BALANCE 1.4 PAS (-0.1) reference="balance: 14000000000" inBlock at=46.5s
ANSWER 3 Asset Hub is a Polkadot parachain that provides a common platform for creating, managing, and trading custom a
BALANCE 1.3 PAS (-0.1) reference="balance: 13000000000" inBlock at=54.9s
METERED_OK 3 answers charged: 1.6 → 1.3 PAS
TOPUP_REFERENCE finalized
METER_OK
EXIT 0
```

Notes: BALANCE_BEFORE 0.7 PAS is what an earlier development run left. After the top-up the balance read 1.6 PAS, not 1.7: the bot charged 0.1 PAS for its answer to the chat request (a brain turn) before the read; the script prints BALANCE_NOTE for that. `mapsAccount=false`: devnet Asset Hub has `Revive.AutoMap` on and the account was already mapped. An earlier development run of the same script (17:48, first drip of this identity) also ended `METER_OK` (balance 1 → 0.7 PAS).

### PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia npm run screenshots

```
54.0s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
66.5s strip: "Send to yourself A test transfer of 0.01 PAS from your account back to it Amount 0.01 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 The test run passed. Cancel Sign"
67.3s saved berlin-day/room-tx.png
67.6s reference: "Send to yourself (0.01 PAS) · submitted"
70.4s in block: "Send to yourself (0.01 PAS) · in block #13620113"
95.6s finalized: "Send to yourself (0.01 PAS) · finalized in block #13620113"
95.6s header: "Balance: 1.3 PAS · ~13 replies"
96.4s saved berlin-day/room-tx-done.png
120.4s faucet strip: "Open faucet.polkadot.io in your browser?CancelOpen"
130.1s url strip: "Open docs.polkadot.com in your browser?CancelOpen"
139.2s strip: "Send to yourself A test transfer of 0.01 PAS from your account back to it Amount 0.01 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 The test run passed. Cancel Sign"
140.0s saved berlin-night/room-tx.png
140.6s reference: "Send to yourself (0.01 PAS) · submitted"
143.3s in block: "Send to yourself (0.01 PAS) · in block #13620146"
169.3s finalized: "Send to yourself (0.01 PAS) · finalized in block #13620146"
169.3s header: "Balance: 1.3 PAS · ~13 replies"
170.1s saved berlin-night/room-tx-done.png
185.5s faucet strip: "Open faucet.polkadot.io in your browser?CancelOpen"
SCREENSHOTS_OK
EXIT 0
```

I read the PNGs: `room-tx.png` (both themes) shows the tx button (Wallet icon, label, "0.01 PAS" caption, secondary) and the inline strip under it: title, description, Amount 0.01 PAS, Fee ≈ 0.0009 PAS, Signs as pcdecejakd.11, "The test run passed.", Cancel and Sign (the only primary control; Send is secondary while the strip is open). `room-tx-done.png` shows the reference bubble "Send to yourself (0.01 PAS) · finalized in block #…" with the double tick and the Copy button, the double tick on the pressed button, and the header "Balance: 1.3 PAS · ~13 replies · Answers staking questions…". Both runs of the tx signed for real on devnet Asset Hub. Earlier shots (room-buttons, room-bot, faucet with the new "Get 1 PAS" row) were read too.

Earlier attempt (for the record): the first screenshot run missed `room-buttons.png` (its selector took the new tx keyboard) and night `room-bot.png` (the Meter line had replaced the bot description). Both are fixed (docs/decisions.md M11).

### git status --short

This file is part of the commit, so the result of `git status --short` after it is in the M11 hand-off report, not here.

## M11b

Run 2026-09-23 on this machine, headless, devnet. Bots `pcdfaucet.77`, `pcdmeter.01` (restarted by the pca agent with a balance hint) and `pcdflip.44` were running (pca commit 061b470). Vector: `docs/spec/vectors-0008b.md` decodes to the pinned values and the values encode to the same 258 bytes (`content.spec.ts`); `vectors-0008.md` (v1) still decodes and encodes byte for byte.

### npm run check (last lines)

Final run, after the last script edit.

```
 Test Files  50 passed (50)
      Tests  408 passed (408)
   Start at  18:58:51
   Duration  3.73s (transform 1.99s, setup 871ms, import 8.49s, tests 9.39s, environment 2ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (126 files)
EXIT 0
```

### npm run smoke

```
✓ built in 207ms
SMOKE_OK
EXIT 0
```

### npm run e2e:meter

Final run, on the committed script: contract, selector, decimals and price come from pcdmeter's hint (no Meter constant anywhere).

```

SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connected
people best block #7053480
ASSET_HUB 0xd6eec261… account 5H4Lootcg7w7A4xgsPFDabSiEqFUTpdykagVckcwcx6kyQYW free 27.9692 PAS
FOUND pcdfaucet.77 0xe018148187403b5980aa5d91d38e108af1aadcb91ce5bc47f104ef04554e680f
DRIP_SENT via=request to=pcdfaucet.77 (/drip 15zdx99gXuCabbyCq2JDikGs6TF8A8C7q5Qyn3cJB38H9sMf)
DRIP_OK status=inBlock block=13621733 note="Dripped 1 PAS" hash=0x9ff65c660c0c3f044a820de38640fbfbea9d01ab60f934738d50551193ca992f at=11.7s
FOUND pcdmeter.01 0x9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967
REQUEST_SENT pcdmeter
ACCEPTED pcdmeter at=52.1s
HINT label="with Meter" contract=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 selector=0x70a08231 decimals=18 unit=PAS perReply=100000000000000000 chain=0xd6eec261…
BALANCE_BEFORE with Meter: 2.9 PAS (~29 replies)
SENT /topup
BUTTON "Top up 1 PAS" text="Add 1 PAS to your balance. Each reply costs 0.1 PAS." intent: Top up 1 PAS; calls=1 kind=1 to=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 value=10000000000
DRYRUN ok=true fee=0.0014 PAS (14510503 planck) mapsAccount=false value=10000000000
SIGNED hash=0x8a170d0683ab5ef6e0bba10435600760c6aa304a1d8d02a3aa3372c6e787a4d9 at=60.5s
TOPUP_OK status=inBlock block=13621759 row="Top up (1 PAS)" at=64.5s
BALANCE with Meter: 3.9 PAS (~39 replies) (3900000000000000000 PAS units; before with Meter: 2.9 PAS (~29 replies))
ANSWER 1 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate, 
BALANCE with Meter: 3.8 PAS (~38 replies) (-0.1 PAS) reference="balance: 38000000000" inBlock at=72.3s
ANSWER 2 A parachain is an independent blockchain that runs on the Polkadot network, sharing security with other parach
BALANCE with Meter: 3.7 PAS (~37 replies) (-0.1 PAS) reference="balance: 37000000000" inBlock at=80.9s
ANSWER 3 Asset Hub is a Polkadot parachain that provides a common platform for creating, managing, and trading custom a
BALANCE with Meter: 3.6 PAS (~36 replies) (-0.1 PAS) reference="balance: 36000000000" inBlock at=88.2s
METERED_OK 3 answers charged: 3.9 → 3.6 PAS
TOPUP_REFERENCE inBlock (finality is shown when it comes; nothing waited for it)
METER_OK
EXIT 0
```

Notes: two earlier runs of this milestone also ended `METER_OK` (18:39 and 18:57); in both the third BALANCE line named the previous charge's reference, because the script took a reference already in the window. It now waits for the reference whose `balance:` equals the value read from the chain (above: 38, 37, 36 × 10^9 planck, each matching). The first run (18:27) ended `NO_BALANCE_HINT botInfo=null` (exit 1): pcdmeter was not yet restarted with the hint.

### npm run e2e:flip

```

[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 h160=0x469a4447be834da00d85582ce51c33fb132a553b
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b h160=0xe3b96e51d6f5a5d1e8c56998e88657ae382bafd8
[a] ASSET_HUB account 5H4Lootcg7w7A4xgsPFDabSiEqFUTpdykagVckcwcx6kyQYW free 25.9863 PAS
[b] ASSET_HUB account 5FBqEq8YU9CnopdeYycmYobNs8fAJZWoZudXUnz7Fu9YyfFE free 26 PAS
[a] FOUND pcdfaucet.77
[b] FOUND pcdfaucet.77
[a] DRIP_SENT via=request to=pcdfaucet.77 attempt=1
[b] DRIP_SENT via=request to=pcdfaucet.77 attempt=1
[a] DRIP_OK status=inBlock block=13621120 note="Dripped 1 PAS"
[a] FOUND pcdflip.44
[a] REQUEST_SENT pcdflip
[a] ACCEPTED pcdflip.44
[a] HINT label="your stake" contract=0x68b113b3ad6abbe9177997ea4645313c72656b58 selector=0x42623360 decimals=18 unit=PAS
[a] READY username=pcdecejakd.11 h160=0x469a4447be834da00d85582ce51c33fb132a553b pending=0x0000000000000000000000000000000000000000 hint="your stake: 0 PAS"
[b] DRIP_REFUSED The transfer did not go through. Please try again later.
[b] DRIP_SENT via=message to=pcdfaucet.77 attempt=2
[b] DRIP_OK status=inBlock block=13621144 note="Dripped 1 PAS"
[b] FOUND pcdflip.44
[b] REQUEST_SENT pcdflip
[b] ACCEPTED pcdflip.44
[b] HINT label="your stake" contract=0x68b113b3ad6abbe9177997ea4645313c72656b58 selector=0x42623360 decimals=18 unit=PAS
[b] READY username=pcdeceb.89 h160=0xe3b96e51d6f5a5d1e8c56998e88657ae382bafd8 pending=0x0000000000000000000000000000000000000000 hint="your stake: 0 PAS"
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 pending=0x0000000000000000000000000000000000000000 at=60.6s
[a] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.0017 PAS mapsAccount=false
[a] SIGNED hash=0x7e563ad7e2c1bfb4c327aec2ded0ae7aff00bea2333871ce6a80e95b57b475ce
[a] STAKED a hash=0x7e563ad7e2c1bfb4c327aec2ded0ae7aff00bea2333871ce6a80e95b57b475ce block=13621148 free_before=26.9863 PAS
STAKED a hash=0x7e563ad7e2c1bfb4c327aec2ded0ae7aff00bea2333871ce6a80e95b57b475ce
[a] HINT_VALUE your stake: 0.5 PAS
[b] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.002 PAS mapsAccount=false
[b] SIGNED hash=0x1077a9864b129e0b958ae98970e38fa2458380fdc6b5674af305db9bd8fc78b2
[b] STAKED b hash=0x1077a9864b129e0b958ae98970e38fa2458380fdc6b5674af305db9bd8fc78b2 block=13621151 free_before=27 PAS
STAKED b hash=0x1077a9864b129e0b958ae98970e38fa2458380fdc6b5674af305db9bd8fc78b2 (settles the round)
[b] HINT_VALUE your stake: 0 PAS
[a] SETTLED winner=pcdecejakd.11 payout=1 PAS
[a] HINT_VALUE your stake: 0 PAS
[b] SETTLED winner=pcdecejakd.11 payout=1 PAS
[a] BALANCE_WIN before=26.9863 PAS after=27.4794 PAS delta=0.493 PAS expected=(0.4, 0.5] ok=yes
[b] HINT_VALUE your stake: 0 PAS
[b] BALANCE_LOSE before=27 PAS after=26.4981 PAS delta=-0.5018 PAS
SETTLED winner=pcdecejakd.11 payout=1 PAS
WINNER a pcdecejakd.11: BALANCE_WIN before=26.9863 PAS after=27.4794 PAS delta=0.493 PAS expected=(0.4, 0.5] ok=yes
[b] EXIT
[a] EXIT
FLIP_OK at=73.5s
EXIT 0
```

Notes: this is the second run. The first run (flip-1) ended `CHILD_FAILED a exit=1 last="DRIP_REFUSED The transfer did not go through. Please try again later."`: both people asked the faucet bot in the same second and one transfer failed. The script now asks again after a pause (visible above as attempt=2 for b). The `[ws]` status lines of the children are not in this log (none printed). The winner's balance rose 0.493 PAS (1 PAS pot − 0.5 PAS stake − 0.0017 PAS fee − rounding of the 4-decimal display); the loser's fell 0.5018 PAS.

### PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdbenchqmwk npm run screenshots

M11b lines of the run (the full log lists all 46 PNGs and ends `SCREENSHOTS_OK`):

```
92.2s header: "with Meter: 2.4 PAS (~24 replies)"
93.1s saved berlin-day/room-tx-done.png
93.1s chip: "27.4784 PAS"
93.6s pocket: "Asset Hub 27.4784 PAS | People chain 25 PAS | Copy | Get test funds"
94.4s saved berlin-day/pocket.png
99.2s flip strip: "Coin flip stake Stakes 0.5 PAS in a coin flip. The second staker triggers the flip; the winner takes 1 PAS. Amount 0.5 PAS Fee ≈ 0.0017 PAS Signs as pcdecejakd.11 After this: your stake: 0.5 PAS Cancel Sign"
100.1s saved berlin-day/room-flip.png
103.9s stake: "Coin flip stake (0.5 PAS) · in block #13621612"
103.9s header: "your stake: 0.5 PAS"
119.0s second player stakes
125.3s settled: "Flip settled: pcdecejakd.11 won 1 PAS · in block #13621622"
126.2s saved berlin-day/room-flip-done.png
202.6s header: "with Meter: 2.4 PAS (~24 replies)"
203.4s saved berlin-night/room-tx-done.png
203.4s chip: "27.9706 PAS"
204.0s pocket: "Asset Hub 27.9706 PAS | People chain 25 PAS | Copy | Get test funds"
204.8s saved berlin-night/pocket.png
206.1s flip strip: "Coin flip stake Stakes 0.5 PAS in a coin flip. The second staker triggers the flip; the winner takes 1 PAS. Amount 0.5 PAS Fee ≈ 0.0017 PAS Signs as pcdecejakd.11 After this: your stake: 0.5 PAS Cancel Sign"
206.9s saved berlin-night/room-flip.png
206.9s settled: "Flip settled: pcdecejakd.11 won 1 PAS · in block #13621622"
207.8s saved berlin-night/room-flip-done.png
  .agent-runs/screens/berlin-night/keyboard.png
SCREENSHOTS_OK
EXIT 0
```

I read the PNGs. `pocket.png` (both themes): the Pocket in the right pane, flat: Balances (Asset Hub 27.4784 PAS, People chain 25 PAS, amounts in mono), the address in mono with its QR code, Copy and Get test funds; the footer chip "27.4784 PAS" in mono. `room-flip.png`: pcdflip.44 with the bot badge, the header "your stake: 0 PAS · A two-player coin flip…", the Stake 0.5 PAS tx button and the strip under it (Amount 0.5 PAS, Fee ≈ 0.0017 PAS, Signs as pcdecejakd.11, "After this: your stake: 0.5 PAS", Cancel, Sign). `room-flip-done.png`: our reference "Coin flip stake (0.5 PAS) · in block #13621612" (finalized with the double tick in the night shot), the bot's "Flip settled: pcdecejakd.11 won 1 PAS · in block #13621622", and the chip up to 27.9715 PAS. `room-tx-done.png` now shows "with Meter: 2.4 PAS (~24 replies)" from the room peer's hint. Known flaw: with the chip in the footer, the username is cut to "pcdec…" (see the hand-off).

Earlier attempts: two runs with `PCD_SCREENSHOT_ROOM_WITH=pcdtestjaia` missed `room.png` and every later room-peer shot ("no message from pcdtestjaia.98"; the peer's log ends `E2E_TIMEOUT accept`). I stopped both. The likely cause is an older request from the same peer that the script accepts instead of the new one; `pcdbenchqmwk` (no old requests) worked at once.

### git status --short

This file is part of the commit, so the result of `git status --short` after it is in the M11b hand-off report.

## M12

Run 2026-09-23 on this machine, headless, devnet. pcdguide.70 ran the group-aware pca code (pca `3c5cde2`, restarted by the pca agent; I did not start or stop bots). Vectors: `docs/spec/vectors-0009.md` (pca) — all three (groupInfo GRP-1, 176 bytes; groupMessage GRM-1, 46 bytes; groupLeave GRL-1, 23 bytes) decode to the pinned values and the values encode to the same bytes (`content.spec.ts`, "vectors-0009" specs).

### npm run check (last lines)

```
 Test Files  53 passed (53)
      Tests  442 passed (442)
   Start at  19:44:35
   Duration  3.76s (transform 1.97s, setup 850ms, import 9.23s, tests 10.81s, environment 3ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (131 files)
EXIT 0
```

### npm run smoke

```
✓ built in 184ms
SMOKE_OK
EXIT 0
```

### npm run e2e:group

Final run, on the committed code. No `[a:err]`/`[b:err]` lines were printed.

```
> polkadot-chat-desktop@0.1.0 e2e:group
> node scripts/e2e-group.mjs
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b
[a] READY username=pcdecejakd.11
[b] READY username=pcdeceb.89
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 bot=pcdguide.70 at=2.5s
[a] REQUEST_SENT id=843e390a-0282-4dce-9a50-967a45b2e79d to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11 id=843e390a-0282-4dce-9a50-967a45b2e79d
[a] CONTACT pcdeceb.89 devices=1
CONTACTS_OK pcdecejakd.11 ↔ pcdeceb.89 at=7.1s
[b] BOT_CONTACT pcdguide.70 0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06
[a] BOT_CONTACT pcdguide.70 0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06
[a] GROUP_CREATED id=bd0562e5-bc6c-446e-afb0-d86a7af149de version=1 members=pcdecejakd.11,pcdeceb.89,pcdguide.70 invites=0
[b] JOINED id=bd0562e5-bc6c-446e-afb0-d86a7af149de version=1 members=pcdecejakd.11,pcdeceb.89,pcdguide.70 admin=0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
GROUP_JOINED b version=1 members=pcdecejakd.11,pcdeceb.89,pcdguide.70 at=11.1s
[a] SENT id=822a798d-8601-469b-aa50-b5e61c42b685 at=1790207459726 status=sent
[b] GOT id=822a798d-8601-469b-aa50-b5e61c42b685 sender=0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 text="hello all"
FANOUT_OK b got id=822a798d-8601-469b-aa50-b5e61c42b685 from a (copies went to b and pcdguide.70) at=12.1s
[b] BOT_REPLY id=E0BF3673-2EF0-439D-BDA1-27F4E7E3035F type=text text="Hello pcdecejakd.11! 👋 Welcome to the group. I'm **pcdguide**, your friendly Polkadot support guide. I'm here"
[a] BOT_REPLY id=E0BF3673-2EF0-439D-BDA1-27F4E7E3035F type=text text="Hello pcdecejakd.11! 👋 Welcome to the group. I'm **pcdguide**, your friendly Polkadot support guide. I'm here"
BOT_REPLY_OK id=E0BF3673-2EF0-439D-BDA1-27F4E7E3035F (the same envelope on a and b) at=17.2s
[a] ROSTER_SENT version=2 members=pcdecejakd.11,pcdguide.70
[b] REMOVED version=2 self=removed
ROSTER_OK b removed at version=2 self=removed at=18.2s
[b] EXIT
[a] EXIT
GROUP_OK at=18.2s
EXIT 0
```

Notes: the first run (before pca restarted pcdguide.70 on group code) reached GROUP_JOINED, FANOUT_OK and ROSTER_OK and ended `E2E_TIMEOUT bot reply (a=no b=no): the bot may not run group-aware code yet` → `GROUP_INCOMPLETE 1 step(s) timed out`, exit 13. The second run, after the restart, ended `GROUP_OK at=20.8s` (exit 0). The run above is the third, after the last code change.

### npm run screenshots

Command: `PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdbenchcold npm run screenshots` (headless). 51 PNGs saved. M12 lines and the end of the log:

```
97.0s saved berlin-day/room-tx-done.png
103.7s contact with pcdbenchfina.25
107.2s contact with pcdguide.70
108.1s saved berlin-day/group-create.png
109.3s member joined: JOINED id=7fcacd8c-3d61-4181-8aea-bfd89584d1e6 version=1 members=pcdecejakd.11,pcdbenchfina.25,pcdguide.70 admin=0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
115.6s group senders: ["pcdbenchfina.25","pcdguide.70"]
115.6s group header: "3 members · admin pcdecejakd.11"
116.5s saved berlin-day/room-group.png
116.5s members: ["P pcdecejakd.11 you · admin · member","P pcdbenchfina.25 member Remove","P pcdguide.70 member Remove"]
117.6s saved berlin-day/group-members.png
167.7s saved berlin-day/chats.png
186.2s faucet room: "ee test tokens (PAS) to try payments and contracts on the test network. They have no value. What do you need? Get 1 PAS Get test funds Copy my address 07:45 PM Dripped 1 PAS from //Alice · in block #13623127 07:47 PM Balance now 29.4586 PAS"
187.0s saved berlin-day/faucet.png
294.6s missed berlin-night/room-tx-done.png: the transaction did not reach a block: Send to yourself (0.01 PAS) · submitted
296.8s saved berlin-night/group-create.png
297.1s group senders: ["pcdbenchfina.25","pcdguide.70"]
297.1s group header: "3 members · admin pcdecejakd.11"
298.0s saved berlin-night/room-group.png
298.0s members: ["P pcdecejakd.11 you · admin · member","P pcdbenchfina.25 member Remove","P pcdguide.70 member Remove"]
299.1s saved berlin-night/group-members.png
305.6s saved berlin-night/chats.png
317.8s saved berlin-night/faucet.png
Not captured:
  berlin-night/room-tx-done.png (the transaction did not reach a block: Send to yourself (0.01 PAS) · submitted)
SCREENSHOTS_PARTIAL
EXIT 1
```

Result: **SCREENSHOTS_PARTIAL** (exit 1). One shot was not captured: `berlin-night/room-tx-done.png` (M11): the room peer's 0.01 PAS self-transfer stayed "submitted" for 90 s. The same flow in the day theme of the same run reached a block in 1.5 s and was finalized (`in block #13623096`), so I read it as a slow chain or transaction pool, not an M12 regression; not proved. Every M12 PNG was captured in both themes.

An earlier screenshot run with `PCD_SCREENSHOT_ROOM_WITH=pcdbenchqmwk` missed every room-peer shot (the peer's log ends `E2E_TIMEOUT accept`, the old-request problem of M11b); I stopped it. `pcdbenchcold` had no old requests and worked.

I read the PNGs:
- `group-create.png` (both): "+" panel with the New group row (selected), the New group view: name "Weekend crew", three contact checkbox rows with pcdbenchfina.25 and pcdguide.70 checked, the Create pill; header "3 members".
- `room-group.png` (both): header "Weekend crew · 3 members · admin pcdecejakd.11" with the Members and Mute buttons; "You created Weekend crew"; own "hello all" (delivered); pcdbenchfina.25's message with its name above; pcdguide.70's reply with its name and its keyboard (Staking, Governance, Colour of the day, Docs). Three senders.
- `group-members.png` (both): the members side panel (no modal): pcdecejakd.11 "you · admin · member", pcdbenchfina.25 with Remove shown on the hovered row, pcdguide.70 with the bot badge; the Add member field; Leave group as a Danger button at rounded-medium.
- `faucet.png` (day): the embedded Faucet after "Get 1 PAS": the reference "Dripped 1 PAS from //Alice · in block #13623127" and "Balance now 29.4586 PAS" (the pending row is transient and is not in the shot; the script checked it and the busy button before the answer). The "Get test funds" confirm strip is open, as in M10.
- `chats.png` (both): the footer account block: "YOU" caption with Settings on the right, 28 px avatar, "pcdecejakd.11" in full with "Connected" beside it, the balance chip on its own line; the group row "Weekend crew" with the Users avatar and "pcdguide.70: …".

### Other checks run

- In-app devnet drip through the main module (`.agent-runs/m12/drip-check.mjs`, to pcdeceb.89): `STATUS submitted`, `BROADCAST hash=0xa7cc3ec67cb09c846a33ec1ccf7a511f631873b9dcc505a993c9fcdc86af6dc5 from=//Alice`, `STATUS inBlock block=13622982`.

### Not run

- `npm run e2e:meter` and `npm run e2e:flip` were not rerun. Their faucet step now loads `scripts/lib/faucet-bot.ts` (the moved `drip.ts`, same code) instead of the renderer file. The screenshot run's flip helper (`e2e-flip.mjs --role b`) did run with the moved file and reached READY and STAKE ("second player stakes", "Flip settled: pcdeceb.89 won 1 PAS").

### git status --short

This file is part of the commit, so the result is in the M12 hand-off report.

## M12c (2026-09-23)

All commands ran on this machine against devnet (People and Asset Hub Paseo) with the live pca bots. Headless: the Node e2e scripts use no Electron; `npm run smoke` and `npm run screenshots` ran with `PCD_HEADLESS=1` and throwaway `PCD_USER_DATA_DIR` profiles.

### npm run check

```
 Test Files  57 passed (57)
      Tests  469 passed (469)
   Start at  21:08:13
   Duration  16.45s (transform 2.28s, setup 986ms, import 9.41s, tests 24.96s, environment 3ms)

> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (137 files)
```

New or changed specs that encode the budget: `manager.messaging.spec.ts` "submission budget (M12c)" (the store sees 1 request for "read, then reply within 5 s" and 1 for "read, no reply" only after 5 s; a known bot shows local working with no extra submission), `submissions.spec.ts` (two requests in one task → one statement; acknowledgements apart), `signals.spec.ts` (1 s start, 10 s refresh, 12 s until, 5 s seen window, local working), `transactions.spec.ts` (one reference per tx; status 0 only after 30 s; never status 2), `txTracker.spec.ts` (finalized only when the finalized block N holds the extrinsic; the M12 drip's real extrinsic hashes to its known hash), `messages.spec.ts` (`setReferenceState`, forward only), `lookup.spec.ts` (one retry after 5 s on a timeout only), `explorers.spec.ts`, `copyFlag.spec.ts` (Copied resets after 1.5 s).

### npm run smoke

```
✓ built in 197ms
SMOKE_OK
```

### npm run e2e:typing

```
identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7055083 (runtime ready in 1.9s)
PEER 0x66b78abdcb4c89d2817ce45f201677c08240fde23c50b9c94a6abb6912888a63 key_type=0
PREFS sendTyping=false readReceipts=true (a fresh profile: the defaults)
REQUEST_SENT attempt=1
ACCEPTED devices=1
BOTINFO name="Captain Dot" version=1
WORKING_LOCAL at=0.0s state={"kind":"working","until":1790209654373,"local":true}
QUESTION_SENT cea9943c-cfce-4567-a0af-a08f4b5f7105 QUESTION_SUBMISSIONS 1
REPLY at=6.6s What do ye call a pirate who stacks blocks all day, ye ask? A real blockbuster, har har! 🏴‍☠️
WORKING_CLEARED at=6.6s state=null
SEEN_RECEIVED upTo=cea9943c-cfce-4567-a0af-a08f4b5f7105 at=6.6s
READ_SUBMISSIONS 1 (inside the 5 s window: 0)
COUNTS submissions=2 messages=1 acknowledgements=2 (this round)
DIAGNOSTICS submissions=3 messages=1 acknowledgements=4 (whole run: request and accept included)
BUDGET_OK
```

The bot sent no `typing` (no TYPING_RECEIVED line) and its `seen` arrived with its reply at 6.6 s: the new pca behaviour. The older-bot path (a received `typing` beside the local state) is covered by `signals.spec.ts`, not by this run.

### npm run e2e:meter

```
DRIP_OK status=inBlock block=13624276 note="Dripped 1 PAS" hash=0x53ab6b28db19c81304375f5c790d14311a259c36c0e070c07a8111955b6e70d8 at=10.4s
FOUND pcdmeter.01 0x9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967
ACCEPTED pcdmeter at=13.5s
HINT label="with Meter" contract=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 selector=0x70a08231 decimals=18 unit=PAS perReply=100000000000000000 chain=0xd6eec261…
BALANCE_BEFORE with Meter: 4.2 PAS (~42 replies)
DRYRUN ok=true fee=0.0014 PAS (14510503 planck) mapsAccount=false value=10000000000
SIGNED hash=0xffcd07296957f95b000c990f13c7a395e4411fa833a42b36768f202f7fd060e0 at=20.1s
TOPUP_OK status=inBlock block=13624282 row="Top up (1 PAS)" at=22.1s
BALANCE with Meter: 5.2 PAS (~52 replies) (5200000000000000000 PAS units; before with Meter: 4.2 PAS (~42 replies))
ANSWER 1 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate,
BALANCE with Meter: 5.2 PAS (~52 replies) (no charge yet: pending in the bot's batch) at=53.4s
ANSWER 2 A parachain is an independent blockchain that runs on the Polkadot network, sharing security with other parach
BALANCE with Meter: 5.2 PAS (~52 replies) (no charge yet: pending in the bot's batch) at=83.0s
ANSWER 3 Asset Hub is a Polkadot parachain that provides a common platform for creating, managing, and trading custom a
BALANCE with Meter: 5.2 PAS (~52 replies) (no charge yet: pending in the bot's batch) at=112.7s
ANSWER 4 A smart contract is a self-executing program stored on a blockchain that automatically enforces agreements and
BALANCE with Meter: 4.7 PAS (~47 replies) (-0.5 PAS) reference="balance: 47000000000" inBlock at=121.2s
ANSWER 5 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate,
BALANCE with Meter: 4.7 PAS (~47 replies) (no charge yet: pending in the bot's batch) at=151.9s
CHARGE_REFERENCES 1 (inBlock)
METERED_OK 5 answers, 1 charge(s): 5.2 → 4.7 PAS
TOPUP_REFERENCE finalized
METER_OK
exit=0
```

The batched meter: one charge of 5 replies (0.5 PAS) after the 4th answer (one reply was pending from an earlier run), one reference with status 1 only. The drip reference also came as status 1.

### npm run e2e:flip

First run: `FLIP_OK at=33.0s` (exit 0; a staked, b settled, winner b, `BALANCE_WIN … delta=0.4981 PAS ok=yes`). The second screenshot run (below) then left a stake of the app's identity pending in the contract. The next `e2e:flip` settled it through its "waiting from an earlier run" path but failed its balance check (`FLIP_BAD_BALANCE BALANCE_WIN before=33.4268 PAS after=33.4268 PAS delta=0`: for a stake from an earlier run, a's "before" balance is read after the payout; a script path from M11b, not the reference change). The run after that, from a clean contract:

```
STAKED a hash=0xe26f6d81d34e0ca6a83d42c2ce723e40ac875e1b381be87dc2856a57c5a98b61
STAKED b hash=0xd5b506850acf0df8cae7bdbeb03330777ea22dca57056fbc078935951c72b02b (settles the round)
SETTLED winner=pcdeceb.89 payout=1 PAS
WINNER b pcdeceb.89: BALANCE_WIN before=38.4867 PAS after=38.9848 PAS delta=0.4981 PAS expected=(0.4, 0.5] ok=yes
FLIP_OK at=33.2s
exit=0
```

### npm run probe:statements

pcdecejakd.11 → pcdeceb.89 on devnet People, 20 s per rate, 30 s drain after each. Propagation = time the receiver stored the row − the message's own timestamp (same machine).

```
[a] REQUEST_SENT id=b301eaa7-52ef-41a5-be7d-714468709a57 to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11 id=b301eaa7-52ef-41a5-be7d-714468709a57
[a] CONTACT pcdeceb.89 devices=1
BURST rate=0.5/s for 20 s at=10.5s
[a] SENT rate=0.5 messages=10 statements=10 took=18510ms errors=""
[b] RECEIVED rate=0.5 count=10 p50=330 p95=902 max=902
BURST rate=1/s for 20 s at=59.0s
[a] SENT rate=1 messages=20 statements=20 took=19508ms errors=""
[b] RECEIVED rate=1 count=20 p50=327 p95=358 max=360
BURST rate=2/s for 20 s at=108.5s
[a] SENT rate=2 messages=40 statements=40 took=20008ms errors=""
[b] RECEIVED rate=2 count=40 p50=323 p95=371 max=435
BURST rate=4/s for 20 s at=158.5s
[a] SENT rate=4 messages=80 statements=80 took=20258ms errors=""
[b] RECEIVED rate=4 count=80 p50=328 p95=368 max=373
PROBE_DONE at=210.3s
exit=0
```

| rate (msg/s) | messages sent | statements submitted | received | p50 ms | p95 ms | max ms | submit errors |
|---|---|---|---|---|---|---|---|
| 0.5 | 10 | 10 | 10 | 330 | 902 | 902 | none |
| 1 | 20 | 20 | 20 | 327 | 358 | 360 | none |
| 2 | 40 | 40 | 40 | 323 | 371 | 435 | none |
| 4 | 80 | 80 | 80 | 328 | 368 | 373 | none |

Reading: one person at up to 4 statements per second met no rejection and no slowdown (p50 about 330 ms at every rate; the 902 ms at 0.5/s is the first message after the chat opened). The ceiling is above 4 per second for one sender; this probe did not find it. Each statement carried the un-ACKed batch, so at 4/s a statement held several messages.

### Other checks run

- Reference finality from the chain (`.agent-runs/m12c/track-check.mjs`: the main tracker against live Asset Hub, no signing): the M12 drip claimed at block 13622982 → `EVENT finalized block=13622982` at 0.6 s; a wrong hash claimed at the same block → no event; a status-0 hash (an extrinsic of the newest best block) → `EVENT inBlock block=13624232` at 7.8 s, then `EVENT finalized block=13624232` at 22.6 s; `TRACK_OK`. (The target was taken from best block 13624233 and found in 13624232: the search reads the best chain oldest first, and that extrinsic's bytes were in both.)
- `npm run screenshots` (`PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdbenchcold`), first run: **SCREENSHOTS_OK**. M12c lines:

```
96.8s finalized: "Send to yourself (0.01 PAS) · finalized in block #13624400\n\n0xd738…1a48\nCopy hash\nView on Subscan"
96.8s actions: "0xd738…1a48 Copy hash View on Subscan"
183.4s diagnostics: "Submissions per message 2.00 (2 / 1) Delivery acknowledgements (not counted above) 3"
288.9s finalized: "Send to yourself (0.01 PAS) · finalized in block #13624496\n\n0x3458…fca9\nCopy hash\nView on Subscan"
288.9s actions: "0x3458…fca9 Copy hash View on Subscan"
318.2s diagnostics: "Submissions per message — (0 / 0) Delivery acknowledgements (not counted above) 4"
SCREENSHOTS_OK
```

  I read the PNGs: `room-tx-done.png` (day and night) shows the own reference "Send to yourself (0.01 PAS) · finalized in block #…" with the action row under it: the short hash in mono (`0xd738…1a48`), "Copy hash" and "View on Subscan" as quiet ghost buttons in the bubble's secondary colour; finality came from the chain, not from a message. `settings.png` (both) shows the Chat section with "Send typing indicators" off and its caption "Costs one network submission every 10 s while you type", and "Block explorer: Subscan" with its caption. The room list in the day `settings-diagnostics.png` shows "working…" on the bot row after a message to it (the local state). The counts are per window load: the theme switch reloads the page, so the night figures start again at zero.
- A second screenshot run, made only to frame `settings-diagnostics.png` on the Diagnostics section, was **SCREENSHOTS_PARTIAL**: the room peer `pcdbenchcold` timed out on its accept (`E2E_TIMEOUT accept`, the old-request problem noted in M12), so every room-peer shot and the night flip shots were missed; its PNGs did not replace the first run's. `settings-diagnostics.png` (night) from it shows the Diagnostics section: "Submissions per message — (0 / 0)", "Delivery acknowledgements (not counted above) 1", and the caption (since changed from "Since the app started" to "Since this window loaded", which is what the counter measures).

### Not run

- The older-bot behaviour (a bot that still sends `typing` and a separate `seen`) was not run live: the running pca bots already had the new behaviour. `e2e:typing` accepts it (it logs `TYPING_RECEIVED` and requires only the local state and one `seen`), and `signals.spec.ts` covers the one-line rule.
- The bot-down retry of `e2e:typing` (`BOT_DOWN_RETRY`) did not trigger: the bot answered at the first try.

### git status --short

This file is part of the commit, so the result is in the M12c hand-off report.

## M12d (2026-09-24)

All commands ran on this machine. Headless: `npm run smoke` and `scripts/measure-stream.mjs` ran with `PCD_HEADLESS=1` and throwaway `PCD_USER_DATA_DIR` profiles; the Node e2e scripts use no Electron. `e2e:typing` ran against the live pca bot (not started, stopped or changed).

### npm run check

```
 Test Files  59 passed (59)
      Tests  480 passed (480)
   Start at  21:38:54
   Duration  16.43s (transform 2.16s, setup 912ms, import 9.71s, tests 34.00s, environment 3ms)

> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (142 files)
```

Specs that encode the fix (each fails on the old code; checked by running them with the old renderer files):

- `MessageFlow.spec.tsx` "re-renders only the streaming bubble on a delta, also when the text is written to Dexie": 10 deltas, one `act` each, then 700 ms (past a Dexie write), in a room of 60.
- `MessageFlow.spec.tsx` "completes a reply that ends in a buttons block without typing it again or re-creating it": the painted text right after completion is the whole streamed text, and the markdown element and the keyboard element are the same objects.
- `MessageFlow.spec.tsx` "completes with a closing text that starts with what streamed by appending only".
- `MessageFlow.spec.tsx` "a bot's live frame replaced by its answer": revealed from its start, once (step 5).
- `reveal.spec.ts` `revealStart`, `stableProps.spec.ts`, and `assistant.spec.ts` "keeps the streaming text in memory at once and writes Dexie at most every 500 ms".

### Render counts (MessageFlow.spec.tsx, 10 deltas, room of 60 + question + reply)

| | renders of other bubbles | renders of the streaming bubble |
|---|---|---|
| before | 610 (61 per delta) | 20 |
| after | 0 | 21 (2 per delta: the reveal's state-from-render pass, plus the Dexie write) |

Before, from the spec run on the old renderer files: `AssertionError: 610 renders of other bubbles for 10 deltas`.

### Long tasks: node scripts/measure-stream.mjs

A 1398-character markdown reply (list, code block, closing ```buttons block) in 280 deltas at 50 per second from a local fake proxy, into the Assistant room holding 60 messages; window from Send to 2.5 s after the stream ended. `--cpu-throttle N` is CDP `Emulation.setCPUThrottlingRate`. Before = the renderer files of f7b2e8c (stashed), same script.

```
== BEFORE
STREAM 280 deltas in 5.9 s, 1398 chars, room of 60, CPU throttle 1x
LONG_TASKS 0 (total 0 ms, max 0 ms)
SLOW_FRAMES 0 of 1055 (max gap 25 ms)
SHRINKS 1 (largest 1190 chars)
STREAM 280 deltas in 5.8 s, 1398 chars, room of 60, CPU throttle 4x
LONG_TASKS 5 (total 316 ms, max 67 ms)
SLOW_FRAMES 7 of 636 (max gap 68 ms)
SHRINKS 1 (largest 1190 chars)
STREAM 280 deltas in 5.8 s, 1398 chars, room of 60, CPU throttle 6x
LONG_TASKS 68 (total 4275 ms, max 106 ms)
SLOW_FRAMES 74 of 534 (max gap 107 ms)
SHRINKS 1 (largest 1190 chars)
== AFTER
STREAM 280 deltas in 5.9 s, 1398 chars, room of 60, CPU throttle 1x
LONG_TASKS 0 (total 0 ms, max 0 ms)
SLOW_FRAMES 0 of 1053 (max gap 9 ms)
SHRINKS 0 (largest 0 chars)
KEYBOARD shown
STREAM 280 deltas in 5.8 s, 1398 chars, room of 60, CPU throttle 4x
LONG_TASKS 0 (total 0 ms, max 0 ms)
SLOW_FRAMES 0 of 1037 (max gap 17 ms)
SHRINKS 0 (largest 0 chars)
KEYBOARD shown
STREAM 280 deltas in 5.8 s, 1398 chars, room of 60, CPU throttle 6x
LONG_TASKS 0 (total 0 ms, max 0 ms)
SLOW_FRAMES 0 of 1043 (max gap 25 ms)
SHRINKS 0 (largest 0 chars)
KEYBOARD shown
```

`SHRINKS 1 (largest 1190 chars)` before is the second reveal: at completion the painted reply fell back to its first 40 characters. An earlier 4x run of the old code gave 12 long tasks (703 ms, max 77 ms); the counts vary between runs, the zero after does not (three runs at 4x and 6x). The window was visible to the page (`document.visibilityState` "visible"), so the typing reveal ran.

### npm run smoke

```
✓ built in 181ms
SMOKE_OK
```

### npm run e2e:assistant

```
proxy https://llm.substrate.dev model auto/deepseek-v4.1-flash
prompt: Reply with exactly: proxy ok
reply: proxy ok
deltas 1, 8 chars
ASSISTANT_OK
```

This e2e drives the main-process proxy client only; the renderer's stream path is covered by the specs and `measure-stream.mjs` above.

### npm run e2e:typing

The tail (repeated `[identity] lookup timed out … asking once more in 5 s` lines before the accept are cut):

```
[ws] disconnected
[ws] connecting
[ws] connected
[chat] connection restored, rebuilding sessions
ACCEPTED devices=1
BOTINFO name="Captain Dot" version=1
WORKING_LOCAL at=0.0s state={"kind":"working","until":1790214103041,"local":true}
QUESTION_SENT 99febd5a-e6f2-4a2d-8395-9fac8b5a79a7 QUESTION_SUBMISSIONS 1
SEEN_RECEIVED upTo=99febd5a-e6f2-4a2d-8395-9fac8b5a79a7 at=7.3s (before the reply)
REPLY at=8.3s What do ye call a pirate's collection of building blocks? A treasure trove of squares, ye scurvy dog
WORKING_CLEARED at=8.3s state=null
READ_SUBMISSIONS 1 (inside the 5 s window: 1)
COUNTS submissions=2 messages=1 acknowledgements=3 (this round)
DIAGNOSTICS submissions=3 messages=1 acknowledgements=4 (whole run: request and accept included)
BUDGET_OK
```

This milestone did not change the chat manager; the run confirms the budget is unchanged. The line "inside the 5 s window: 1" differs from the M12c run (0); the script still passed, and it is noted here, not investigated (outside this milestone).

### git status --short

This file is part of the commit, so the result is in the M12d hand-off report.

## M12e (2026-09-24)

All commands ran on this machine. `npm run screenshots` and the acceptance `npm run smoke` ran headless (`PCD_HEADLESS=1`) on throwaway `PCD_USER_DATA_DIR` profiles; the Node e2e scripts use no Electron. The pca bots were not started, stopped or changed.

**Deviation, reported:** my first `npm run smoke` of this milestone ran without `PCD_HEADLESS` and `PCD_USER_DATA_DIR`, so Electron opened the dev profile `~/Library/Application Support/polkadot-chat-desktop` for about one second. It changed only Chromium housekeeping files there (`blob_storage`, `DIPS-wal`, `Session Storage`, time stamps 22:11); `identity.json` and the IndexedDB folder were not written (their times stay 10:42 and 12:14). The smoke output below is the rerun with both variables set.

### npm run check

```
 Test Files  63 passed (63)
      Tests  515 passed (515)
   Start at  22:15:58
   Duration  16.39s (transform 2.20s, setup 912ms, import 10.52s, tests 34.62s, environment 3ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (149 files)
```

Specs that encode the milestone (each fails if its rule breaks):

- `ui/ChatList.spec.ts`: a delete hides the chat at once, keeps the rows during the 6 s, and after it the room and its messages are gone from Dexie (the contact stays; its next message brings the chat back); Undo inside the time brings the chat back with every message and the commit never runs; a message that arrived during the Undo time is kept; clear history keeps contact, room and place; pin order and the limit of 5; archive moves the chat to the section and its unread still counts; archive, pin and the unread mark survive a new message; a marked chat counts one in the badge; the nickname survives a contact refresh; "No answer yet · sent 3 d ago".
- `domain/chat/manager.management.spec.ts`: withdraw removes the row and nothing more is submitted (checked: with the channel left open the spec fails, `expected 3 to be 2`), a late accept makes no chat, also after a restart; a blocked peer's message makes no row and no unread, and arrives again after unblock; a blocked sender's request is not stored; a forward goes out as the plain `text` kind with the caption only on this device; delete keeps the contact and the next message brings the room back.
- `shared/buttonsBlock.spec.ts` "extractButtonsBlock (lenient, shared with pca)": the six pca cases of a0e0497, the owner's reply first (bare fence, flat array, tip line after; the strict parser returns null for it). `ui/streamingFence.spec.ts`: an open bare fence starting with `[` and an open `json` fence starting with `{` show placeholders and no JSON; the owner's reply shows its keyboard and streams the tip line. `domain/assistant/assistant.spec.ts`: `replyContent` of the owner's reply, and an invalid block stripped and logged.
- `main/diagnostics.spec.ts` and `submissions.spec.ts` "forwardCounts": the totals of two page loads add up; a malformed report changes nothing.
- `shared/explorers.spec.ts`: the caption is on Polkadot.js Apps only. `ui/searchSections.spec.ts`: a nickname and its username both find the contact. `domain/chat/chatActions.spec.ts`: a keyboard, `tx` button included, forwards as text only.
- `ui/MessageFlow.spec.tsx` (M12d render count) passes unchanged: 0 re-renders of other bubbles.

### npm run smoke (PCD_HEADLESS=1, throwaway PCD_USER_DATA_DIR)

```
✓ built in 192ms
SMOKE_OK
```

### npm run e2e:typing

The tail (the repeated identity lookup retries are cut):

```
PEER 0x66b78abdcb4c89d2817ce45f201677c08240fde23c50b9c94a6abb6912888a63 key_type=0
PREFS sendTyping=false readReceipts=true (a fresh profile: the defaults)
REQUEST_SENT attempt=1
ACCEPTED devices=1
BOTINFO name="Captain Dot" version=1
WORKING_LOCAL at=0.0s state={"kind":"working","until":1790215972376,"local":true}
QUESTION_SENT 1010ac6a-3551-46b6-8516-d9d0624be402 QUESTION_SUBMISSIONS 1
REPLY at=7.8s What's a pirate's favorite game with blocks? Tetra-treasure, where the pieces fall like booty from t
WORKING_CLEARED at=7.8s state=null
SEEN_RECEIVED upTo=1010ac6a-3551-46b6-8516-d9d0624be402 at=7.8s
READ_SUBMISSIONS 1 (inside the 5 s window: 0)
COUNTS submissions=2 messages=1 acknowledgements=1 (this round)
DIAGNOSTICS submissions=3 messages=1 acknowledgements=3 (whole run: request and accept included)
BUDGET_OK
```

The M12d carry: "inside the 5 s window" is 0 in this run (M12d printed 1 once).

### npm run e2e:chat

The bare command needs a peer and prints its usage (exit 2):

```
usage: npm run e2e:chat -- <peerUsername> [--profile devnet|paseo] [--identity <name>] [--delete] [--live-frame] [--buttons] [--botinfo] [--tx] [--seen] [--typing]
```

So it ran with the M2 peer, the echo bot: `npm run e2e:chat -- pcdpeer.47`

```
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7056513 (runtime ready in 1.9s)
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: ping cf8248
PING_SENT ping 2fa47a
REPLY Echo: ping 2fa47a
REPLY_HAS_NONCE yes
E2E_OK
```

### npm run screenshots -- --only chat-menu,archived,settings-privacy

With `PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json` (the flag is new in this milestone; about 12 s for both themes).

```
built
seeded pcdecejakd.11
assistant engine claude
row menu: "Pin Mark as read Mute Archive Clear history Block Delete chat"
saved berlin-day/chat-menu.png
list: "Polkadot Chat Assistant AI, in this app Faucet Now Test funds for devnet N noahgreen.34 3h Lunch on Friday? M Maya (design) mayablue.12 The new icons are in the shared folder. 2 S silentbot.21 Sep 20 No answer yet · sent 3 d ago Archived · 2 1 I ivyreed.56 Sep 21 Thanks, all sorted. L leoashby.78 Sep 19 See you at the meetup. 1 YOU P pcdecejakd.11 Connected … PAS"
saved berlin-day/archived.png
saved berlin-day/settings-privacy.png
row menu: "Pin Mark as read Mute Archive Clear history Block Delete chat"
saved berlin-night/chat-menu.png
list: "Polkadot Chat Assistant AI, in this app Faucet Now Test funds for devnet N noahgreen.34 3h Lunch on Friday? M Maya (design) mayablue.12 20m The new icons are in the shared folder. 2 S silentbot.21 Sep 20 No answer yet · sent 3 d ago Archived · 2 1 I ivyreed.56 Sep 21 Thanks, all sorted. L leoashby.78 Sep 19 See you at the meetup. 1 YOU P pcdecejakd.11 Connected … PAS"
saved berlin-night/archived.png
saved berlin-night/settings-privacy.png
seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/chat-menu.png
  .agent-runs/screens/berlin-day/archived.png
  .agent-runs/screens/berlin-day/settings-privacy.png
  .agent-runs/screens/berlin-night/chat-menu.png
  .agent-runs/screens/berlin-night/archived.png
  .agent-runs/screens/berlin-night/settings-privacy.png
SCREENSHOTS_OK
```

The room-level actions were also driven once in the real app with a scratch copy of the script (outside the repo, same fixture): the room menu (with "Edit nickname"), the nickname edited in place and shown with the username beside it, Forward (the submenu listed the three other chats; the copy showed "Forwarded from Maya B."; it failed to send only because the fixture contact has no device, and stayed with Retry), Block (header "Blocked", the bar with Unblock, the Undo toast), Clear history (messages hidden at once; after 6 s the room row had an empty preview and kept its pin), Delete (the room closed and left the list at once; after 6 s the room row was gone from IndexedDB) and Withdraw (the pending row left the list at once).

### git status --short

This file is part of the commit, so the result is in the M12e hand-off report.

## M12f (2026-09-24)

Every app launch below set `PCD_HEADLESS=1` and a throwaway `PCD_USER_DATA_DIR` (smoke: `mktemp -d`; screenshots: the script makes its own profiles and removes them).

### npm run check

```
 Test Files  63 passed (63)
      Tests  525 passed (525)
   Start at  22:42:23
   Duration  22.01s (transform 8.78s, setup 4.55s, import 43.52s, tests 55.41s, environment 5ms)
> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs
check:tokens: clean (149 files)
```

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=$(mktemp -d) npm run smoke

```
✓ built in 399ms
SMOKE_OK
```

### npm run e2e:meter

Run at 22:37 local against pcdmeter.01 (pid 3440, the v3 code; see decisions "When to run e2e:meter"). `[ws]` status lines left out.

```
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
people best block #7056925
ASSET_HUB 0xd6eec261… account 5H4Lootcg7w7A4xgsPFDabSiEqFUTpdykagVckcwcx6kyQYW free 33.9185 PAS
FOUND pcdfaucet.77 0xe018148187403b5980aa5d91d38e108af1aadcb91ce5bc47f104ef04554e680f
DRIP_SENT via=request to=pcdfaucet.77 (/drip 15zdx99gXuCabbyCq2JDikGs6TF8A8C7q5Qyn3cJB38H9sMf)
DRIP_OK status=inBlock block=13628050 note="Dripped 1 PAS" hash=0x4b09f1fb545ac87ab0628437b398f822577d840e2b838a1f827d6c51227c72c8 at=9.9s
FOUND pcdmeter.01 0x9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967
REQUEST_SENT pcdmeter
ACCEPTED pcdmeter at=12.2s
HINT label="with Meter" contract=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 selector=0x70a08231 decimals=18 unit=PAS perReply=100000000000000000 chain=0xd6eec261…
BALANCE_BEFORE with Meter: 4.6 PAS (~46 replies)
SENT /topup
BUTTON "Top up 1 PAS" text="Add 1 PAS to your balance. Each reply costs 0.1 PAS." intent: Top up 1 PAS; calls=1 kind=1 to=0x30b0c001431a1addb8c11a060ada4d6a7033cf21 value=10000000000
DRYRUN ok=true fee=0.0014 PAS (14510503 planck) mapsAccount=false value=10000000000
SIGNED hash=0xdff7c2738f4338df55b859601885e899e04d99a74784a0fbdab3f2113ffb95bf at=19.0s
TOPUP_OK status=inBlock block=13628056 row="Top up (1 PAS)" at=21.0s
BALANCE with Meter: 5.6 PAS (~56 replies) (5600000000000000000 PAS units; before with Meter: 4.6 PAS (~46 replies))
ANSWER 1 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate, 
BALANCE with Meter: 5.6 PAS (~56 replies) (no charge yet: pending in the bot's batch) at=52.5s
ANSWER 2 A parachain is an independent blockchain that runs on the Polkadot network, sharing security with other parach
BALANCE with Meter: 5.6 PAS (~56 replies) (no charge yet: pending in the bot's batch) at=83.2s
ANSWER 3 Asset Hub is a Polkadot parachain that provides a common platform for creating, managing, and trading custom a
BALANCE with Meter: 5.6 PAS (~56 replies) (no charge yet: pending in the bot's batch) at=114.9s
ANSWER 4 A smart contract is a self-executing program stored on a blockchain that automatically enforces agreements and
BALANCE with Meter: 5.1 PAS (~51 replies) (-0.5 PAS) reference="balance: 51000000000" inBlock at=122.4s
ANSWER 5 Polkadot is a blockchain network that connects multiple independent blockchains (parachains) to interoperate, 
BALANCE with Meter: 5.1 PAS (~51 replies) (no charge yet: pending in the bot's batch) at=152.3s
CHARGE_REFERENCES 1 (inBlock)
METERED_OK 5 answers, 1 charge(s): 5.6 → 5.1 PAS
TOPUP_REFERENCE finalized
METER_OK
PENDING_ANSWER 1 A parachain is an independent blockchain that runs on the Polkadot network, sharing security with other parach pending=200000000000000000 at=156.3s
PENDING_ANSWER 2 Asset Hub is a Polkadot parachain that provides a common platform for creating, managing, and trading custom a pending=300000000000000000 at=160.3s
BOT_BALANCE "Balance: 4.8 PAS · ~48 replies at 0.1 PAS each."
HEADER with Meter: 4.8 PAS (~48 replies) tooltip="5.1 PAS on chain · 0.3 not yet charged"
HEADER_MATCHES_BALANCE 4.8 PAS
```

### PCD_HEADLESS=1 PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots -- --only room-meter

```
0.7s built
1.0s seeded pcdecejakd.11
1.0s assistant engine claude
17.3s header: "with Meter: 4.9 PAS (~49 replies)" tooltip: "5.1 PAS on chain · 0.2 not yet charged"
17.3s saved berlin-day/room-meter.png
22.5s header: "with Meter: 4.9 PAS (~49 replies)" tooltip: "5.1 PAS on chain · 0.2 not yet charged"
22.6s saved berlin-night/room-meter.png
23.1s seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/room-meter.png
  .agent-runs/screens/berlin-night/room-meter.png
SCREENSHOTS_OK
```

I looked at the day PNG of this run (header "with Meter: 4.9 PAS (~49 replies)", tooltip under the number "5.1 PAS on chain · 0.2 not yet charged") and at the night PNG of the run before it (same layout, with 4.4 and 4.6 PAS).

### git status --short

This file is part of the commit, so the result is in the M12f hand-off report.

## M12i (2026-09-24)

### npm run check

Green after the load dropped (23:31):

```
 Test Files  68 passed (68)
      Tests  566 passed (566)
check:tokens: clean (155 files)
```

Four earlier runs, while the machine ran at load average 32–39 (a runaway process, killed by the coordinator at 23:30), failed only the two timing tests of `src/renderer/domain/chat/messages.spec.ts` (a 5 s timeout over 500 deletions, a 50 ms search budget); they failed the same way with the M12i specs excluded and passed alone. No threshold was changed.

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=$(mktemp -d) npm run smoke

```
✓ built in 977ms
SMOKE_OK
```

### npm run e2e:demo

A fresh identity registered in the run (9 lines "Waiting for the network" left out):

```
> polkadot-chat-desktop@0.1.0 e2e:demo
> node scripts/e2e-demo.mjs
identity register pcddemoiykp on devnet
  Creating keys
  Claiming username
identity registered pcddemoiykp.37 confirmed=true finalized=false at=32.5s
SELF 0x7ce34787c8509eb1992de0690bdcec22fa7551b34d3bf336ec99b702137f9054 pcddemoiykp.37
[ws] connected
people best block #7057537
DEMO_START bots=pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05 opener="Hi!"
DEMO_STEP pcdpirate.81 sent at=35.8s
DEMO_STEP pcdguide.70 sent at=36.9s
DEMO_STEP pcdmeter.01 sent at=37.9s
DEMO_STEP pcdflip.44 sent at=39.0s
DEMO_STEP pcdfaucet.77 sent at=40.1s
DEMO_STEP pcdpeer.47 sent at=41.2s
DEMO_STEP pcdcolor.05 sent at=42.2s
RUN1 sent=7 of 7 at=42.2s
ACCEPTED pcdpirate.81 after=7.5s
ACCEPTED pcdguide.70 after=7.5s
ACCEPTED pcdmeter.01 after=7.5s
ACCEPTED pcdflip.44 after=7.5s
ACCEPTED pcdfaucet.77 after=7.5s
ACCEPTED pcdpeer.47 after=7.5s
ACCEPTED pcdcolor.05 after=8.5s
DEMO_OK n=7 within=8.5s no-answer=none
GREETED 7/7 pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05
DEMO_IDEMPOTENT sent=0 pcdpirate.81=skipped pcdguide.70=skipped pcdmeter.01=skipped pcdflip.44=skipped pcdfaucet.77=skipped pcdpeer.47=skipped pcdcolor.05=skipped
```

### PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots -- --only demo-onboarding,settings-demo

```
9.2s demo fixture requests: pcdpirate.81, pcdguide.70
11.2s saved berlin-day/demo-onboarding.png
12.1s saved berlin-day/settings-demo.png
20.3s saved berlin-night/demo-onboarding.png
21.2s saved berlin-night/settings-demo.png
21.8s seeded profile removed: true
SCREENSHOTS_OK
```

I looked at the day onboarding PNG (seven rows with avatar, name, tag chip and tagline; "Sent" and "No answer yet" on the two fixture rows; "Start chats with all" and "Skip") and the night Settings › Demo PNG ("Start chat" per row, "Start all", "Remove demo chats").

### git status --short

This file is part of the commit, so the result is in the M12i hand-off report.

## M12g (2026-09-24)

Every app launch below set `PCD_HEADLESS=1` and a throwaway `PCD_USER_DATA_DIR` (smoke: `mktemp -d`; screenshots: the script makes its own profiles and removes them). The e2e scripts start no app (domain code over fake-indexeddb). Identities: this repo's test identities pcde2e (`pcdecejakd.11`, person a) and pcdeceb (`pcdeceb.89`, person b), devnet only. Both held more than 30 PAS, so no drip was needed. The pca bots were not touched.

While I worked, another agent (M12i demo mode) edited the same working tree. The commands under "On the committed tree" ran in a clean worktree of exactly the M12g commit's tree; the e2e, smoke-before-commit and screenshot runs ran in the shared tree (the M12i files then were partial or absent).

### npm run e2e:pay (third run)

```
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b
[a] READY username=pcdecejakd.11 free=34.4157 PAS
[b] READY username=pcdeceb.89 free=38.482 PAS
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 at=5.2s
[a] CHAT_REQUEST_SENT id=19da84d1-ab98-41df-b045-1ad91c7d5286 to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11
[a] CONTACT pcdeceb.89 devices=1
[a] REQUEST_SENT id=fc22b339-e7b2-4e7a-88fb-3abd1e819824 text="Requested 0.2 PAS · e2e lunch" free_before=34.4157 PAS
[b] REQUEST_SEEN amount=0.2 title="Pay pcdecejakd.11 0.2 PAS" button="Pay 0.2 PAS" state=pending
[b] DRYRUN ok=true value=0.2 PAS fee=0.0009 PAS
[b] PAID hash=0x1fbced4e43653caf9fd9c29e5d7ee6e06857a26ebce292df652a1cc365ce34b4 block=13628911 note="req:fc22b339-e7b2-4e7a-88fb-3abd1e819824 e2e lunch" state=paid
[a] REQUEST_PAID hash=0x1fbced4e43653caf9fd9c29e5d7ee6e06857a26ebce292df652a1cc365ce34b4 block=13628911 chain_moved=0.2 PAS line="pcdeceb.89 paid your request of 0.2 PAS · e2e lunch · in block #13628911"
[a] BALANCE_OK before=34.4157 PAS after=34.6157 PAS delta=0.2 PAS expected=0.2
[b] OVER_BALANCE_REFUSED amount=38.2811 PAS error="Not enough PAS: 38.2701 available after fees." id=null
[b] DRYRUN ok=true value=0.1 PAS fee=0.0009 PAS
[b] SENT hash=0x4eecf9f265184a668791fbada45ed6b963113fa58ca83bc5b54515bdcc4b0bcd block=13628914 line="Sent 0.1 PAS to pcdecejakd.11 · e2e direct · in block #13628914"
[a] RECEIVED hash=0x4eecf9f265184a668791fbada45ed6b963113fa58ca83bc5b54515bdcc4b0bcd block=13628914 chain_moved=0.1 PAS line="pcdeceb.89 sent you 0.1 PAS · e2e direct · in block #13628914"
[a] EXIT
[b] EXIT
BLOCKS request_paid=13628911 sent=13628914
PAY_OK at=23.0s
```

The two block numbers: the request's payment is in block **#13628911** (hash 0x1fbced4e…34b4), the direct send in block **#13628914** (hash 0x4eecf9f2…0bcd). Run 2 of the same script (after the balance check moved before the chain's dry-run) also ended PAY_OK, blocks 13628722 and 13628725. Run 1 failed at OVER_BALANCE (`Token.NotExpendable` from the chain's dry-run instead of this app's message); that is the fix in `assetHub.ts`.

### npm run e2e:typing

```
[ws] connected
best block #7057351 (runtime ready in 2.1s)
PEER 0x66b78abdcb4c89d2817ce45f201677c08240fde23c50b9c94a6abb6912888a63 key_type=0
PREFS sendTyping=false readReceipts=true (a fresh profile: the defaults)
REQUEST_SENT attempt=1
ACCEPTED devices=1
BOTINFO name="Captain Dot" version=1
WORKING_LOCAL at=0.0s state={"kind":"working","until":1790219662846,"local":true}
QUESTION_SENT 5d000fd0-e192-478f-b8c1-eabee469356a QUESTION_SUBMISSIONS 1
SEEN_RECEIVED upTo=5d000fd0-e192-478f-b8c1-eabee469356a at=5.6s (before the reply)
REPLY at=6.8s Why did the pirate captain love the blockchain, ye ask? Because every block be another treasure ches
WORKING_CLEARED at=6.8s state=null
READ_SUBMISSIONS 1 (inside the 5 s window: 0)
COUNTS submissions=2 messages=1 acknowledgements=2 (this round)
DIAGNOSTICS submissions=3 messages=1 acknowledgements=4 (whole run: request and accept included)
BUDGET_OK
```

### PCD_HEADLESS=1 PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots -- --only send-pas,room-request,room-request-paid

```
2.0s built
2.4s seeded pcdecejakd.11
2.4s assistant engine claude
6.3s request: "Requested 0.5 PAS · Concert tickets Pay 0.5 PAS 0.5 PAS Decline 11:03 PM 👍 ❤️ 😂 😮 😢 🙏 🔥 👏"
7.2s saved berlin-day/room-request.png
8.1s saved berlin-day/send-pas.png
22.6s send strip: "Send 1.5 PAS to rubyfinch.23 Your ticket Amount 1.5 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 Balance after: 33.2148 PAS Cancel Sign"
23.7s paid: "You requested 0.2 PAS e2e lunch Paid · in block #13628911" reference: "pcdeceb.89 paid your request of 0.2 PAS · e2e lunch · finalized in block #13628911 0x1fbc…34b4 Copy hash View on Subscan"
24.5s saved berlin-day/room-request-paid.png
28.7s request: "Requested 0.5 PAS · Concert tickets Pay 0.5 PAS 0.5 PAS Decline 11:04 PM 👍 ❤️ 😂 😮 😢 🙏 🔥 👏"
29.5s saved berlin-night/room-request.png
30.4s saved berlin-night/send-pas.png
32.0s send strip: "Send 1.5 PAS to rubyfinch.23 Your ticket Amount 1.5 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 Balance after: 33.2148 PAS Cancel Sign"
32.7s paid: "You requested 0.2 PAS e2e lunch Paid · in block #13628911" reference: "pcdeceb.89 paid your request of 0.2 PAS · e2e lunch · finalized in block #13628911 0x1fbc…34b4 Copy hash View on Subscan"
33.6s saved berlin-night/room-request-paid.png
34.1s seeded profile removed: true
PNGs:
  .agent-runs/screens/berlin-day/room-request.png
  .agent-runs/screens/berlin-day/send-pas.png
  .agent-runs/screens/berlin-day/room-request-paid.png
  .agent-runs/screens/berlin-night/room-request.png
  .agent-runs/screens/berlin-night/send-pas.png
  .agent-runs/screens/berlin-night/room-request-paid.png
SCREENSHOTS_OK
```

I looked at berlin-day/send-pas.png (amount row "Send PAS to rubyfinch.23", 1.5 PAS, note, Review), berlin-night/room-request.png ("Requested 0.5 PAS · Concert tickets", the tx button with the wallet icon and "0.5 PAS", Decline beside it) and berlin-day/room-request-paid.png ("You requested 0.2 PAS", "Paid · in block #13628911", and "pcdeceb.89 paid your request of 0.2 PAS · e2e lunch · finalized in block #13628911"). The first run of this command missed room-request and room-request-paid: the M12d action cache dropped the new fields (fixed, see Decisions).

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=$(mktemp -d) npm run smoke (shared tree, before the commit)

```
SMOKE_OK
```

### On the committed tree: npm run check

Run in a clean worktree of the M12g tree (without the M12i files). Under a load average of 25–36 (a runaway process, later stopped by the coordinator) the same two timing tests of `messages.spec.ts` failed in each of several runs, as they did on the unchanged HEAD. I did not change those tests. At 23:32, load average 7.19, the whole check passed. Last 10 lines:

```
 Test Files  65 passed (65)
      Tests  547 passed (547)
   Start at  23:32:17
   Duration  16.46s (transform 2.67s, setup 956ms, import 10.73s, tests 35.01s, environment 3ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (152 files)
```

### On the committed tree: PCD_HEADLESS=1 PCD_USER_DATA_DIR=$(mktemp -d) npm run smoke

```
SMOKE_OK
```

### Combined tree (HEAD 88043de: M12g + M12i): npm run check, load average 3.81

```
 Test Files  68 passed (68)
      Tests  566 passed (566)
   Start at  23:33:27
   Duration  16.38s (transform 2.57s, setup 1.09s, import 10.65s, tests 34.89s, environment 3ms)


> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (155 files)
```

`docs/milestones/M12g.check.sh` runs after the commit (it needs a clean tree); its output is in the hand-off report.


### git status --short

This file is part of the commit, so the result is in the M12g hand-off report. The M12i agent committed while my hunks were staged, so the M12g code is in b9b0c88 and 88043de (see questions.md "## M12g"). The runs below "On the committed tree" used a tree whose M12g files are identical to HEAD's (checked file by file); the combined tree is checked under "Combined tree".

## M12i (follow-up) (2026-09-24)

The demo action waits until this identity's key is visible on the People chain (best block, every 2 s, up to 90 s) before it sends.

### npm run check

```
 Test Files  68 passed (68)
      Tests  570 passed (570)
check:tokens: clean (155 files)
```

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<scratch dir> npm run smoke

```
✓ built in 188ms
SMOKE_OK
```

### npm run e2e:demo (three runs; `[ws]` and "Waiting for the network" lines left out)

**Run A, 03:42 UTC, before the pca identifier-retry fix reached the fleet (its `index.mjs` is dated 03:43:50 UTC): DEMO_FAIL.** The app read the key at once, at the best block, and every request went out. All seven bots dropped them: pcdpeer logged `BOT_OPENER_NO_IDENTIFIER from=b04a2581…` at 03:42:29, about 9 s after the app read the key. The bots also read `Resources.Consumers` at the best block, through `people-paseo.rotko.net`, so their node did not yet show what the app read. The client wait cannot close that gap; the pca retry does.

```
> polkadot-chat-desktop@0.1.0 e2e:demo
> node scripts/e2e-demo.mjs
identity register pcddemowjtk on devnet
  Creating keys
  Claiming username
identity registered pcddemowjtk.16 confirmed=true finalized=false at=17.6s
SELF 0xb04a258125de086cee8f9e983dc9d82d1482d5791f2c4326a9f97396ddd26b72 pcddemowjtk.16
people best block #7057776
DEMO_START bots=pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05 opener="Hi!"
DEMO_KEY_VISIBLE at=once (359ms)
DEMO_STEP pcdpirate.81 sent at=20.8s
DEMO_STEP pcdguide.70 sent at=21.7s
DEMO_STEP pcdmeter.01 sent at=22.6s
DEMO_STEP pcdflip.44 sent at=23.5s
DEMO_STEP pcdfaucet.77 sent at=24.4s
DEMO_STEP pcdpeer.47 sent at=25.4s
DEMO_STEP pcdcolor.05 sent at=26.3s
RUN1 sent=7 of 7 at=26.3s
DEMO_FAIL accepted=0 (need 4) no-answer=pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05
```

**Run B, 03:45 UTC, after the fix: DEMO_OK n=7, DEMO_IDEMPOTENT.** The fleet logged no identifier retry event for this account: the first lookup found the key.

```
> polkadot-chat-desktop@0.1.0 e2e:demo
> node scripts/e2e-demo.mjs
identity register pcddemoplss on devnet
  Creating keys
  Claiming username
identity registered pcddemoplss.87 confirmed=true finalized=false at=8.7s
SELF 0x22caa6f4884b24abb976470aa9d6d143534e7a235c97069205e3518f29ffcd3e pcddemoplss.87
people best block #7057792
DEMO_START bots=pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05 opener="Hi!"
DEMO_KEY_VISIBLE at=once (343ms)
DEMO_STEP pcdpirate.81 sent at=11.8s
DEMO_STEP pcdguide.70 sent at=12.8s
DEMO_STEP pcdmeter.01 sent at=13.8s
DEMO_STEP pcdflip.44 sent at=14.8s
DEMO_STEP pcdfaucet.77 sent at=15.7s
DEMO_STEP pcdpeer.47 sent at=16.7s
DEMO_STEP pcdcolor.05 sent at=17.7s
RUN1 sent=7 of 7 at=17.7s
ACCEPTED pcdpirate.81 after=7.2s
ACCEPTED pcdguide.70 after=7.2s
ACCEPTED pcdmeter.01 after=7.2s
ACCEPTED pcdflip.44 after=7.2s
ACCEPTED pcdfaucet.77 after=7.2s
ACCEPTED pcdpeer.47 after=7.2s
ACCEPTED pcdcolor.05 after=8.2s
DEMO_OK n=7 within=8.2s no-answer=none
GREETED 7/7 pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05
DEMO_IDEMPOTENT sent=0 pcdpirate.81=skipped pcdguide.70=skipped pcdmeter.01=skipped pcdflip.44=skipped pcdfaucet.77=skipped pcdpeer.47=skipped pcdcolor.05=skipped
```

**Run C, 03:46 UTC: DEMO_OK n=7, DEMO_IDEMPOTENT.** No identifier event in the fleet logs since the 03:44 restart, so the bot retry was not used.

```
> polkadot-chat-desktop@0.1.0 e2e:demo
> node scripts/e2e-demo.mjs
identity register pcddemonjhg on devnet
  Creating keys
  Claiming username
identity registered pcddemonjhg.87 confirmed=true finalized=false at=54.7s
SELF 0x2662557764d86b6b64346dba41956935021faa52c8bffb880ef11371c69b8d52 pcddemonjhg.87
people best block #7057817
DEMO_START bots=pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05 opener="Hi!"
DEMO_KEY_VISIBLE at=once (620ms)
DEMO_STEP pcdpirate.81 sent at=60.0s
DEMO_STEP pcdguide.70 sent at=60.9s
DEMO_STEP pcdmeter.01 sent at=61.9s
DEMO_STEP pcdflip.44 sent at=62.9s
DEMO_STEP pcdfaucet.77 sent at=63.9s
DEMO_STEP pcdpeer.47 sent at=64.9s
DEMO_STEP pcdcolor.05 sent at=65.9s
RUN1 sent=7 of 7 at=65.9s
ACCEPTED pcdpirate.81 after=7.8s
ACCEPTED pcdguide.70 after=7.8s
ACCEPTED pcdmeter.01 after=7.8s
ACCEPTED pcdflip.44 after=7.8s
ACCEPTED pcdfaucet.77 after=7.8s
ACCEPTED pcdpeer.47 after=7.8s
ACCEPTED pcdcolor.05 after=8.8s
DEMO_OK n=7 within=8.8s no-answer=none
GREETED 7/7 pcdpirate.81,pcdguide.70,pcdmeter.01,pcdflip.44,pcdfaucet.77,pcdpeer.47,pcdcolor.05
DEMO_IDEMPOTENT sent=0 pcdpirate.81=skipped pcdguide.70=skipped pcdmeter.01=skipped pcdflip.44=skipped pcdfaucet.77=skipped pcdpeer.47=skipped pcdcolor.05=skipped
```

`DEMO_WAITED_FOR_KEY` did not appear in any run. Sign-up (`createIdentity`) already waits for the attestation at the best block, so the key was there at the first read each time. The waiting, send-after-visible and timeout paths are covered by `src/renderer/domain/demo/demo.spec.ts` "the wait for this identity's key" (fake timers).

## M12h (2026-09-24)

Every app launch set `PCD_HEADLESS=1` and a throwaway `PCD_USER_DATA_DIR` (the screenshot script sets both per app; smoke got them on the command line). The live flows used the VPS fleet (pcdflip.44, pcdguide.70, pcdpirate.81, the embedded Faucet's devnet transfer) and the test identities pcde2e, pcdbenchzzlx, pcdbenchqmwk, pcdbenchfina, pcdeceb; the fleet was not touched. Worktree `pcd-m12h`, branch `m12h`.

### Timings

| Run | Command | Result | Wall time |
| --- | --- | --- | --- |
| Before (bdba746, a copy of the tree) | `PCD_HEADLESS=1 PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json PCD_SCREENSHOT_ROOM_WITH=pcdbenchfinb node scripts/screenshots.mjs` | SCREENSHOTS_PARTIAL (5 missed) | **352 s** |
| After, full | `PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run screenshots` | SCREENSHOTS_OK, 72 PNGs | **78.8 s** |
| After, one shot | `… npm run screenshots -- --only room-tx-done` | SCREENSHOTS_OK | **18.1 s** |
| After, one fixture shot | `… npm run screenshots -- --only chat-menu` | SCREENSHOTS_OK | **3.5 s** |

The before run missed `berlin-day/group-create`, `room-group`, `group-members` ("pcdbenchfina.25 is not among the contacts to pick": an old request was accepted) and `chat-menu` in both themes ("the row menu did not open"). Its slow parts: the flows ran once per theme (the night room-bot waited 59 s for the room peer), and every shot waited in turn.

Other after runs, not the acceptance run:
- Run 1: SCREENSHOTS_PARTIAL in 80.2 s. Only `settings-diagnostics` missed: my check wanted the ratio 2.00, and the real pirate request had added a submission. The check now wants a count with messages > 0; `--only settings-diagnostics` then passed in 3.6 s (`Submissions per message 2.00 (6 / 3) Delivery acknowledgements (not counted above) 4`).
- Run 2: SCREENSHOTS_PARTIAL in 282.6 s. The devnet was slow: the Faucet drip showed no outcome in 120 s, our stake took 23 s to a block, and the second player's stake failed on chain after a passing dry-run (`STAKE_FAILED Revive.StorageDepositLimitExhausted` in flip-peer.log). That left our stake waiting, and the next flip run's dry-run said "already staked". The script now fails at once on `STAKE_FAILED` and settles a stale round first (`--only room-flip,room-flip-done`: "our earlier stake still waits; the second player settles it", then SCREENSHOTS_OK in 47.7 s). See docs/questions.md "## M12h".
## M13 (2026-09-24)

Publish the local agent as an on-chain peer (bot-core 675f948 in a utility process, the brain in main); structured directives by tool calling.

### npm run check

```
 Test Files  69 passed (69)
      Tests  576 passed (576)
   Duration  16.40s (transform 2.64s, setup 1.05s, import 11.72s, tests 35.23s, environment 4ms)
check:tokens: clean (156 files)
```

(tsc and eslint print nothing when clean.) Specs that encode the carry items, each checked to fail without the change where marked:
- `src/renderer/ui/ChatList.spec.ts` "reads "Sent · just now" for the first 15 s, as the demo row does".
- `src/renderer/ui/sentClock.spec.tsx` "turns to "No answer yet" 15 s after sending with no other render" (fails with the hook's timer removed: `expected 'Sent · just now' to be 'No answer yet · sent just now'`).
- `src/renderer/domain/chain/payments.spec.ts` "reads an incoming send as checking until the chain shows the transfer, then with the chain amount" and "asks the chain about a send to us and a payment of our request, once in a block".
- `src/renderer/ui/txButton.spec.ts` "drops the caption when the label already shows the amount, and keeps it otherwise".
- `src/renderer/domain/chat/messages.spec.ts` "finds text, richText and reply rows …" (the reply row is now a hit).
- `src/renderer/domain/chat/content.spec.ts` "rejects a received keyboard over the limits as unsupported, and keeps one at the limits".

### npm run smoke

```
✓ built in 187ms
SMOKE_OK
```

### npm run screenshots (full, timed)

```
0.5s built
2.8s [main] seeded pcdecejakd.11
3.0s [group] seeded pcdbenchqmwk
3.0s [flip] seeded pcdbenchzzlx
4.9s [signup] saved signup
18.9s [group] request of pcdbenchfina.25 arrived 12.8 s after it was sent
19.7s [main] fixture written
19.8s [group] contact with pcdguide.70
20.1s [group] header: "working…"
21.0s [flip] faucet room: "ave no value. What do you need? Get 1 PAS Get test funds Copy my address 12:23 AM Dripped 1 PAS from //Alice · in block #13631042 0xb47b…e4e3 Copy hash View on Subscan 12:23 AM Balance now 28.4791 PAS"
21.1s [group] saved room-typing
21.8s [main] saved chats
21.9s [flip] saved faucet
22.7s [group] contact with pcdbenchfina.25
23.8s [group] saved group-create
23.8s [main] saved room
24.1s [flip] request sent to pcdflip
24.8s [main] saved room-deleted
24.9s [main] url strip: "Open docs.polkadot.com in your browser?CancelOpen" disabled: 1
25.9s [main] saved room-buttons
25.9s [main] command menu: ["/stakingHow staking works","/rewardsYour rewards this era","/validatorsPick validators to nominate","/startStart over","/helpWhat I can do"]
26.9s [main] saved room-bot
27.6s [flip] flip strip: "Coin flip stake Stakes 0.5 PAS in a coin flip. The second staker triggers the flip; the winner takes 1 PAS. Amount 0.5 PAS Fee ≈ 0.0017 PAS Signs as pcdbenchzzlx.23 After this: your stake: 0.5 PAS Cancel Sign"
28.2s [main] saved room-seen
28.6s [flip] saved room-flip
31.0s [main] strip: "Send to yourself A test transfer of 0.01 PAS from your account back to it Amount 0.01 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 The test run passed. Cancel Sign"
31.9s [group] group senders: ["pcdbenchfina.25","pcdguide.70"]
32.0s [main] saved room-tx
32.0s [main] header: "with Meter: 4.9 PAS (~49 replies)"
32.1s [flip] stake: "Coin flip stake (0.5 PAS) · in block #13631048\n\n0xd2f2…b74b\nCopy hash\nView on Subscan"
32.9s [group] saved room-group
33.0s [main] saved room-tx-done
34.1s [group] saved group-members
42.2s [flip] second player stakes
44.8s [main] saved pocket
46.0s [main] saved assistant
48.0s [flip] settled: "Flip settled: pcdeceb.89 won 1 PAS · in block #13631056\n\n0x24a1…0f79\nCopy hash\nView on Subscan"
48.0s [main] request sent to pcdpirate.81 from a global search hit
49.0s [flip] saved room-flip-done
50.0s [main] saved search
50.5s [main] saved search-jump
54.2s [main] global search "pcd": 8 rows, 15 after Show more
55.2s [main] saved search-empty
57.7s [main] saved search-no-results
58.5s [main] bots: ["Faucet Test funds for devnet","P Captain Dot A cheerful pirate who answers everything in pirate speak. Test bot on devnet.","T Staking Helper Answers staking questions and checks your rewards"]
59.5s [main] saved search-bots
60.8s [main] saved requests
62.9s [main] saved settings
62.9s [main] diagnostics: "Submissions per message 2.33 (7 / 3) Delivery acknowledgements (not counted above) 6"
63.9s [main] saved settings-diagnostics
64.9s [main] saved keyboard
64.9s [main] row menu: "Pin Mark as read Mute Archive Clear history Block Delete chat"
65.9s [main] saved chat-menu
66.9s [main] saved archived
68.1s [main] saved settings-privacy
69.0s [main] header: "with Meter: 4.7 PAS (~47 replies)" tooltip: "4.9 PAS on chain · 0.2 not yet charged"
69.3s [main] saved room-meter
69.4s [main] request: "Requested 0.5 PAS · Concert tickets Pay 0.5 PAS Decline 12:13 AM 👍 ❤️ 😂 😮 😢 🙏 🔥 👏"
70.4s [main] saved room-request
71.4s [main] saved send-pas
72.5s [main] send strip: "Send 1.5 PAS to rubyfinch.23 Your ticket Amount 1.5 PAS Fee ≈ 0.0009 PAS Signs as pcdecejakd.11 Balance after: 35.0163 PAS Cancel Sign"
73.5s [main] paid: "You requested 0.2 PAS e2e lunch Paid · in block #13629688"
74.5s [main] saved room-request-paid
76.1s [main] demo fixture requests: pcdguide.70, pcdmeter.01
76.7s [main] demo intro: "Each one gets a chat request that says “Hi!”. They accept and answer within seconds. P pcdpirate.81 Assistant Captain Dot — a pirate who jokes Chatting P pcdguide.70 Assistant Guide — Polkadot support with buttons Sent P pcdmeter.01 Payments Meter — a paid assistant, 0.1 PAS per reply No answer yet P pcdflip.44 Game Flip — coin flips for 0.5 PAS P pcdfaucet.77 Utility Faucet bot — test funds P pcdpeer.47 Utility Echo — repeats what you say P pcdcolor.05 Utility Color — answers with a colour Start chats with all Skip"
77.7s [main] saved demo-onboarding
78.7s [main] saved settings-demo
SCREENSHOTS_OK in 78.8 s
PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcde2e/identity.json npm run   25.40s user 6.75s system 40% cpu 1:18.89 total
```

I read these PNGs. From run 3: room-flip (night, the stake strip) and settings-diagnostics (night, "2.33 (7 / 3)"). From run 1 and the single-shot runs: room, room-seen (tooltip "Seen 11:28 PM"), room-tx (strip, "The test run passed."), room-tx-done (day and night: failed in the error colour, finalized with its action row, in block, submitted with the spinner; "with Meter: 4.9 PAS" in the header), room-typing ("working…" under pcdguide.70), room-group (three senders), room-flip-done ("Flip settled"), faucet (drip reference, "Balance now", the url strip), chat-menu (the row menu open), search (Bots, Global, Messages with the match in bold). In the first single-shot try the night keyboard buttons were caught mid-transition (dark text on a dark button); transitions are now off while the theme flips, and the night room-tx-done after that is clean. The request button reads "Pay 0.5 PAS" with no caption beside it (`request: "Requested 0.5 PAS · Concert tickets Pay 0.5 PAS Decline …"`).

### npm run screenshots -- --only room-tx-done (timed)

```
0.5s built
1.7s [main] seeded pcdecejakd.11
2.4s [main] fixture written
17.0s [main] header: "with Meter: 4.9 PAS (~49 replies)"
18.0s [main] saved room-tx-done
SCREENSHOTS_OK in 18.1 s
```

The 14.6 s between "fixture written" and the header line are the first Asset Hub connection of the main process (opened on first use) and the Meter read.

### Not run

- The carry items were not seen live in the app: no peer sent this identity a direct send during the run, and no over-limit keyboard came in. The specs above cover them.
- The full screenshot run came before one last change to `useSentClock` (it now catches up on any list change, not only on request changes). `npm run check` and `npm run smoke` (SMOKE_OK) ran again after it; the screenshots did not.

### git status --short

This file is part of the commit, so the result is in the M12h hand-off report.

### Follow-up: the workers default their identities (2026-09-24)

`bash docs/milestones/M12h.check.sh` failed on main: it sets no `PCD_SCREENSHOT_IDENTITY`, so the main worker missed every shot. The main worker now defaults to `.agent-runs/identity-pcde2e/identity.json` (flip and group already defaulted to pcdbenchzzlx/pcdeceb and pcdbenchqmwk/pcdbenchfina); the variables stay as overrides and are listed at the top of `scripts/screenshots.mjs`.

`env -i HOME=$HOME PATH=$PATH npm run screenshots` in the worktree: exit 0, 72 PNGs, `SCREENSHOTS_OK in 66.5 s` (67 s wall).
 Test Files  74 passed (74)
      Tests  606 passed (606)
check:tokens: clean (158 files)
```

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<scratch dir> npm run smoke

```
✓ built in 186ms
SMOKE_OK
```

### npm run e2e:tools

```

> polkadot-chat-desktop@0.1.0 e2e:tools
> node scripts/e2e-tools.mjs

0.0s fake server http://127.0.0.1:59560
0.5s built
0.7s seeded pcdecejakd.11
1.8s asked
4.0s TOOLS_OFFERED yes (requests=1, tools=send_buttons)
4.0s TOOLS_PROMPT_WITHOUT_FENCE yes
4.0s TOOLS_KEYBOARD Red, Blue
4.0s TOOLS_JSON_SEEN 0
TOOLS_OK
```

The first run of this script (not above) connected to port 9337, where the M12h agent's app was listening, and drove that app (questions.md "## M13"). The script now picks a free port and checks it before launch.

### npm run e2e:agent (fake OpenAI-style engine, the default; devnet, sender pcdeceb)

```

> polkadot-chat-desktop@0.1.0 e2e:agent
> node scripts/e2e-agent.mjs

0.8s built
1.3s claim pcdagentikkh on devnet (engine: fake OpenAI server)
23.0s AGENT_PUBLISHED pcdagentikkh.76 confirmed=true
24.0s AGENT_RUNNING
24.0s SENDER pcdeceb.89
27.6s REQUEST_SENT (no text)
40.6s ACCEPTED devices=1
40.6s BOTINFO kind=1 name=pcdagentikkh.76 commands=help,about,stop
41.6s GREETED "Hello! I am a test agent. Ask me anything."
50.1s ANSWER "Pick a colour." keyboard=[Red, Blue] submissions=1 replies=1
50.1s ANSWER_KEYBOARD
58.6s PRESS_ANSWERED "You picked red." submissions=1 replies=1
58.6s TOTALS replies=3 submissions=4 (the accept and the greeting included) typing=0
58.6s BUDGET_OK one submission per reply
AGENT_OK
```

Earlier runs, kept for what they found:
- Run 2: `AGENT_TIMEOUT accept` with `agent log: error BOT_OPENER_DECODE_FAILED: Unknown cipher`: Electron's BoringSSL has no chacha20-poly1305 (decisions.md "## M13"). Fixed with the shim in the utility process entry.
- Run 3: `GREETED "Connecting you to the agent…"`: a utility process drops an empty `BOT_ACK_TEXT`. Fixed (`PCD_EMPTY_ENV`); the script now fails on that text.

### node scripts/e2e-agent.mjs --real-proxy (information, not the acceptance: the LLM proxy's default model)

Run A (before the tool-argument shaping): the model called `send_buttons` with bare-string buttons; the brain dropped it (`agent log: info dropped: send_buttons: arguments break the buttons rules`) and the answer came as text only: `AGENT_FAIL the answer has no keyboard`. The same run's answer cost 2 submissions (the seen went alone after 5 s).

Run B: `AGENT_TIMEOUT answer` after `BOT_STATEMENT_INGRESS_HEARTBEAT_SUBMIT_FAILED`, `BOT_OUTBOUND_SUBMIT_FAILED` and `BOT_SEEN_FAILED`: `statement_submit rejected: noAllowance` for the new agent account (questions.md).

Run C (after the shaping):

```
0.8s built
1.3s claim pcdagentwblb on devnet (engine: LLM proxy)
18.8s AGENT_PUBLISHED pcdagentwblb.36 confirmed=true
19.8s AGENT_RUNNING
19.8s SENDER pcdeceb.89
23.1s REQUEST_SENT (no text)
33.1s ACCEPTED devices=1
33.1s BOTINFO kind=1 name=pcdagentwblb.36 commands=help,about,stop
40.1s GREETED "Hey — I'm **pcdagentwblb.36**, a bot running locally on this computer, right ins"
56.6s ANSWER "Colours are just wavelengths to me — but I do have a favouri" keyboard=[Polkadot pink, Deep space blue, Terminal green, Sunset orange] submissions=2 replies=1
56.6s ANSWER_KEYBOARD
73.2s PRESS_ANSWERED "**Polkadot pink** — `#E6007A`. Good pick, and not just becau" submissions=2 replies=1
73.2s TOTALS replies=3 submissions=7 (the accept and the greeting included) typing=0
AGENT_FAIL budget: the answer cost 2 submissions for 1 replies
```

With a real engine (about 10 s per answer) the tool path works (a four-button keyboard, the press answered), and each reply costs 2 submissions: bot-core sends the seen alone when no reply comes within 5 s (questions.md "## M13").

### PCD_SCREENSHOT_PORT=9451 npm run screenshots -- --only settings-agent (after the rebase onto M12h's rewritten script; main worker pcde2e, agent identity pcdbenchcold)

```
2.4s [main] fixture written
5.9s [main] settings agent: "Give the Assistant its own username, so a phone user or any peer can chat with it while this app runs. It answers with the engine chosen under Assistant, with its tools off. Publish my agent Published. It answers while this app runs. pcdbenchcold.22 Share this name: people find your agent by it. It "
7.1s [main] saved settings-agent
SCREENSHOTS_OK in 7.2 s
```

Files: `.agent-runs/screens/berlin-day/settings-agent.png`, `.agent-runs/screens/berlin-night/settings-agent.png`.

### git status --short

Clean after the commit (checked before the push).

### Not run

- `npm run package` / the packaged app with the agent (not in M13's acceptance; questions.md).

## Tx limits (2026-09-24)

The signer takes, per field, the larger of the intent limit and its estimate + 20 %; an intent without a deposit limit gets estimate + 0.1 PAS (spec 0007 "Limits of a Revive call"). pcdflip.44 sends the limits of pca 8d0b959. Test identities pcde2e (pcdecejakd.11) and pcdeceb (pcdeceb.89); `PCD_HEADLESS=1`, throwaway `PCD_USER_DATA_DIR`. The DRYRUN line now prints the caps the strip shows: x3.4 for a first stake (the intent sizes the settling path, 2.3x the weight), x1.5 for the settling stake.

Run 1, settlement (the settling stake) in block #13632089:

```
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 pending=0x0000000000000000000000000000000000000000 at=14.0s
[a] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.0023 PAS mapsAccount=false caps=deposit:0.1052 PAS,gas:x3.4
[a] STAKED a hash=0xa1c0333bac674a09e80ced7591c055786b42e2a4a386530edb1dca8a70b01cd3 block=13632086 free_before=37.5173 PAS
[b] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.0023 PAS mapsAccount=false caps=deposit:0.1052 PAS,gas:x1.5
[b] STAKED b hash=0x1597bbe98ce25c08a2f4dd7369c124b09a369408dc2232f2f672a64f00d1dd8b block=13632089 free_before=49.8577 PAS
WINNER b pcdeceb.89: BALANCE_WIN before=49.8577 PAS after=50.3557 PAS delta=0.498 PAS expected=(0.4, 0.5] ok=yes
FLIP_OK at=28.0s
```

Run 2, settlement in block #13632105:

```
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 pending=0x0000000000000000000000000000000000000000 at=13.7s
[a] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.0023 PAS mapsAccount=false caps=deposit:0.1052 PAS,gas:x3.4
[a] STAKED a hash=0xb1f00e592883a794a907f0772695507ea6debaebf5d44065ce698dbe09483387 block=13632103 free_before=38.0103 PAS
[b] DRYRUN "Stake 0.5 PAS" ok=true value=0.5 PAS fee=0.0023 PAS mapsAccount=false caps=deposit:0.1052 PAS,gas:x1.5
[b] STAKED b hash=0x00a51cf7e0b3f74d2c02437a9b3d223789907d5fd2781709581b635b2db3701d block=13632105 free_before=51.3557 PAS
WINNER a pcdecejakd.11: BALANCE_WIN before=38.0103 PAS after=38.5034 PAS delta=0.493 PAS expected=(0.4, 0.5] ok=yes
FLIP_OK at=24.5s
```

`npm run check`: 74 files, 614 tests passed; eslint clean; `check:tokens: clean (158 files)`. `PCD_HEADLESS=1 PCD_USER_DATA_DIR=<tmp> npm run smoke`: `SMOKE_OK`.
## M13 (follow-up) (2026-09-24)

### npm run check (last lines)

```
 Test Files  74 passed (74)
      Tests  607 passed (607)
   Start at  01:08:40
   Duration  16.32s (transform 2.73s, setup 1.16s, import 11.36s, tests 35.46s, environment 4ms)

> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (158 files)
```

Exit 0. tsc and eslint print nothing when clean. After the rebase onto main (3ec6c0c, tx limits) the rerun is green again: `Test Files  74 passed (74)`, `Tests  615 passed (615)`, `check:tokens: clean (158 files)`.

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<temp> npm run smoke

```
SMOKE_OK
```

### npm run package, then npm run smoke:packaged

```
profile /var/folders/…/T/pcd-smoke.25AUDs7K7n
SMOKE_OK
AGENT_SELFTEST_OK bot-core started from /Users/shawntabrizi/Documents/GitHub/pcd-m13b/dist/mac-arm64/Polkadot Chat.app/Contents/Resources/app.asar/node_modules/polkadot-chat-agents/index.mjs
```

### npm run e2e:agent:packaged (the package built from this commit's tree)

```

0.3s packaged app /Users/shawntabrizi/Documents/GitHub/pcd-m13b/dist/mac-arm64/Polkadot Chat.app/Contents/MacOS/Polkadot Chat
0.8s claim pcdagentqayd on devnet (engine: fake OpenAI server)
24.1s AGENT_PUBLISHED pcdagentqayd.35 confirmed=true
25.1s AGENT_RUNNING
25.1s SENDER pcdeceb.89
29.0s REQUEST_SENT (no text)
86.1s ACCEPTED devices=1
86.1s BOTINFO kind=1 name=pcdagentqayd.35 commands=help,about,stop
87.1s GREETED "Hello! I am a test agent. Ask me anything."
95.6s ANSWER "Pick a colour." keyboard=[Red, Blue] submissions=1 replies=1
95.6s ANSWER_KEYBOARD
104.2s PRESS_ANSWERED "You picked red." submissions=1 replies=1
104.2s TOTALS replies=3 submissions=4 (the accept and the greeting included) typing=0
104.2s BUDGET_OK one submission per reply
AGENT_OK
```

A first run against a package built from main before any change of this follow-up also printed AGENT_OK (accept at 49 s, same budget), so the asar needed no fix. The accept took 57 s in the run above (the identifier-key wait for a new sender), within the stage limit.

### node scripts/screenshots.mjs --only signup (free port, no PCD_SCREENSHOT_PORT)

```
4.8s [signup] saved signup
SCREENSHOTS_OK in 4.9 s
```

### Not run

- `npm run e2e:agent` (dev) was not rerun: the dev path is unchanged except the /about text and the operator context's model line, which the brain spec covers; the packaged run drives the same steps.
- The full `npm run screenshots` was not rerun (only `--only signup` to prove the free-port path).

## M13 (allowance wait) (2026-09-24)

### npx vitest run src/main/agent/attestation.spec.ts

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

The four cases: no bot-core start while the entry is missing, one start when it shows (with the wait in the log); a failed read is "not yet"; the 120 s timeout (the late text, bot-core stopped, then one check per 60 s, then the start); turning off cancels the wait.

### npm run e2e:agent (fake engine, sender pcdeceb, headless, throwaway profile)

```
1.5s built
3.6s claim pcdagentgjyf on devnet (engine: fake OpenAI server)
28.6s AGENT_PUBLISHED pcdagentgjyf.62 confirmed=true
31.6s AGENT_ATTESTED 2504
31.6s AGENT_RUNNING
31.7s SENDER pcdeceb.89
34.9s REQUEST_SENT (no text)
48.9s ACCEPTED devices=1
48.9s BOTINFO kind=1 name=pcdagentgjyf.62 commands=help,about,stop
48.9s GREETED "Hello! I am a test agent. Ask me anything."
57.5s ANSWER "Pick a colour." keyboard=[Red, Blue] submissions=1 replies=1
57.5s ANSWER_KEYBOARD
66.0s PRESS_ANSWERED "You picked red." submissions=1 replies=1
66.0s TOTALS replies=3 submissions=4 (the accept and the greeting included) typing=0
66.0s BUDGET_OK one submission per reply
AGENT_OK
```

The claim's own wait (createIdentity) took the registration-to-attestation time (about 25 s); the gate then saw the entry at its first read, 2.5 s including the People connection. The script also fails if bot-core's "Starting as" log line comes before the attestation line.

### npm run check

```
 Test Files  75 passed (75)
      Tests  619 passed (619)
check:tokens: clean (158 files)
```

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<throwaway> npm run smoke

```
SMOKE_OK
```

### Not run

- The live timeout path (an agent not attested for 120 s) was not produced on devnet; the spec covers it with fake timers.
- `npm run e2e:agent:packaged` was not run (no packaging change).

## M16 (2026-09-24)

### npm run check (last lines)

```
 Test Files  76 passed (76)
      Tests  666 passed (666)
   Start at  01:58:57
   Duration  16.43s (transform 3.13s, setup 1.21s, import 12.95s, tests 37.29s, environment 4ms)
check:tokens: clean (164 files)
```

Exit 0 (tsc and eslint print nothing when clean).

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<temp> npm run smoke

```
SMOKE_OK
```

### npm run e2e:group2 (parent lines; a = pcdbenchfinb, b = pcdeceb, scratch bot pcdgrprcdzc.61, stopped and deleted after)

```
BOT_CREATE pcdgrprcdzc (scratch PCA_BOTS_DIR, brain echo, allow pcdbenchfinb.54) at=0.0s
BOT_REGISTERED pcdgrprcdzc.61 0x9222ed81b43e2e1927e6956c7e63ff83e2933a6220f1ef151e16f812af3e7057 at=41.8s
PEOPLE a=pcdbenchfinb.54 b=pcdeceb.89 bot=pcdgrprcdzc.61 at=44.8s
CONTACTS_OK a↔b, a↔pcdgrprcdzc.61 at=59.2s
V2_CREATED group=f86340c9-1cac-4286-98a2-27fde23ad3af create_statements=1 b epoch=1 bot joined at=61.9s
ONE_SUBMISSION submissions=1 messages=1 at=62.3s
BOT_REPLY_OK id=48D8496A-F7B7-4233-A494-C93F0BC9CEBF text="Echo: hello bot" bot statements on Topic_1: ChMsgs_1=1 at=63.6s
CARRY_OK b got 3 messages from a's current statement after a restart at=70.2s
REMOVED_LOCKED_OUT submissions=2 b: no entry, epoch=1, a's epoch-2 statements=2 opened=0 at=72.0s
BOT_EPOCH2_OK text="Echo: after b left" on Topic_2 at=73.4s
HISTORY_OK the bot's page brought back id=48D8496A-F7B7-4233-A494-C93F0BC9CEBF ("pcdgrprcdzc.61 shared 1 earlier message") at=75.4s
MIGRATED_OK group=2441e23c-03f5-41c3-a103-6cff52a4cdd0 b kept its v1 row (true) and read a's v2 message at=79.4s
GROUP2_OK at=79.4s
```

Exit 0. An earlier run with a = pcde2e stopped at create: `CREATE2_FAILED Submit failed, account full: submitted expiry 7694170908488693760 < min 18446744069441638400` (docs/decisions.md "## M16", AccountFull).

### npm run e2e:group (v1 unchanged)

```
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 at=8.0s
```

### PCD_HEADLESS=1 npm run screenshots

```
Not captured:
  berlin-day/faucet.png (the Faucet room shows no outcome of "Get 1 PAS")
  berlin-night/faucet.png (the Faucet room shows no outcome of "Get 1 PAS")
SCREENSHOTS_PARTIAL in 147.5 s
```

room-group2.png and group2-members.png were saved in both themes (`.agent-runs/screens/berlin-{day,night}/`). The one miss is faucet.png (flip worker, the devnet faucet gave no outcome); not touched by M16. room-group.png now shows a v2 group made through the UI, and pcdguide.70 answered in it.

### git status --short

Clean after the commit (see the report).

After the rebase onto main (c1b604b) `npm run check` is green again: `Test Files  77 passed (77)`, `Tests  670 passed (670)`, `check:tokens: clean (164 files)`.

## M15a — Attachments on Bulletin (spec 0012): rail, codec, images (2026-09-24)

### npm run check

```
 Test Files  82 passed (82)
      Tests  713 passed (713)
check:tokens: clean (173 files)
```

tsc, vitest, eslint and the token lint all exit 0. New specs: `content.spec.ts` (vectors A and B byte for byte both ways; the SDK decoder refuses kind 250; a later media tag, a wrong chunk count, a 2,049-byte thumbnail and 5 items show the unsupported bubble), `attachmentCrypto.spec.ts` (C1, C2; swap, drop, size change fail; a tampered chunk fails the hash and `crypto.subtle.decrypt` is never called), `attachments.spec.ts` (through the manager: one statement per attachment message, chunks stored before it; a failed upload sends nothing and Retry sends once; a tampered or expired or other-network chunk never becomes a file; thumbnail ≤ 2 KB and the 3,584-byte budget), `bulletin.spec.ts` (devnet-only grant, budget refusal, retry 10/30/90 s, no double store, wrong-hash source skipped), `blurhash.spec.ts`, `fileName.spec.ts`, and the Bulletin count in `diagnostics.spec.ts`.

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<throwaway> npm run smoke

```
SMOKE_OK
```

### npm run e2e:attach

First run (a's Bulletin account had no grant yet: the `//Eve` grant on devnet):

```
[a] [bulletin] devnet: //Eve authorizes 5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT for 100 transactions / 64.0 MB
[a] AUTH_OK account=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT granted=yes (//Eve, devnet) transactions_left=100 bytes_left=67108864 expires_block=1172674
[a] STORED bafk2bzaceb5tzoyovzbceg7bjaenpwyyc4q6b2srnfvr5j76gdt5jvbaiqpwc block=971075 best=yes
[a] SENT id=fae2248c-dd97-4435-9787-f24093a927fd sha256=1c89a9a0… statements_delta=1 messages_delta=1 bulletin_tx_delta=1 status=sent
[b] FETCH_OK … status=ready sources=bitswap sha256=1c89a9a0…
[b] GATEWAY_OK … status=ready sources=gateway sha256=1c89a9a0…
BOT_DESCRIBE_SKIPPED no "M15a" commit on pca desktop/rfc-0003 yet
ATTACH_OK at=38.9s (desktop steps; bot step skipped)
```

(That run drew a 163 KB image; the script now draws 303,840 bytes, as M15.md asks for about 300 KB.) Final run, after the rebase onto main (M16), exit 0:

```
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[a] READY username=pcdecejakd.11 bulletin=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT
[b] READY username=pcdeceb.89 bulletin=5GEPcEE6F6dDEA2aST5AmkYzAzSWxHPjXFNd5tzCSSwb4n75
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 at=5.0s
[a] CHAT_REQUEST_SENT id=005546d4-5530-48ec-8096-e7eb8ed4896c to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11
[a] CONTACT pcdeceb.89 devices=1
[a] AUTH_OK account=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT granted=no (had storage) transactions_left=96 bytes_left=65610057 expires_block=1172674
[a] IMAGE bytes=303840 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] STORED bafk2bzacecaqnw5nunojka33wtpcxwzuyhrium2lkmgsp76lkudl4tsvtnmic block=971145 best=yes
[a] SENT id=b33e264a-c2a7-4de9-8e16-ea2c6ed1b456 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a statements_delta=1 messages_delta=1 bulletin_tx_delta=1 status=sent
[b] FETCH_OK id=b33e264a-c2a7-4de9-8e16-ea2c6ed1b456 status=ready sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a chunks=1 cid0=bafk2bzacecaqnw5nunojka33wtpcxwzuyhrium2lkmgsp76lkudl4tsvtnmic
[b] GATEWAY_OK id=b33e264a-c2a7-4de9-8e16-ea2c6ed1b456 status=ready sources=gateway sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
BOT_DESCRIBE_SKIPPED no "M15a" commit on pca desktop/rfc-0003 yet
[b] EXIT
[a] EXIT
ATTACH_OK at=36.2s (desktop steps; bot step skipped)
```

The bot step is skipped: pca `desktop/rfc-0003` has no "M15a" commit and the fleet runs `cdf564f` (read with `ssh … cat /root/pca-bots/demo/app/REVISION`; nothing on the VPS changed).

In-app check (a scratch CDP script, not in the repo; headless, throwaway profile, identity pcde2e, a fictional contact with no device): the Paperclip picked the 303,840-byte PNG, `prepareImage` kept it (PNG ≤ 1 MiB), blurhash 28 characters, WebP thumbnail 1,934 bytes; "Storing 0 of 1" then `ready` after the store over IPC; the send then failed as it must ("Not sent · Retry": no device); Diagnostics went from `bulletinTransactions: 0` to `1` with `submissions: 0`; `window.desktop.bulletin.fetch(devnet, hash, null)` returned 303,856 bytes from `bitswap`; with another genesis it rejected "This attachment is on another network."

### PCD_HEADLESS=1 npm run screenshots

```
SCREENSHOTS_OK in 87.3 s
```

New: `room-attachment.png` (a received photo with caption, Open and Save…; one downloading with its blurhash, "Downloading 1 of 2"; one of ours "Storing 1 of 2") and `composer-attach.png` (the attach row with the notice and a caption), both themes, in `.agent-runs/screens/berlin-{day,night}/`. `settings-diagnostics.png` shows the new line ("Bulletin transactions (attachments; feeless, not statements) 0").

### git status --short

Clean after the commit (the `.agent-runs` link is removed first).

## M15b — Attachments: files, albums, voice notes, cleanup (2026-09-24)

### npm run check

```
 Test Files  85 passed (85)
      Tests  731 passed (731)
check:tokens: clean (176 files)
```

tsc, vitest, eslint and the token lint exit 0. New or changed specs: `attachments.spec.ts` (a file goes out as `media = file` with its name and the peer decrypts the same bytes; a long name stays within the receiver's 128 bytes; a 2.3 MB file fetches its 2 MB chunk gateway first and its 300 KB chunk bitswap first; an album of 4 is one message, one statement, four stores, four keys; a fifth image, a mixed pick, an empty or 25 MB+ pick are refused; a voice note over 5 minutes is refused and 5:00 goes; a voice note carries its duration and 32-bar waveform, no name), `voice.spec.ts` (waveform peaks 0–255, silence stays 0), `files.spec.ts` ("Open" copies removed at quit, only this process's), `bulletin.spec.ts` (source order), `scripts/lib/botDescribe.spec.mjs` (the M15a greeting, the welcome and the live refusal all fail; a description passes).

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<throwaway> npm run smoke

```
SMOKE_OK
```

### PCD_HEADLESS=1 npm run e2e:attach — exit 1 (BOT_DESCRIBE_FAILED)

Every desktop step passes (FILE_OK, ALBUM_OK, VOICE_OK). The bot step fails, as it now must: pcdguide.70 (fleet REVISION 587159f) fetched the image and answered that it cannot view images without tools. The stricter check is right; the fleet is not set up to describe (docs/questions.md "## M15b"). No `ATTACH_OK` line is printed. `[bulletin]` log lines left out.

```
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b
[a] READY username=pcdecejakd.11 bulletin=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT
[b] READY username=pcdeceb.89 bulletin=5GEPcEE6F6dDEA2aST5AmkYzAzSWxHPjXFNd5tzCSSwb4n75
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 at=3.6s
[a] CHAT_REQUEST_SENT id=4dba3f55-b0f8-4266-ae2d-998fc8ab303b to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11
[a] CONTACT pcdeceb.89 devices=1
[a] AUTH_OK account=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT granted=no (had storage) transactions_left=81 bytes_left=58949460 expires_block=1172674
[a] IMAGE bytes=303840 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] STORED bafk2bzacebu7hahswv5ptyi3om2ehthgqzm3q7anqqigfhlqbc2wt7zpw5aae block=971575 best=yes
[a] SENT id=23615e64-635c-4dab-b1ae-3790ab594d6b sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a statements_delta=1 messages_delta=1 bulletin_tx_delta=1 status=sent
[b] FETCH_OK id=23615e64-635c-4dab-b1ae-3790ab594d6b status=ready sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a chunks=1 cid0=bafk2bzacebu7hahswv5ptyi3om2ehthgqzm3q7anqqigfhlqbc2wt7zpw5aae
[b] GATEWAY_OK id=23615e64-635c-4dab-b1ae-3790ab594d6b status=ready sources=gateway sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] STORED bafk2bzacecn45d3eitdvghx4tlhjnoa5cymv44n6avhsvyoz733ou3uvu54fs block=971580 best=yes
[a] STORED bafk2bzaceac6bdzgqvnw7pbul25kjplpigeh44nyj726c6ucy4ck3fh65lyjm block=found-by-content-hash best=yes
[a] FILE_SENT id=d85bd27f-08ab-4060-82b7-2b322bbf5354 sha256=e5c438377f408ceb44ea932b1484f584cc0ca3182db90789a061f64aaddc1163 size=2300000 name=m15b-e2e-archive.bin mime=application/octet-stream chunks=2 statements_delta=1 bulletin_tx_delta=2
[b] FILE_OK id=d85bd27f-08ab-4060-82b7-2b322bbf5354 name=m15b-e2e-archive.bin media=file size=2300000 order=gateway-first,bitswap-first sources=gateway,bitswap sha256=e5c438377f408ceb44ea932b1484f584cc0ca3182db90789a061f64aaddc1163
[a] STORED bafk2bzaced3rhbd7ngkoiwx2u5d4ongq6oshq4xe2qtklf2mbkesbsgmrv22e block=971591 best=yes
[a] STORED bafk2bzacecdbqriu7jymi2wctucpjir45dgo7upq3jqtgu25mko5widpzl4ps block=971592 best=yes
[a] STORED bafk2bzacebzq75bv6uykm7hthnfocoy2ebqk27zuxcksrfsah6o6lchek7veo block=971593 best=yes
[a] STORED bafk2bzacede7rvr7kqod67jl5t55v6rq5z52qe4anbmentg6axie2ie6zdwru block=971595 best=yes
[a] ALBUM_SENT id=cd21e69e-4a9d-4bab-9452-9205217f45f6 sha256=b37080031ed4d58e3d79abdcceff0230f3443236bf3745fd93f4e8538da0afd4,810421120a7b917a8952434f8a6637156cc644562fbc25f8148d9c8a20fbfdff,8616167072ab7c08293f78eb04a67176264ef87d129227071e66212a4b4ce862,a6c3d73529834fdcdab0185748d46acf172c8d75bfa909d310b6b168eeda275a items=4 statements_delta=1 bulletin_tx_delta=4
[b] ALBUM_OK id=cd21e69e-4a9d-4bab-9452-9205217f45f6 items=4 kinds=image,image,image,image caption="M15b: an album of four" sources=bitswap,bitswap,bitswap,bitswap ready=4
[a] STORED bafk2bzacecdj6jiokwgab7iud4ysjaso5owkzzo72tflljs3pes4ijffclaa6 block=971596 best=yes
[a] VOICE_SENT id=eb64d63c-61a0-4a9a-b8a1-ab5ef89d5396 sha256=503c5b1b2fe747e3e7e0b76aeba77f19b1ea043811a35c220e00fabc3dcdd30a size=180000 duration_ms=60000 bars=32 mime="audio/webm; codecs=opus" over_5min_refused=yes statements_delta=1 bulletin_tx_delta=1
[b] VOICE_OK id=eb64d63c-61a0-4a9a-b8a1-ab5ef89d5396 media=voice duration_ms=60000 bars=32 mime="audio/webm; codecs=opus" sources=bitswap sha256=503c5b1b2fe747e3e7e0b76aeba77f19b1ea043811a35c220e00fabc3dcdd30a
[a] BOT_CONTACT pcdguide.70 greeting_before_send=yes
[a] STORED bafk2bzacecrspjkktlsbtzazwglndbalrls7h5ouk7wak6zx5zw65ybmnaabo block=971601 best=yes
[a] BOT_ROW system at=2026-09-24T06:57:45.771Z id=accepted:7c92282a-60f2-497d-a907-eba5e3e813ec "contactAdded"
[a] BOT_ROW system at=2026-09-24T06:57:45.772Z id=bot-greeting:0x98e64752115957c142e941a39adf7bcf9b479c51d6d9eb9955ea39741058ad06 "botGreeting"
[a] BOT_ROW incoming at=2026-09-24T06:57:48.955Z id=0316424C-55AF-4AF3-8758-AF3095B10FB0 (before) "Hey! 👋 I'm your Polkadot support guide—feel free to ask me anything about staking, governance, para"
[a] BOT_ROW outgoing at=2026-09-24T06:57:49.540Z id=fe5b26fc-5fff-4dcf-b03a-e77099e83799 "attachment"
[a] BOT_ROW incoming at=2026-09-24T06:58:14.044Z id=814FFDDC-4544-4EFB-A879-CBEA7F6382EA "I can't view images without tools—the operator can enable them with `/tools read,web`."
[a] BOT_DESCRIBE_FAILED bot=pcdguide.70 attachment=fe5b26fc-5fff-4dcf-b03a-e77099e83799 reply=814FFDDC-4544-4EFB-A879-CBEA7F6382EA reply_type=text text="I can't view images without tools—the operator can enable them with `/tools read,web`."
bot describes the image: BOT_DESCRIBE_FAILED bot=pcdguide.70 attachment=fe5b26fc-5fff-4dcf-b03a-e77099e83799 reply=814FFDDC-4544-4EFB-A879-CBEA7F6382EA reply_type=text text="I can't view images without tools—the operator can enable them with `/tools read,web`."
```

The one `block=found-by-content-hash`: a 2 MB chunk took longer than the 60 s wait to reach a best block (a probe measured 41 s for one 2 MB store alone); the `TransactionByContentHash` check then found it stored, and nothing was sent twice.

An earlier run with the first version of the bot check (the bot's first text after the attachment) failed on the bot's welcome, sent 2 s after the attachment: "Welcome! 👋 I'm your Polkadot support guide—ask me anything about staking, governance, the Polkadot app, or Polkadot in general!". Its real answer came 44 s later: "I can't see images—tools are disabled. The operator can enable image viewing with `/tools read,web`." The check now skips texts that do not describe until a description or a refusal comes.

### npm run screenshots -- --only room-attachment,composer-attach,room-file,room-album,room-voice

```
PNGs:
  .agent-runs/screens/berlin-day/room-attachment.png
  .agent-runs/screens/berlin-night/room-attachment.png
  .agent-runs/screens/berlin-day/room-file.png
  .agent-runs/screens/berlin-night/room-file.png
  .agent-runs/screens/berlin-day/room-album.png
  .agent-runs/screens/berlin-night/room-album.png
  .agent-runs/screens/berlin-day/room-voice.png
  .agent-runs/screens/berlin-night/room-voice.png
  .agent-runs/screens/berlin-day/composer-attach.png
  .agent-runs/screens/berlin-night/composer-attach.png
SCREENSHOTS_OK in 15.5 s
exit=0
```

Reviewed by the agent: `room-file` shows a received PDF row ("Download · 2.2 MB") and a sent ZIP row with Open and Save…; `room-album` a received 2×2 grid and a sent grid of 3 (first image across the top), one caption each; `room-voice` a received voice note playing ("0:01 / 0:04", played bars dark) and a sent one. The voice bytes were recorded in the page by MediaRecorder (WebM/Opus, 4 s of a tone), so the player played a real recording. Full `npm run screenshots` not run (only the attachment shots changed).

### Not run

- **Recording from a real microphone.** In a headless Electron here, `getUserMedia` waits for the macOS microphone permission and never resolves (a probe with `--use-fake-device-for-media-stream` hung too). The recorder's parts were checked instead: `MediaRecorder` with `audio/webm;codecs=opus` at 24 kbps records and `decodeAudioData` reads it back (2 s → 6,248 bytes, 1.92 s decoded; Electron 44.4.1), and the `room-voice` shot records and plays through the same APIs. The mic button and strip were not pressed in a shot.
- **Packaged app** (`npm run package`): not run; `electron-builder.yml` gains `NSMicrophoneUsageDescription`.

### git status --short

(clean after the commit)

## M16b — Groups v2 supergroup features (spec 0011) (2026-09-24)

### npm run check (last lines; after the rebase onto M15b)

```
 Test Files  87 passed (87)
      Tests  760 passed (760)
   Start at  03:07:29
   Duration  16.47s (transform 2.99s, setup 1.23s, import 13.86s, tests 44.00s, environment 4ms)
check:tokens: clean (181 files)
```

Exit 0 (tsc and eslint print nothing when clean).

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<temp> npm run smoke

```
SMOKE_OK
```

### npm run e2e:group2b (parent lines; a = pcdbenchfinb, b = pcdbenchfina, scratch bot from pca 587159f, stopped and deleted after)

```
BOT_CREATE pcdgrpkfhrm (scratch PCA_BOTS_DIR, brain echo, allow pcdbenchfinb.54) at=0.0s
BOT_REGISTERED pcdgrpkfhrm.16 0x36f9b4ac29f2a64632f3241fdbdcdd7679e1890b75637b48dd9d5f45027a334a at=61.3s
PEOPLE a=pcdbenchfinb.54 b=pcdbenchfina.25 bot=pcdgrpkfhrm.16 at=64.1s
GROUP_READY group=a2d97231-467f-4371-951a-dd53a7244cee a=277ac94f-bc9d-4606-832f-a4e3ff4ef2ed bot=889B9CD6-40B9-4F7D-99F4-1EC84F757D62 at=77.9s
JOIN_APPROVED policy=1 a accepted the chat request itself (auto-accepted), b heard pending, approve cost 2 submissions (the state; the welcome and the history ride the DM), b epoch=1 at=82.1s
HISTORY_OK b has both earlier messages and the line "History shared by pcdbenchfinb.54" at=83.1s
PIN_OK cost 1 statement(s); b's state pins 1 at=84.4s
SLOW_OK b's second message waited (0 submissions in 3 s), a hid the forged one, the held one reached a 11.6 s after the first at=97.3s
PROMOTED_OK cost 1 statement(s); b is admin with flags 0xbf at=99.0s
BOT_REMOVED_OK by b in 2 submissions; a epoch=2 members=2 signer=b (pcdbenchfina.25); bot: {"time":"2026-09-24T07:03:16.492Z","event":"BOT_GROUP2_KEY_R at=100.2s
GROUP2B_OK at=100.2s
```

Exit 0. The child lines of the slow-mode step, for the record:

```
[a] SENT2 id=277ac94f-bc9d-4606-832f-a4e3ff4ef2ed at=1790233372897 status=sent submissions=1
[a] INVITE link=<not echoed> policy=1 invites=1 statements=1
[b] JOIN_SENT group=a2d97231-467f-4371-951a-dd53a7244cee status=requested contact_before=false
[a] JOIN_QUEUED from=pcdbenchfina.25 contact=auto-accepted
[b] JOIN_STATUS pending
[a] APPROVED submissions=2 members=3
[a] SETTINGS_DONE statements=1 slow=10 history=100 policy=1
[b] SENT2 id=7d853c4b-1d22-48b3-8d5d-1f1f61620393 at=1790233382058 status=sent submissions=1
[b] HELD submissions=0 status=sending
[a] GOT_TEXT id=7d853c4b-1d22-48b3-8d5d-1f1f61620393 received=1790233385362 text="slow one"
[b] FORGED id=forged-1790233385363
[a] HIDDEN id=forged-1790233385363
[a] GOT_TEXT id=310ef397-1441-4bb0-9617-b6a08c11a4eb received=1790233393659 text="slow two"
```

### npm run e2e:group2 (M16 regression on the final code: epoch keys now come from the `keys` table)

```
V2_CREATED group=bdda7d32-1d87-4301-bf58-cdef10ea2813 create_statements=1 b epoch=1 bot joined at=57.4s
ONE_SUBMISSION submissions=1 messages=1 at=57.8s
BOT_REPLY_OK id=30CF6788-1227-40D4-98AA-0150EA270E07 text="Echo: hello bot" bot statements on Topic_1: ChMsgs_1=1 at=59.1s
CARRY_OK b got 3 messages from a's current statement after a restart at=65.5s
REMOVED_LOCKED_OUT submissions=2 b: no entry, epoch=1, a's epoch-2 statements=2 opened=0 at=67.0s
BOT_EPOCH2_OK text="Echo: after b left" on Topic_2 at=68.3s
HISTORY_OK the bot's page brought back id=30CF6788-1227-40D4-98AA-0150EA270E07 ("History shared by pcdgrpwstbe.66") at=69.3s
MIGRATED_OK group=ab29a535-43a1-4d96-81b8-ca5a00827af1 b kept its v1 row (true) and read a's v2 message at=74.3s
GROUP2_OK at=74.3s
```

### npm run e2e:group (v1 unchanged; last lines)

```
[a] EXIT
[b] EXIT
GROUP_OK at=20.3s
```

### Screenshots (PCD_SCREENSHOT_IDENTITY=.agent-runs/identity-pcdbenchqmwk/identity.json node scripts/screenshots.mjs --only room-pinned,group-invite,group-roles,room-group2,group2-members)

```
PNGs:
  .agent-runs/screens/berlin-day/room-group2.png
  .agent-runs/screens/berlin-night/room-group2.png
  .agent-runs/screens/berlin-day/room-pinned.png
  .agent-runs/screens/berlin-night/room-pinned.png
  .agent-runs/screens/berlin-day/group-invite.png
  .agent-runs/screens/berlin-night/group-invite.png
  .agent-runs/screens/berlin-day/group-roles.png
  .agent-runs/screens/berlin-night/group-roles.png
  .agent-runs/screens/berlin-day/group2-members.png
  .agent-runs/screens/berlin-night/group2-members.png
SCREENSHOTS_OK in 10.0 s
```

The main worker ran as pcdbenchqmwk instead of its default pcde2e, so this run could not collide with another agent's pcde2e run. All five shots are fixtures.

### npm run package (the URL scheme in the bundle)

```
  • building        target=DMG arch=arm64 file=dist/Polkadot Chat-0.1.0-arm64.dmg
$ plutil -extract CFBundleURLTypes json -o - "dist/mac-arm64/Polkadot Chat.app/Contents/Info.plist"
[{"CFBundleTypeRole":"Editor","CFBundleURLName":"Polkadot Chat invite link","CFBundleURLSchemes":["polkadotapp"]}]
```

The built bundle was never opened. LaunchServices had listed it on its own; it was unregistered (`lsregister -u`) and `dist/` deleted, and no handler for `polkadotapp` is set on this Mac afterwards.

### Not run

- Opening a `polkadotapp://g#…` link from another app into the packaged app: that needs the packaged app installed as the scheme's handler on the owner's Mac (see docs/questions.md "## M16b", first item). The routing is covered by `src/main/inviteLinks.spec.ts` and the paste path by the join view.

## M15c — Attachments: video, resend on request, keys table, quota panel (2026-09-24)

### npm run check (last lines)

```
 Test Files  89 passed (89)
      Tests  779 passed (779)

> polkadot-chat-desktop@0.1.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (187 files)
```

tsc, vitest, eslint and the token lint exit 0. New specs: `attachmentKeyStore.spec.ts` (a new attachment row holds no key or nonce, the `keys` row holds them sealed, a download gets them back; an album has one sealed key per item; the migration moves the keys of an M15b row once; a copied folder without the at-rest key opens nothing; a key moved to another message does not open; tombstone and Clear history take the keys, epoch keys stay), `storageQuota.spec.ts` (today's share is what was left at the start of the day over the days to the refill and does not shrink while uploading; the last day gets all that is left; only broadcast chunks count and a new day starts at zero; Free space drops old received copies, marks them `freed`, and never drops our own), `attachments.spec.ts` additions (an album is one store call with 4 keys and 4 nonces; resend re-stores the same chunk hashes the message names with no new statement and the peer fetches again; a resend of a live file broadcasts nothing; a changed local file is refused; Ask to resend sends `Please resend [plan v2.pdf](#resend/old-file)` and keeps retrying past the expiry; a video goes out with its size, duration and poster and does not auto-download; a retried attachment message carries the real key though the row holds none), `bulletin.spec.ts` (the quota numbers; the day meter counts only broadcast chunks), `content.spec.ts` (the preview of an Ask to resend), `botDescribe.spec.mjs` (`toolsOff` excuses only a tools-off refusal).

### npm run smoke (PCD_HEADLESS=1, throwaway PCD_USER_DATA_DIR)

```
✓ built in 196ms
SMOKE_OK
```

### npm run e2e:attach (devnet; a = pcde2e, b = pcdeceb; exit 0)

`STORED` lines and the child's stderr are left out.

```
[b] SELF pcdeceb.89 0x8a2444c042d4e4fdc8b2355362baa1c853e66ac6963c4d170cfed31b5c4a805b
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[b] READY username=pcdeceb.89 bulletin=5GEPcEE6F6dDEA2aST5AmkYzAzSWxHPjXFNd5tzCSSwb4n75
[a] READY username=pcdecejakd.11 bulletin=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT
PEOPLE a=pcdecejakd.11 b=pcdeceb.89 at=4.1s
[a] CHAT_REQUEST_SENT id=bb7b8bbc-f847-48ca-a632-568c0a965bca to=pcdeceb.89
[b] ACCEPTED pcdecejakd.11
[a] CONTACT pcdeceb.89 devices=1
[a] AUTH_OK account=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT granted=no (had storage) transactions_left=72 bytes_left=55808159 expires_block=1172674
[a] IMAGE bytes=303840 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] STORED bafk2bzacebqrdgveztwgxauk3bwmag2iq4a567tkcc5726kakdkgg7pk2mz2g block=972470 best=yes
[a] SENT id=2e92bbd0-234e-4bf7-ae91-180445ce119b sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a statements_delta=1 messages_delta=1 bulletin_tx_delta=1 status=sent
[b] FETCH_OK id=2e92bbd0-234e-4bf7-ae91-180445ce119b status=ready sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a chunks=1 cid0=bafk2bzacebqrdgveztwgxauk3bwmag2iq4a567tkcc5726kakdkgg7pk2mz2g
[b] GATEWAY_OK id=2e92bbd0-234e-4bf7-ae91-180445ce119b status=ready sources=gateway sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] STORED bafk2bzacedcmqiw7mxmmcgaq7vli2ulggjpp243usdbfhsbsmkkn5itetb7hw block=972474 best=yes
[a] STORED bafk2bzaceb3szt72266ca3robauwvck37zbonfh2efnrew7vrwrs2nqudfxyk block=972474 best=yes
[a] FILE_SENT id=17b820a9-a4be-42d1-913d-348b2be161a6 sha256=e5c438377f408ceb44ea932b1484f584cc0ca3182db90789a061f64aaddc1163 size=2300000 name=m15b-e2e-archive.bin mime=application/octet-stream chunks=2 statements_delta=1 bulletin_tx_delta=2
[b] FILE_OK id=17b820a9-a4be-42d1-913d-348b2be161a6 name=m15b-e2e-archive.bin media=file size=2300000 order=gateway-first,bitswap-first sources=gateway,bitswap sha256=e5c438377f408ceb44ea932b1484f584cc0ca3182db90789a061f64aaddc1163
[a] STORED bafk2bzacec7lnp2atkkuphbkcy5mijzwqhezhramqjpfc3ipf74cgu3n52fhy block=972484 best=yes
[a] STORED bafk2bzacebsehxaa64ne3ga646subqqbvcvgun3hppdpa5ydxjemuush5cqkk block=972484 best=yes
[a] STORED bafk2bzacebsy2we6567hjpm5dilv7hc22bywuk4hzkmnxyuixz6sbrteozasq block=972484 best=yes
[a] STORED bafk2bzacedgq7tbpapxeczftillfpenbjdqbngom2iuatk55pm7by5346hidm block=972484 best=yes
[a] ALBUM_SENT id=bae61be6-092f-4340-9bff-3960aafdb263 sha256=b37080031ed4d58e3d79abdcceff0230f3443236bf3745fd93f4e8538da0afd4,810421120a7b917a8952434f8a6637156cc644562fbc25f8148d9c8a20fbfdff,8616167072ab7c08293f78eb04a67176264ef87d129227071e66212a4b4ce862,a6c3d73529834fdcdab0185748d46acf172c8d75bfa909d310b6b168eeda275a items=4 statements_delta=1 bulletin_tx_delta=4 store_calls=1
[b] ALBUM_OK id=bae61be6-092f-4340-9bff-3960aafdb263 items=4 kinds=image,image,image,image caption="M15b: an album of four" sources=bitswap,bitswap,bitswap,bitswap ready=4
[a] STORED bafk2bzacedjue7dcob6dmi2ufcm37jt454hyquah74whimbegkciadd4mqc4i block=972485 best=yes
[a] VOICE_SENT id=d53e8a42-6620-436c-b754-9a882e24a6fc sha256=503c5b1b2fe747e3e7e0b76aeba77f19b1ea043811a35c220e00fabc3dcdd30a size=180000 duration_ms=60000 bars=32 mime="audio/webm; codecs=opus" over_5min_refused=yes statements_delta=1 bulletin_tx_delta=1
[b] VOICE_OK id=d53e8a42-6620-436c-b754-9a882e24a6fc media=voice duration_ms=60000 bars=32 mime="audio/webm; codecs=opus" sources=bitswap sha256=503c5b1b2fe747e3e7e0b76aeba77f19b1ea043811a35c220e00fabc3dcdd30a
[a] STORED bafk2bzacedmjqeeucdn43pn65rpmju7xoxdrfsbsfwawtlnly6hmyo74eldwe block=972487 best=yes
[a] VIDEO_SENT id=2fc7a219-5a5c-4729-8cd2-3621e03f7ddd sha256=20326262cf202f0e3797b7d95f6f7e9e244a414fa1efc9a4cac1acc25e92ff37 size=900000 media=video 640x360 duration_ms=7500 chunks=1 statements_delta=1 bulletin_tx_delta=1
[b] VIDEO_OK id=2fc7a219-5a5c-4729-8cd2-3621e03f7ddd media=video 640x360 duration_ms=7500 name=m15c-e2e-clip.webm poster=blurhash(28) order=gateway-first sources=gateway sha256=20326262cf202f0e3797b7d95f6f7e9e244a414fa1efc9a4cac1acc25e92ff37
[b] RESEND_ASKED id=2e92bbd0-234e-4bf7-ae91-180445ce119b freed_files=8 freed_bytes=3737317 local=freed/no-bytes text="Please resend [the photo](#resend/2e92bbd0-234e-4bf7-ae91-180445ce119b)" statements_delta=1
[a] STORED bafk2bzacebqrdgveztwgxauk3bwmag2iq4a567tkcc5726kakdkgg7pk2mz2g block=already-on-chain best=yes
[a] RESENT id=2e92bbd0-234e-4bf7-ae91-180445ce119b request="Please resend [the photo](#resend/2e92bbd0-234e-4bf7-ae91-180445ce119b)" chunks=1 submitted=0 cids_same=yes cid0=bafk2bzacebqrdgveztwgxauk3bwmag2iq4a567tkcc5726kakdkgg7pk2mz2g statements_delta=0
[b] RESEND_OK id=2e92bbd0-234e-4bf7-ae91-180445ce119b status=ready cid0=bafk2bzacebqrdgveztwgxauk3bwmag2iq4a567tkcc5726kakdkgg7pk2mz2g sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[a] BOT_CONTACT pcdguide.70 greeting_before_send=yes
[a] STORED bafk2bzacedflr5g3s5ybqri4zjb2ijbhlfc5wytjbeb3ur2bnw3p7selvyrlk block=972495 best=yes
[a] BOT_DESCRIBE_PENDING_OPERATOR tool_policy=none bot=pcdguide.70 attachment=fa9cde97-018a-4f49-861b-b454a4fca4a0 reply=D7EE9795-EE7D-47B2-A5FE-0AD75271DAEE reply_type=text text="I can't see images—tools are disabled. The operator can enable them with `/tools read,web`."
WARNING BOT_DESCRIBE_FAILED treated as pending: the bot's tool policy is "none" (pcdguide.70); enable read tools on the fleet to pass it
[a] EXIT
[b] EXIT
ATTACH_OK FILE_OK ALBUM_OK VOICE_OK VIDEO_OK RESEND_OK bot=pending-operator at=175.5s
```

VIDEO_OK: 900,000 bytes as `video/webm`, one chunk, fetched gateway first (over 512 KB). The album went out in one store call (`store_calls=1`, 4 Bulletin transactions). RESEND_OK: b's Free space (0 days) dropped 8 received copies, its image row became `freed`; the Ask to resend cost one statement; a found the request by its link and re-stored the image: the same chunk hash as the message (`cids_same=yes`), `submitted=0` because devnet still holds the chunk (14 days), no statement; b fetched it again by the same CID (bitswap) with the same SHA-256. The bot step: pcdguide.70 still answers "tools are disabled" (fleet tool policy "none", review M15b), so the run prints the warning and `bot=pending-operator`; the fleet was only read.

### npm run screenshots -- --only room-video,settings-storage,room-attachment,room-album,room-file,composer-attach

```
PNGs:
  .agent-runs/screens/berlin-day/room-attachment.png
  .agent-runs/screens/berlin-night/room-attachment.png
  .agent-runs/screens/berlin-day/room-file.png
  .agent-runs/screens/berlin-night/room-file.png
  .agent-runs/screens/berlin-day/room-album.png
  .agent-runs/screens/berlin-night/room-album.png
  .agent-runs/screens/berlin-day/room-video.png
  .agent-runs/screens/berlin-night/room-video.png
  .agent-runs/screens/berlin-day/composer-attach.png
  .agent-runs/screens/berlin-night/composer-attach.png
  .agent-runs/screens/berlin-day/settings-storage.png
  .agent-runs/screens/berlin-night/settings-storage.png
SCREENSHOTS_OK in 22.5 s
```

`room-video` was taken again after a layout change (`SCREENSHOTS_OK in 13.7 s`). Reviewed by the agent: room-video shows a received video's poster (WebP from a real recorded frame), play mark, 0:03 and "Download · 327 KB"; our sent video in the stock inline player (a real WebM/VP8 recorded in the page from a canvas); an expired PDF with "Attachment expired" and "Ask to resend"; the peer's "Please resend the photo" with our "Resend the photo". settings-storage shows the live devnet authorization of pcde2e's Bulletin account (49.4 MB of 64.0 MB, 62 of 100 transactions, refills 8 October 2026 at block #1,172,674), uploads today 3 (1.4 MB) of today's share 4 (3.6 MB) (fixture count), local copies and Free space. The fixture rows are written with inline keys, so the app's start migrated them (the bubbles opened their keys from the `keys` table).

### Not run

- `room-voice`: not captured on this machine. The page's AudioContext clock stood still (`currentTime` 0.008 s after 4 s), so the fixture recording was a 110-byte header. The script now records through a silent sink (`sinkId: { type: 'none' }`), which gives a real 12 KB WebM/Opus file, but the `<audio>` element's playback clock also stands still (`currentTime` 0 while playing, no output device), so the shot's "0:01 / 0:04" check fails. Nothing in the voice code changed in M15c; this is the Mac's audio output, not the app.
- `prepareVideo` (the sender's poster, size and duration from a picked file) did not run: it needs a DOM `<video>` (not in vitest), and a send from the app would store on devnet for a fictional contact. The `room-video` fixture makes its poster in the page with the same steps (one frame, WebP ≤ 2 KB); the wire, the service and the receiver's player are tested (unit tests, VIDEO_OK, the screenshot).

## M14 — DAO chat, desktop half: tx buttons in v2 groups, the proposal card (2026-09-24)

Every app launch set `PCD_HEADLESS=1` and a throwaway `PCD_USER_DATA_DIR`.

### npm run check (last lines, after the rebase onto M15c)

```
 Test Files  91 passed (91)
      Tests  794 passed (794)
check:tokens: clean (191 files)
```

Exit 0 (tsc and eslint print nothing when clean).

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<temp> npm run smoke

```
SMOKE_OK
```

### npm run e2e:dao -- --pca <fresh worktree of pca origin/desktop/rfc-0003 at fb7d400>

DAO_E2E_PENDING devnet identity backend and statement allowance too slow on 2026-09-24: the scratch bot's allowance was not granted in time, so its /propose answer was rejected `noAllowance`.

The furthest run (a = pcdrevchibacbfcc, b = pcdbenchzzlx, scratch bot stopped and deleted after), parent and child lines:

```
BOT_CREATE pcddaoqsmjn (scratch PCA_BOTS_DIR, brain echo, public) at=2.0s
BOT_REGISTERED pcddaoqsmjn.31 0x22d55ff214cae5d3779ed934d7fe6f68705848ee8149fd77a893b339f1b0da61 at=22.6s
BOT_FUNDED 2 PAS from //Alice block=13638073
[a] SELF pcdrevchibacbfcc.48 0x94d0c766c915b5bf88018bbaf9fbadcbef926c724c5e2aa8a04575fcce10a807
[b] SELF pcdbenchzzlx.23 0xe6c783b9ddb9785600bcfc065d12fef7b053844a8131ba36eda2160cf67a4a7e
[a] READY username=pcdrevchibacbfcc.48 free=25PAS
[b] READY username=pcdbenchzzlx.23 free=36.9167PAS
PEOPLE a=pcdrevchibacbfcc.48 (25PAS) b=pcdbenchzzlx.23 (36.9167PAS) bot=pcddaoqsmjn.31 at=29.4s
[a] REQUEST_SENT id=0fb5b2a2-050c-436f-9797-ffd6b1e84ca7
[b] ACCEPTED pcdrevchibacbfcc.48
[a] CONTACT pcdbenchzzlx.23
[a] BOT_CONTACT pcddaoqsmjn.31
[a] GROUP2_CREATED id=ed34b4cf-d05f-4689-8ab6-c45d7f736adc
[b] JOINED2 id=ed34b4cf-d05f-4689-8ab6-c45d7f736adc epoch=1
[a] PROMOTED submissions=1
GROUP_READY group=ed34b4cf-d05f-4689-8ab6-c45d7f736adc bot admin (1 statement) treasury +0.5 PAS from //Alice block=13638079 at=95.3s
[a] SENT2
E2E_TIMEOUT a sends /propose
```

Exit 13. The failing step is PROPOSED. The bot did its chain part and failed at the statement:

```
BOT_DAO_MEMBERS_SET add=2 ok=true block=13638081
BOT_DAO_PROPOSED id=4 (on chain)
BOT_GROUP2_SEND_FAILED statement_submit rejected: noAllowance
BOT_DAO_COMMAND_FAILED command=propose statement_submit rejected: noAllowance
BOT_DAO_CLOSED id=4 result=rejected voters=0
BOT_DAO_POST_FAILED id=4 statement_submit rejected: noAllowance
```

A People-chain read 10 min after this bot's registration still showed no `:statement_allowance:` for it; the bots of the earlier runs had one (`0x3200000000d00700`). Also, the parent timed out on `[a] SENT2` only because the child printed `SENT2` with no field while the parent waits for `SENT2 `; the child now prints `SENT2 ok` (the timeout would have come from the missing proposal anyway).

Other runs on 2026-09-24, in order:
- a = pcdbenchfinb, b = pcdbenchfina (the brief's pair): `CREATE2_FAILED Your account’s space on the network is full of chat statements` (AccountFull), twice. The first of these also had `BOT_FUND_FAILED every dev account failed` (Asset Hub dwellir endpoint stalled for minutes; "not in a best block after 90000 ms"). a = pcdbenchfina: the same AccountFull.
- a = pcdrevchibacbfcc, b = pcdbenchzzlx: once the funding stalled again (every dev account); after run 5, three runs ended `BOT_CREATE_FAILED registered=false`: the identity backend did not confirm the new bot in 180 s. A probe bot made by hand confirmed after 22 min. The last run was stopped by the coordinator during the new 30 min registration wait.

After run 5 the script waits for the bot's allowance before the people start and asks `pca register` again for up to 30 min. These changes are not proved live yet.

### Screenshots (npm run screenshots -- --only room-dao)

```
0.6s built
1.8s [main] seeded pcdecejakd.11
6.8s [main] fixture written
9.0s [main] saved room-dao

PNGs:
  .agent-runs/screens/berlin-day/room-dao.png
  .agent-runs/screens/berlin-night/room-dao.png
SCREENSHOTS_OK in 9.0 s
```

Both themes checked by eye: the pin bar reads "Proposal #3: Buy seeds for the spring beds · Voting closes in 41 min 54 s"; the card shows the tally, the clock, "You voted yes", both vote buttons and "View on Subscan"; a member's vote reference follows.

### Not run

- DAO_OK: see DAO_E2E_PENDING above. The contract and bot half is proved live in pca (`DAO_LIVE_OK`, docs/spec/contracts/dao.md).

## M18 — Profiles: several identities on one Mac (2026-09-24)

Every app launch below ran with `PCD_HEADLESS=1` and a throwaway `PCD_USER_DATA_DIR`.

### npm run check

```
 Test Files  94 passed (94)
      Tests  832 passed (832)
check:tokens: clean (196 files)
```

(tsc and eslint printed nothing.)

### npm run smoke (PCD_HEADLESS=1 PCD_USER_DATA_DIR=$(mktemp -d -t pcd-m18-smoke))

```
✓ built in 219ms
SMOKE_OK
```

The root afterwards held `profiles` and `profiles.json` only.

### npm run e2e:profiles

```
0.5s built
1.6s both profiles show sign-up
58.4s signed up b: pcdprofbkmzj.72 confirmed=true
158.4s signed up a: pcdprofakmzj.90 confirmed=true
PROFILES_CREATED a=pcdprofakmzj.90 b=pcdprofbkmzj.72 profiles=default,b,a
IDENTITY_OK a=pcdprofakmzj.90 b=pcdprofbkmzj.72
RUNNING_OK a sees a:running default:closed b:running
LOCK_OK second start of a exited code=0 (PROFILE_ALREADY_OPEN)
179.7s search attempt 1: "No results for “pcdprofakmzj”"
180.7s b sent a request to pcdprofakmzj.90
REQUEST_OK a received "Hello from profile b (jycrye)" from pcdprofbkmzj.72
182.7s b sent "Second message from b (jycrye)"
PROFILES_OK a=pcdprofakmzj.90 received 2 messages from b=pcdprofbkmzj.72 in 183 s
```

The first run (before the search retry) passed PROFILES_CREATED, IDENTITY_OK, RUNNING_OK and LOCK_OK and ended `PROFILES_FAIL b did not find pcdprofapubh.03 by search`: the search asks the backend once per pause in typing, and the new name was not listed yet. The script now types the name again every 20 s (the run above needed one retry).

### npm run package, then npm run smoke:packaged

```
  • building block map  blockMapFile=dist/Polkadot Chat-0.1.0-arm64.dmg.blockmap
(npm run package: exit 0)
profile /var/folders/_1/q03733qd0pv42n1dvkcvyx0c0000gn/T/pcd-smoke.vOqfAb9ywh
PROFILE_MIGRATED 1 entries to profiles/default
SMOKE_OK
MIGRATE_OK root holds profiles profiles.json 
AGENT_SELFTEST_OK bot-core started from /Users/shawntabrizi/Documents/GitHub/pcd-m18/dist/mac-arm64/Polkadot Chat.app/Contents/Resources/app.asar/node_modules/polkadot-chat-agents/index.mjs
```

### Picker actions (a scratch CDP script, headless, not a repo script)

```
picker true
default running after new window true
relaunched target true
after relaunch {"current":"work","rows":["work:true","default:true"],"signup":true}
```

"Open in new window" started a second process whose running mark appeared; "Open" restarted the picker's process into `work` (sign-up shown, both marks running). Both processes were stopped after.

### npm run screenshots -- --only profile-picker,settings-profiles

With `PCD_SCREENSHOT_IDENTITY` pointing at the main checkout's `.agent-runs/identity-pcde2e/identity.json` (this worktree has no test identities).

```
0.6s built
1.9s [main] seeded pcdecejakd.11
2.7s [profiles] saved profile-picker
10.0s [main] fixture written
11.6s [main] demo fixture requests: pcdpirate.81, pcdguide.70
13.4s [main] saved settings-profiles

PNGs:
  .agent-runs/screens/berlin-day/profile-picker.png
  .agent-runs/screens/berlin-night/profile-picker.png
  .agent-runs/screens/berlin-day/settings-profiles.png
  .agent-runs/screens/berlin-night/settings-profiles.png
SCREENSHOTS_OK in 13.5 s
```

Checked by eye: the picker lists alice.42 (Devnet), Work (alicework.07 · Paseo · Open in another window, with "Show"), New profile (profile-2) (Not signed up yet), and "Add profile"; Settings › Profiles lists the seeded identity ("This window", Rename only), Work (no Remove: it runs) and profile-2 (Remove…), "At launch: Ask which profile" and "Open another profile".

### git status --short (after the commit)

```
```

(empty)

### Not run

- The Undo-then-delete path of Settings › Profiles › Remove… was not pressed in the app; its rules (running and last profile refused, folder deleted, default cleared) are in `profiles.spec.ts`.
- Dock tiles and badges per process: every run was headless (no dock icon). See docs/questions.md.

## M19 — First shareable release, v0.2.0-preview (2026-09-24)

Worktree `pcd-m19` on branch `m19`. Every app launch was headless with a throwaway `PCD_USER_DATA_DIR`.

### npm run check

```
 Test Files  97 passed (97)
      Tests  851 passed (851)

> polkadot-chat-desktop@0.2.0 check:tokens
> node scripts/check-tokens.mjs

check:tokens: clean (197 files)
```

(tsc and eslint ran first in the same command with no output.)

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<temp> npm run smoke

```
✓ built in 204ms
SMOKE_OK
```

The temp root then held `profiles`, `profiles.json`; `profiles/` held `default`.

### npm run package && npm run smoke:packaged

```
  • skipped macOS code signing  reason=identity explicitly is set to null
  • building        target=DMG arch=arm64 file=dist/Polkadot Chat-0.2.0-arm64.dmg
  • building block map  blockMapFile=dist/Polkadot Chat-0.2.0-arm64.dmg.blockmap

> polkadot-chat-desktop@0.2.0 smoke:packaged
> bash scripts/smoke-packaged.sh

profile /var/folders/_1/q03733qd0pv42n1dvkcvyx0c0000gn/T/pcd-smoke.F1KCrY4xi3
SMOKE_OK
FRESH_OK root holds profiles profiles.json window.json 
AGENT_SELFTEST_OK bot-core started from /Users/shawntabrizi/Documents/GitHub/pcd-m19/dist/mac-arm64/Polkadot Chat.app/Contents/Resources/app.asar/node_modules/polkadot-chat-agents/index.mjs
```

### npm run e2e:profiles (devnet)

```
0.6s built
1.6s both profiles show sign-up
18.3s signed up b: pcdprofbhkqc.43 confirmed=true
90.3s signed up a: pcdprofahkqc.44 confirmed=true
PROFILES_CREATED a=pcdprofahkqc.44 b=pcdprofbhkqc.43 profiles=default,a,b
IDENTITY_OK a=pcdprofahkqc.44 b=pcdprofbhkqc.43
RUNNING_OK a sees a:running default:closed b:running
LOCK_OK second start of a exited code=0 (PROFILE_ALREADY_OPEN)
111.5s search attempt 1: "No results for “pcdprofahkqc”"
112.8s b sent a request to pcdprofahkqc.44
REQUEST_OK a received "Hello from profile b (aqqbyg)" from pcdprofbhkqc.43
115.1s b sent "Second message from b (aqqbyg)"
MESSAGES_OK a=pcdprofahkqc.44 received 2 messages from b=pcdprofbhkqc.43
REVEAL_OK 12 words shown after typing reveal; another word was refused
RESTORE_OK profile profile-2 = pcdprofahkqc.44 0xe8ab8b775e05036332194910713d758abc0ea9aea8bc42b77efb48f05ff57553 (same account as the removed profile a); a second restore was refused
PROFILES_OK in 135 s
```

### Release script (scripts/lib/release.spec.mjs, part of npm run check)

```
 ✓ scripts/release.sh > refuses a dirty tree before building anything
 ✓ scripts/release.sh > refuses a tag that does not name the package version
 ✓ scripts/release.sh > checks, packages and smokes, then prints the gh command without running it
```

### bash scripts/release.sh v0.2.0-preview (on the clean tree after the commit)

```
      Tests  851 passed (851)
SMOKE_OK
FRESH_OK root holds profiles profiles.json window.json 
AGENT_SELFTEST_OK bot-core started from /Users/shawntabrizi/Documents/GitHub/pcd-m19/dist/mac-arm64/Polkadot Chat.app/Contents/Resources/app.asar/node_modules/polkadot-chat-agents/index.mjs
RELEASE_READY v0.2.0-preview 17c218bc65d237b59e4f9fc2150aaab457c4a1cf55c4e09c3fba5a598d9910bf notes=dist/release-notes-v0.2.0-preview.md
Run this after the repo is public:
gh release create v0.2.0-preview --prerelease --title Polkadot\ Chat\ v0.2.0-preview --notes-file dist/release-notes-v0.2.0-preview.md dist/Polkadot\ Chat-0.2.0-arm64.dmg
```

### Screenshots (npm run screenshots -- --only settings-security,profile-restore)

```
2.8s [profiles] saved profile-restore
13.2s [main] saved settings-security
SCREENSHOTS_OK in 13.3 s
```

Checked by eye: Security shows the warning line, the field with "reveal" typed and Reveal enabled, no words; the picker shows the restore form (phrase, Devnet, "Restore profile" disabled while empty) under "Add profile".

### git status --short

Empty before the commit except the M19 files listed in the commit.

### Not run

- `gh release create`: not run, by instruction.
- The picker's restore form was not typed into in e2e (the IPC was called directly); a restore on Paseo was not run.

## HOP receive (2026-09-24)

### npm run check

```
 Test Files  101 passed (101)
      Tests  890 passed (890)
check:tokens: clean (198 files)
```

### PCD_HEADLESS=1 PCD_USER_DATA_DIR=<tmp> npm run smoke

```
SMOKE_OK
```

### npm run e2e:hop (devnet, desktop pcdbenchzzlx, throwaway bot)

```
BOT_CREATE pcdhopjjpas (scratch PCA_BOTS_DIR, brain echo, allow pcdbenchzzlx.23) at=0.0s
BOT_REGISTERED pcdhopjjpas.20 0x08718baf17b6a3367d8eaacbb102204a184e51e7eea077c5e47a2ab1a5886b02 files=products-devnet at=42.3s
[pca create] → Provisioning Bulletin Products Devnet file allowance…
[pca create] ⚠ The public Polkadot Products Devnet faucet may have accepted this allowance grant. Do not retry it yet.
BOT_STORAGE storage:   not authorized; //Eve grants it on devnet at=43.9s
BOT_STORAGE //Eve: granted in best block #977243 at=51.8s
BOT_STORAGE storage: active (granted in best block #977243) at=51.8s
FILE_SEEDED hop-e2e.png bytes=2326496 sha256=fda9b1c093d668d95f3ce6f7a21bf529356ee2731635e32873606b1dfe865b2e
[bot] {"event":"BOT_HOP_UPLOAD_CONFIGURED","account":"0xec4c952f44b0ac10b725b60d67cae898efb052b1010a8e6456a23c025593f16d","host":"bullet.sik.rocks","maxBytes":52428800}
[bot] {"event":"BOT_STARTING","endpoint":"wss://people-paseo.rotko.net","account":"0x08718baf17b6a3367d8eaacbb102204a184e51e7eea077c5e47a2ab1a5886b02","username":"pcdhopjjpas.20","brain":"echo
READY desktop=pcdbenchzzlx.23 at=54.7s
BOT_CONTACT pcdhopjjpas.20 at=65.3s
ASKED /file get hop-e2e.png at=65.3s
[bot] {"event":"HOP_UPLOADED","host":"bullet.sik.rocks","id":"0x3c517c72e23ff90e","bytes":2326496,"chunks":2}
[bot] {"event":"BOT_SENT_FILE","to":"e6c783b9ddb9785600bcfc065d12fef7b053844a8131ba36eda2160cf67a4a7e","mime":"image/png","bytes":2326496}
[bot] {"event":"BOT_FILE_DELIVERED","peer":"e6c783b9ddb97856","path":"hop-e2e.png","bytes":2326496}
HOP_MESSAGE id=7133D641-D117-48E6-9048-F4BF09225DF6 kind=general mime=image/png size=2326496 node=bullet.sik.rocks ticket_on_row=0B text="hop-e2e.png" at=71.3s
ACKED acked=3 notFound=0 failed=0 entries=3
HOP_RECEIVE_OK sha256=fda9b1c093d668d95f3ce6f7a21bf529356ee2731635e32873606b1dfe865b2e bytes=2326496 entries=3 cipher=chacha20-poly1305 layout=plain at=112.5s
HOP_ACK_OK a second claim of the root answers NotFound at=113.3s
HOP_OK bot=pcdhopjjpas.20 desktop=pcdbenchzzlx.23 sha256=fda9b1c093d668d9…
```

Earlier runs failed and were fixed: pca's faucet left the bot unauthorized (1012; the e2e now grants 8 MiB by //Eve), and the 2 MB chunk claim timed out at 30 s (now 120 s). Details in docs/decisions.md.

### npm run screenshots -- --only room-hop-image

```
.agent-runs/screens/berlin-day/room-hop-image.png
.agent-runs/screens/berlin-night/room-hop-image.png
SCREENSHOTS_OK in 11.4 s
```

### Not run

- A photo from a real Polkadot phone app: needs the owner's phone. The phones' dialect is covered by unit vectors built from the app code.

## M20 — Capabilities (0013), HOP send to baseline peers, Bulletin as a FileVariant (0014) (2026-09-24)

Desktop half. The brief's `e2e:caps` replaces the milestone's `e2e:rails` (docs/decisions.md "## M20").

### npm run check

```
 Test Files  102 passed (102)
      Tests  928 passed (928)
check:tokens: clean (200 files)
```

### npm run smoke (PCD_HEADLESS=1, throwaway PCD_USER_DATA_DIR)

```
SMOKE_OK
```

### npm run e2e:caps -- --pca <pca worktree at b8b9fc4> (devnet; a=pcde2e, b=pcdbenchqmwk, throwaway pca echo bot with BOT_PROTOCOL_EXTENSIONS=none)

```
[a] SELF pcdecejakd.11 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653
[b] SELF pcdbenchqmwk.45 0x7e8470687cce5c0bd98a694cdcb57854f620687d57cad73ad7d8ddf3ae212c3f
[b] READY username=pcdbenchqmwk.45 bulletin=5FqFnSwuPTXVN6KPmYfY8Y48SoB47ubgP2kJVM5zPkLdpg9r
[a] READY username=pcdecejakd.11 bulletin=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT
PEOPLE a=pcdecejakd.11 b=pcdbenchqmwk.45 at=4.0s
[a] CHAT_REQUEST_SENT id=3f967cde-3906-4f99-81f8-a28fa4a82dc9 to=pcdbenchqmwk.45
[b] ACCEPTED pcdecejakd.11
[a] CONTACT pcdbenchqmwk.45 devices=1
[b] SAID hello from b statements=1
[a] CAPS_KNOWN rail=bulletin device=0x7e847068… variants=0,1 dialects=0,1 features=3
[a] SAID hello from a statements=1
[b] CAPS_KNOWN rail=bulletin device=0xdce64f1a… variants=0,1 dialects=0,1 features=3
[a] CAPS_SENT sets=1 hello_statements=1
[b] CAPS_SENT sets=1 hello_statements=1
CAPS_EXCHANGED a→b sets=1 b→a sets=1 a_statements_for_hello=1 at=11.8s
[a] AUTH_OK account=5HbWpmFufMbqLfcfPdJPZorHRcLXUdnFFPoTd1fFBCV9D3eT transactions_left=32 bytes_left=39642891
[a] PHOTO_SENT id=7bdbc60e-2498-4b4b-a451-280d369be238 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a wire=richText/bulletin statements=1 others=none
[b] RAIL_BULLETIN_OK id=7bdbc60e-2498-4b4b-a451-280d369be238 wire=richText/bulletin row=attachment status=ready sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[b] READ the room is read; the seen goes when the 5 s window ends
[a] SEEN_OK id=7bdbc60e-2498-4b4b-a451-280d369be238 seen_at=2026-09-24T18:40:35.608Z
BOT_CREATE pcdcapsriwxb (scratch PCA_BOTS_DIR, brain echo, allow pcdecejakd.11) at=36.4s
BOT_REGISTERED pcdcapsriwxb.34 0xa0cd643cfdf840bda4635ec3d7c22c71ea67f705c2da78d40febc2c857fd4a1d at=78.1s
[a] BOT_CONTACT pcdcapsriwxb.34 botInfo=none rail=hop
[a] BOT_ECHO yes text_statements=1
[a] HOP_SEND_OK id=cde6d93a-5ad3-404d-9fbc-151b4a6e3bf9 wire=richText/p2pMixnet node=bullet.sik.rocks claim=match chacha20-poly1305/versioned/1entries photo_statements=1
[a] BASELINE_OK sent=capabilities,text,richText(p2pMixnet),text sets=1 statements=text:1,photo:1,buttons:1,after_window:0
[bot] {"time":"2026-09-24T18:41:36.749Z","event":"BOT_OUTBOUND_SUBMITTED","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messages":1}
[bot] {"time":"2026-09-24T18:41:36.749Z","event":"BOT_RECEIVED_OPENER","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","requestId":"d866ef66-e7b9-4267-9870-3227d827eb19","chars":0}
[bot] {"time":"2026-09-24T18:41:36.753Z","event":"BOT_RECEIVED_CAPABILITIES","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","device":"dce64f1a9918e031","kinds":24,"fileVariants":[0,1],"hopDialects":[0,1],"features":3}
[bot] {"time":"2026-09-24T18:41:36.773Z","event":"BOT_RECEIVED_TEXT","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":19}
[bot] {"time":"2026-09-24T18:41:37.132Z","event":"BOT_OUTBOUND_SUBMITTED","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messages":1}
[bot] {"time":"2026-09-24T18:41:37.438Z","event":"BOT_OUTBOUND_EXTENDED","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messages":2,"added":1,"extensions":1}
[bot] {"time":"2026-09-24T18:41:40.476Z","event":"BOT_RECEIVED_TEXT","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":21,"kind":"richText","attachments":1}
[bot] {"time":"2026-09-24T18:41:48.483Z","event":"HOP_DOWNLOADED","host":"bullet.sik.rocks","id":"0x7a9b9459644b3b15","bytes":303840,"chunks":0,"layout":"versioned","ms":8002,"bytesPerSec":37971}
[bot] {"time":"2026-09-24T18:41:48.788Z","event":"BOT_OUTBOUND_SUBMITTED","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messages":1}
[bot] {"time":"2026-09-24T18:41:51.416Z","event":"BOT_RECEIVED_TEXT","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":61}
[bot] {"time":"2026-09-24T18:41:51.727Z","event":"BOT_OUTBOUND_SUBMITTED","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","messages":1}
BOT_LOG lines=17 shown=11
MULTI_DEVICE_DOMAIN_OK a peer with a capable desktop and a silent phone gets HOP on both devices; after deviceRemoved, the Bulletin variant (domain test, not live)
[a] EXIT
[b] EXIT
CAPS_OK CAPS_EXCHANGED RAIL_BULLETIN_OK SEEN_OK HOP_SEND_OK BASELINE_OK MULTI_DEVICE_DOMAIN_OK sent=capabilities,text,richText(p2pMixnet),text sets=1 statements=text:1,photo:1,buttons:1,after_window:0 at=117.3s
exit=0
```

pca M20 stored our set under our device (`BOT_RECEIVED_CAPABILITIES device=dce64f1a…`) and downloaded our HOP photo in the phones' layout (`HOP_DOWNLOADED … layout=versioned`). (c) is the domain test, **not live**: a second device cannot get a statement allowance on devnet. An earlier run against pre-M20 pca passed the same desktop checks; that pca could not read the versioned root (`BOT_MEDIA_DOWNLOAD_FAILED attachment larger than cap`).

A first run with a=pcdbenchcold stopped at the grant with the new plain error (`//Eve` now refuses even 8 MiB):

```
[a] AUTH_FAILED The devnet storage grant was refused: the //Eve authorizer has no budget left, even for 8 MB. Try again later.
Bulletin authorization: AUTH_FAILED The devnet storage grant was refused: the //Eve authorizer has no budget left, even for 8 MB. Try again later.
```

### npm run e2e:attach (devnet, pcde2e → pcdeceb)

```
[b] SAID hello from b
[a] CAPS_KNOWN rail=bulletin
[a] SENT id=dad18339-657b-4476-9ca9-a05a14e11429 sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a statements_delta=1 messages_delta=1 bulletin_tx_delta=1 status=sent
[b] FETCH_OK id=dad18339-657b-4476-9ca9-a05a14e11429 status=ready sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a chunks=1 cid0=bafk2bzacecjxbnvez4iqjag6mc4xhaonrmqovhqx5xhohoah5huv5bztj36ze
[b] GATEWAY_OK id=dad18339-657b-4476-9ca9-a05a14e11429 status=ready sources=gateway sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
[b] FILE_OK id=2e86a7b9-6c68-4b0f-951c-d3c457e2c844 name=m15b-e2e-archive.bin media=file size=2300000 order=gateway-first,bitswap-first sources=gateway,bitswap sha256=e5c438377f408ceb44ea932b1484f584cc0ca3182db90789a061f64aaddc1163
[b] ALBUM_OK id=b8326b10-2829-41ec-9a0c-7c7a519771be items=4 kinds=image,image,image,image caption="M15b: an album of four" sources=bitswap,bitswap,bitswap,bitswap ready=4
[b] VOICE_OK id=57f95ea6-e5e5-4e02-8b74-c682d98a94ef media=voice duration_ms=60000 bars=32 mime="audio/webm; codecs=opus" sources=bitswap sha256=503c5b1b2fe747e3e7e0b76aeba77f19b1ea043811a35c220e00fabc3dcdd30a
[b] VIDEO_OK id=de0617d9-c384-4230-95a5-37fbbc615fff media=video 16x9 duration_ms=8000 name=m15c-e2e-clip.webm poster=blurhash(28) order=gateway-first sources=gateway sha256=20326262cf202f0e3797b7d95f6f7e9e244a414fa1efc9a4cac1acc25e92ff37
[b] RESEND_OK id=dad18339-657b-4476-9ca9-a05a14e11429 status=ready cid0=bafk2bzacecjxbnvez4iqjag6mc4xhaonrmqovhqx5xhohoah5huv5bztj36ze sources=bitswap sha256=7a2992f82b27c346d01259d9789b3f74e8c8703b764f1489567b24433a49f89a
BOT_DESCRIBE_SKIPPED the fleet runs 289d02c, which does not contain b8b9fc4 M20: capabilities (kind 252), gated extensions, HOP send in the phones' dialect, FileVariant 1, HOP timeout, 8 MiB grants
ATTACH_OK FILE_OK ALBUM_OK VOICE_OK VIDEO_OK RESEND_OK BOT_DESCRIBE_SKIPPED at=277.7s
exit=0
```

Two earlier runs: the video check assumed kind-250 metadata (the base `VideoFileMeta` has no frame size and whole seconds; bytes matched; the check takes both forms now), and the fleet bot step failed because the fleet runs pre-M20 pca, which cannot read HOP in the phones' dialect (kind 250 is no longer sent). The bot step now waits for pca M20 on the fleet (read-only check).

### npm run e2e:typing (pcdpirate.81, transition rule through botInfo)

```
SEEN_RECEIVED upTo=97b3a2d7-1c2f-4709-a2be-27e6bdb77605 at=4.3s
READ_SUBMISSIONS 1 (inside the 5 s window: 0)
COUNTS submissions=2 messages=1 acknowledgements=1 (this round)
DIAGNOSTICS submissions=3 messages=1 acknowledgements=3 (whole run: request and accept included)
BUDGET_OK
exit=0
```

### npm run e2e:hop — not green, environment

```
[pca create] ⚠ The public Polkadot Products Devnet faucet may have accepted this allowance grant. Do not retry it yet.
BOT_STORAGE storage:   not authorized; //Eve grants it on devnet at=50.0s
BOT_STORAGE //Eve: grant failed: {"type":"TransactionStorage","value":{"type":"InsufficientAuthorizerBudget"}} at=134.2s
BOT_STORAGE storage:   not authorized at=135.8s
HOP_FAILED the bot has no Bulletin authorization for hop_submit
exit=1
```

The scratch bot's Bulletin account could not get an authorization: `//Eve` refuses every grant (`InsufficientAuthorizerBudget`), so pca's `hop_submit` is refused before any desktop code runs. The desktop's HOP receive path is unchanged except a guard for our own uploads (unit tests green); pca M20 read a desktop HOP file in e2e:caps. Rerun when the devnet authorizer has budget.

### Not run

- `npm run screenshots`: no new screenshot required by the brief; the HOP detail line ("Sent over HOP; available for 24 hours") is not captured.
- A real phone: needs the owner's phone.
- `e2e:group2`, `e2e:group2b` and other desktop-pair e2es: not rerun. A desktop pair that creates a group before the peer sent anything now gets "cannot take part in groups yet" (question in docs/questions.md "## M20").

## Group names and gated picker (2026-09-24)

```
$ npm run check (last lines)
Test Files  105 passed (105)
check:tokens: clean (204 files)

$ PCD_HEADLESS=1 PCD_USER_DATA_DIR=<tmp> npm run smoke
SMOKE_OK

$ PCD_HEADLESS=1 PCD_USER_DATA_DIR=<tmp> npm run e2e:group2b -- --identity-a pcdtestggji --register-wait 900
BOT_CREATE pcdgrpuyvnp (scratch PCA_BOTS_DIR, brain echo, allow pcdtestggji.38) at=0.0s
BOT_REGISTERED pcdgrpuyvnp.27 0xd43502abfe7d6e62b1387fd03548a8e1318d67c2d189e9f47507cca5bd06443c at=103.6s
PEOPLE a=pcdtestggji.38 b=pcdbenchfina.25 bot=pcdgrpuyvnp.27 at=106.6s
[a] BOT_GROUP_SUPPORT ready
[a] GROUP2_CREATED id=b214ea24-b50c-4090-8c17-32ff34fc80df epoch=1 statements=1 derived="pcdgrpuyvnp.27"
GROUP_READY group=b214ea24-b50c-4090-8c17-32ff34fc80df a=7bc2be76-6e12-43b2-ab8a-ad4459f05211 bot=0CAC3A10-CCF5-467D-B570-FBB375345637 at=121.5s
JOIN_APPROVED policy=1 a accepted the chat request itself (auto-accepted), b heard pending, approve cost 2 submissions (the state; the welcome and the history ride the DM), b epoch=1 at=127.1s
HISTORY_OK b has both earlier messages and the line "History shared by pcdtestggji.38" at=127.1s
DERIVED_NAME_OK created unnamed; a saw "pcdgrpuyvnp.27" at creation, now a sees "pcdbenchfina.25, pcdgrpuyvnp.27" and b sees "pcdgrpuyvnp.27, pcdtestggji.38" at=127.1s
RENAME_OK cost 1 statement(s); b shows "Trail crew 21:50:25" with the line "pcdtestggji.38 named the group “Trail crew 21:50:25”" at=128.4s
PIN_OK cost 1 statement(s); b's state pins 1 at=129.7s
[b] SEND2_FAILED Your account’s space on the network is full of chat statements, so a group statement cannot be stored.
E2E_TIMEOUT slow mode (held=false first=false hidden=no second=false)
PROMOTED_OK cost 1 statement(s); b is admin with flags 0xbf at=132.6s
[b] REMOVE2_FAILED Your account’s space on the network is full of chat statements, so a group statement cannot be stored.
E2E_TIMEOUT b removes the bot (REMOVE2_FAILED Your account’s space on the network is full of chat statements, so a group statement cannot be stored.)
GROUP2B_INCOMPLETE 2 step(s) timed out: slow mode (held=false first=false hidden=no second=false); b removes the bot (REMOVE2_FAILED Your account’s space on the network is full of chat statements, so a group statement cannot be stored.)
```

Earlier runs today: default a (`pcdbenchfinb`) and `pcdtestjaia` got AccountFull at CREATE2; several runs had BOT_CREATE_FAILED (devnet confirmed new usernames after more than 180 s; hence `--register-wait`); one run (before the joinRequest fix) showed b refusing its own `joinRequest` under the M20 gate; one run with `pcdtestjaia` timed out on "the bot holds epoch 1". A last run with `--identity-b pcdrevchibacbfcc` got AccountFull for a (`pcdtestggji`) at APPROVE.

### Screenshots

`group-create` (group worker, live, pcdbenchqmwk + pcdbenchfina + pcdguide.70), `group-rename` and `group-picker-gated` (main worker, fixtures), both themes, `SCREENSHOTS_OK`. Checked by eye.

### Not run

- `e2e:group2`, `e2e:dao`: not rerun (they create v2 groups right after a chat opens; see decisions).
- GROUP2B_OK: SLOW_OK and BOT_REMOVED_OK did not run (AccountFull for b; see decisions).

## Fresh e2e identities and silent devices (2026-09-24)

`npm run check`: 957 tests passed, then:

```
check:tokens: clean (204 files)
```

`PCD_HEADLESS=1 PCD_USER_DATA_DIR=<tmp> npm run smoke`: `SMOKE_OK`.

`npm run screenshots -- --only group-picker-gated`: `SCREENSHOTS_OK in 14.2 s`, retaken after the restart: `SCREENSHOTS_OK in 12.3 s` (both themes; daraquinn.52 reads "Uses a client without group support", clarawest.09 "Not known yet: message them first"). Checked by eye.

Runs before the pool (fresh live registrations).

`npm run e2e:group2b` (markers only):

```
IDENTITY_CLAIMED pcdgtbanucwvi pcdgtbanucwvi.77 attempt=1 at=14.5s
IDENTITY_CLAIMED pcdgtbbssdtxy pcdgtbbssdtxy.77 attempt=1 at=16.1s
IDENTITY_REGISTERED pcdgtbbssdtxy pcdgtbbssdtxy.77 claims=1 in=81.4s
IDENTITY_REGISTERED pcdgtbanucwvi pcdgtbanucwvi.77 claims=1 in=271.8s
IDENTITY_FRESH a=pcdgtbanucwvi.77 b=pcdgtbbssdtxy.77
BOT_CREATE pcdgrpurlaq (scratch PCA_BOTS_DIR, brain echo, allow pcdgtbanucwvi.77) at=271.8s
BOT_REGISTERED pcdgrpurlaq.70 0x146b94efa57615d1bd8adaf1c67b018cf0d5ba12d5a323a1e47f2668ad1f2b16 at=592.8s
PEOPLE a=pcdgtbanucwvi.77 b=pcdgtbbssdtxy.77 bot=pcdgrpurlaq.70 at=595.6s
GROUP_READY group=c2eb2e55-32a9-4d64-9aa8-efc86732f6bb a=140d7f06-c086-48e1-adae-1ada29f158a6 bot=2F891167-3FC5-4AFF-8EF4-0EDEC03EB0C2 at=607.5s
JOIN_APPROVED policy=1 a accepted the chat request itself (auto-accepted), b heard pending, approve cost 1 submissions (the state; the welcome and the history ride the DM), b epoch=1 at=612.7s
HISTORY_OK b has both earlier messages and the line "History shared by pcdgtbanucwvi.77" at=613.7s
DERIVED_NAME_OK created unnamed; a saw "pcdgrpurlaq.70" at creation, now a sees "pcdgrpurlaq.70, pcdgtbbssdtxy.77" and b sees "pcdgrpurlaq.70, pcdgtbanucwvi.77" at=613.7s
RENAME_OK cost 1 statement(s); b shows "Trail crew 22:51:00" with the line "pcdgtbanucwvi.77 named the group “Trail crew 22:51:00”" at=614.0s
PIN_OK cost 1 statement(s); b's state pins 1 at=614.3s
SLOW_OK b's second message waited (0 submissions in 3 s), a hid the forged one, the held one reached a 11.6 s after the first at=626.2s
PROMOTED_OK cost 1 statement(s); b is admin with flags 0xbf at=626.9s
BOT_REMOVED_OK by b in 2 submissions; a epoch=2 members=2 signer=b (pcdgtbbssdtxy.77); bot: {"time":"2026-09-24T22:51:17.086Z","event":"BOT_GROUP2_KEY_R at=629.9s
GROUP2B_OK at=629.9s
```

`npm run e2e:group2` (markers only):

```
IDENTITY_CLAIMED pcdgtwbtqdacj pcdgtwbtqdacj.34 attempt=1 at=16.5s
IDENTITY_CLAIMED pcdgtwakmolpt pcdgtwakmolpt.80 attempt=1 at=22.1s
IDENTITY_REGISTERED pcdgtwakmolpt pcdgtwakmolpt.80 claims=1 in=106.2s
IDENTITY_REGISTERED pcdgtwbtqdacj pcdgtwbtqdacj.34 claims=1 in=168.8s
IDENTITY_FRESH a=pcdgtwakmolpt.80 b=pcdgtwbtqdacj.34
BOT_CREATE pcdgrpnzhxt (scratch PCA_BOTS_DIR, brain echo, allow pcdgtwakmolpt.80) at=168.9s
BOT_REGISTERED pcdgrpnzhxt.94 0x5856c4d46af102fc01041b310eab326244db420421003984c5ce554163ad6328 at=449.4s
PEOPLE a=pcdgtwakmolpt.80 b=pcdgtwbtqdacj.34 bot=pcdgrpnzhxt.94 at=452.9s
CONTACTS_OK a↔b, a↔pcdgrpnzhxt.94 at=461.2s
V2_CREATED group=e6051a02-1ca0-4c28-9998-e6066a75d503 create_statements=1 b epoch=1 bot joined at=462.9s
ONE_SUBMISSION submissions=1 messages=1 at=463.2s
BOT_REPLY_OK id=94A87D82-0B7B-455F-AF9C-40EAE7DF64BA text="Echo: hello bot" bot statements on Topic_1: ChMsgs_1=1 at=464.5s
CARRY_OK b got 3 messages from a's current statement after a restart at=471.5s
REMOVED_LOCKED_OUT submissions=2 b: no entry, epoch=1, a's epoch-2 statements=2 opened=0 at=474.4s
BOT_EPOCH2_OK text="Echo: after b left" on Topic_2 at=474.7s
HISTORY_OK the bot's page brought back id=94A87D82-0B7B-455F-AF9C-40EAE7DF64BA ("History shared by pcdgrpnzhxt.94") at=475.8s
MIGRATED_OK group=f8f5d4cf-5a1b-4adc-97cd-4a63a1de98ca b kept its v1 row (true) and read a's v2 message at=481.3s
GROUP2_OK at=481.3s
[a] MEMBERS_GROUP_SUPPORT ready
```

Pool seed: `node scripts/lib/identityPool.mjs refill 8` (first version of the pool; the 8 claims took about 22 s; `IDENTITY_CLAIMED` lines left out; the log was lost in the restart, lines copied from the session):

```
POOL_REFILL 2026-09-24T22:53:31.052Z unused=0 target=8 registering=8
IDENTITY_REGISTERED pcdpoolocfxtl pcdpoolocfxtl.59 claims=1 in=38.3s
IDENTITY_REGISTERED pcdpoolazmuxd pcdpoolazmuxd.46 claims=1 in=46.0s
POOL_REFILL_MISS no fresh identity attested in 30 min (4 claims, 4 attempts)   (6 times)
POOL_REFILLED added=2/8 wall=1803.8s sum=84.3s
POOL {"total":2,"unused":2}
```

A second refill (the version committed) adopted the 24 pending claims and watched them; all landed. After the restart: `POOL {"total":26,"ready":17,"pending":0}` before the runs below; 24 measured claims took 1 610–2 956 s each from claim to attestation, sum 52 071 s.

Runs from the pool, after the restart. `npm run check`: 957 tests passed, last line `check:tokens: clean (204 files)`. Smoke again: `SMOKE_OK`.

`npm run e2e:group2` (markers only):

```
IDENTITY_FRESH a=pcdpoolmiqbuv.91 b=pcdpoolywhnpk.31 from=pool,pool in=20.1s pool={"total":26,"ready":12,"pending":9}
BOT_CREATE pcdgrpchhfh (scratch PCA_BOTS_DIR, brain echo, allow pcdpoolmiqbuv.91) at=20.1s
BOT_REGISTERED pcdgrpchhfh.24 0xaef02bc2d3749c1a36fd8508ab903e2be8e4afab359f169e6c12d9497633b879 at=82.3s
PEOPLE a=pcdpoolmiqbuv.91 b=pcdpoolywhnpk.31 bot=pcdgrpchhfh.24 at=85.3s
CONTACTS_OK a↔b, a↔pcdgrpchhfh.24 at=94.7s
V2_CREATED group=caa0672b-3c8a-4268-9b26-9eda71ebaf6f create_statements=2 b epoch=1 bot joined at=96.4s
ONE_SUBMISSION submissions=1 messages=1 at=96.7s
BOT_REPLY_OK id=09A44B08-8A70-4D14-A3FD-DB82024F9BED text="Echo: hello bot" bot statements on Topic_1: ChMsgs_1=1 at=98.0s
CARRY_OK b got 3 messages from a's current statement after a restart at=104.5s
REMOVED_LOCKED_OUT submissions=2 b: no entry, epoch=1, a's epoch-2 statements=2 opened=0 at=106.1s
BOT_EPOCH2_OK text="Echo: after b left" on Topic_2 at=108.0s
HISTORY_OK the bot's page brought back id=09A44B08-8A70-4D14-A3FD-DB82024F9BED ("History shared by pcdgrpchhfh.24") at=109.0s
MIGRATED_OK group=c3a36909-112d-45b9-a89c-21b403b0ed8e b kept its v1 row (true) and read a's v2 message at=113.0s
GROUP2_OK at=113.0s
```

`npm run e2e:group2b`, first run at the same time (markers only):

```
IDENTITY_FRESH a=pcdpoolyqdcjr.93 b=pcdpooltcsegt.38 from=pool,pool in=26.5s pool={"total":26,"ready":10,"pending":9}
BOT_CREATE pcdgrpgfeeb (scratch PCA_BOTS_DIR, brain echo, allow pcdpoolyqdcjr.93) at=26.5s
BOT_REGISTERED pcdgrpgfeeb.06 0xfa62e3e8abb30672e28eb8ae2de74e4096003a358fdfea17dd742457ebf16462 at=99.5s
PEOPLE a=pcdpoolyqdcjr.93 b=pcdpooltcsegt.38 bot=pcdgrpgfeeb.06 at=105.8s
OPEN_BOT_FAILED the bot did not accept in 170 s
```

`npm run e2e:group2b`, rerun (markers only):

```
IDENTITY_FRESH a=pcdpoolqxjoiw.23 b=pcdpoolyyghcq.88 from=pool,pool in=17.5s pool={"total":26,"ready":17,"pending":0}
BOT_CREATE pcdgrpiwzjk (scratch PCA_BOTS_DIR, brain echo, allow pcdpoolqxjoiw.23) at=17.5s
BOT_REGISTERED pcdgrpiwzjk.56 0xe049227aa576312ef6bb975c9411131c4760dd5c37c125a43bf33c15d2a8c772 at=69.3s
PEOPLE a=pcdpoolqxjoiw.23 b=pcdpoolyyghcq.88 bot=pcdgrpiwzjk.56 at=72.0s
GROUP_READY group=9acc7895-c91c-47d7-b195-fe4681f8b928 a=1c2d3557-5065-47a5-9944-fb2efffedda9 bot=E2D25FB4-FB55-4E5B-B23E-1B67AAF61C19 at=87.0s
JOIN_APPROVED policy=1 a accepted the chat request itself (auto-accepted), b heard pending, approve cost 2 submissions (the state; the welcome and the history ride the DM), b epoch=1 at=92.4s
HISTORY_OK b has both earlier messages and the line "History shared by pcdpoolqxjoiw.23" at=93.4s
DERIVED_NAME_OK created unnamed; a saw "pcdgrpiwzjk.56" at creation, now a sees "pcdgrpiwzjk.56, pcdpoolyyghcq.88" and b sees "pcdgrpiwzjk.56, pcdpoolqxjoiw.23" at=93.4s
RENAME_OK cost 1 statement(s); b shows "Trail crew 00:03:42" with the line "pcdpoolqxjoiw.23 named the group “Trail crew 00:03:42”" at=93.7s
PIN_OK cost 1 statement(s); b's state pins 1 at=95.0s
SLOW_OK b's second message waited (0 submissions in 3 s), a hid the forged one, the held one reached a 11.6 s after the first at=108.0s
PROMOTED_OK cost 1 statement(s); b is admin with flags 0xbf at=108.6s
BOT_REMOVED_OK by b in 2 submissions; a epoch=2 members=2 signer=b (pcdpoolyyghcq.88); bot: {"time":"2026-09-25T00:03:59.392Z","event":"BOT_GROUP2_KEY_R at=109.8s
GROUP2B_OK at=109.8s
```

Not run: `e2e:dao` (`DAO_E2E_PENDING` stays), `e2e:caps`.
