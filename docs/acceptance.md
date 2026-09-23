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
